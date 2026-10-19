import type { AppState } from "@excalidraw/excalidraw/types";

import { getCommonBounds } from "./bounds";
import { updateBoundElements } from "./binding";
import { getFrameChildren } from "./frame";
import { getSelectedElementsByGroup } from "./groups";
import { isArrowElement, isFrameLikeElement } from "./typeChecks";

import { getNonDeletedElements } from ".";

import type { Scene } from "./Scene";
import type {
  ElementsMap,
  ExcalidrawArrowElement,
  NonDeletedExcalidrawElement,
} from "./types";

export const DEFAULT_TIDY_LAYER_GAP = 100;
export const DEFAULT_TIDY_NODE_GAP = 60;
/** gap between sub-diagrams that aren't connected to each other */
export const DEFAULT_TIDY_COMPONENT_GAP = 160;

/** number of barycenter sweeps used to reduce edge crossings */
const CROSSING_REDUCTION_SWEEPS = 4;

export type TidyFlowDirection = "down" | "right";

export type TidyLayoutOptions = {
  /** `"auto"` picks the direction the existing arrows already flow in */
  direction?: TidyFlowDirection | "auto";
  layerGap?: number;
  nodeGap?: number;
  componentGap?: number;
};

export type TidyTranslation = { x: number; y: number };

/**
 * A rigid cluster of elements that the layout moves as one. Groups and frames
 * (together with their children) become a single node so that tidying never
 * takes them apart.
 */
type TidyNode = {
  key: string;
  elements: NonDeletedExcalidrawElement[];
  width: number;
  height: number;
  /** center of the node before the layout ran */
  originCenter: { x: number; y: number };
  /** top-left of the node before the layout ran */
  originMin: { x: number; y: number };
};

type TidyEdge = { from: number; to: number };

type AppStateSlice = Readonly<
  Pick<AppState, "selectedGroupIds" | "editingGroupId">
>;

const sortedByOrigin = (nodes: readonly TidyNode[]): number[] =>
  nodes
    .map((_, index) => index)
    .sort((a, b) => {
      const nodeA = nodes[a];
      const nodeB = nodes[b];
      return (
        nodeA.originMin.y - nodeB.originMin.y ||
        nodeA.originMin.x - nodeB.originMin.x ||
        (nodeA.key < nodeB.key ? -1 : nodeA.key > nodeB.key ? 1 : 0)
      );
    });

const toNode = (
  key: string,
  elements: NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
): TidyNode => {
  const [minX, minY, maxX, maxY] = getCommonBounds(elements, elementsMap);

  return {
    key,
    elements,
    width: maxX - minX,
    height: maxY - minY,
    originCenter: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    originMin: { x: minX, y: minY },
  };
};

/**
 * An arrow that is bound to something is a connector, not a box: it is routed
 * by the binding machinery instead of being given a slot in the layout.
 */
const isConnector = (
  elements: readonly NonDeletedExcalidrawElement[],
): elements is [NonDeletedExcalidrawElement & ExcalidrawArrowElement] =>
  elements.length === 1 &&
  isArrowElement(elements[0]) &&
  (elements[0].startBinding != null || elements[0].endBinding != null);

const buildClusters = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  appState: AppStateSlice,
): { key: string; elements: NonDeletedExcalidrawElement[] }[] => {
  const clusters: { key: string; elements: NonDeletedExcalidrawElement[] }[] =
    [];
  const claimed = new Set<string>();

  // frames first — a frame and everything it holds move together
  for (const element of selectedElements) {
    if (!isFrameLikeElement(element) || claimed.has(element.id)) {
      continue;
    }
    const members: NonDeletedExcalidrawElement[] = [
      element,
      ...getNonDeletedElements(getFrameChildren(elementsMap, element.id)),
    ];
    members.forEach((member) => claimed.add(member.id));
    clusters.push({ key: `${element.id}_frame`, elements: members });
  }

  const remaining = selectedElements.filter(
    (element) => !claimed.has(element.id),
  );

  for (const group of getSelectedElementsByGroup(
    remaining,
    elementsMap,
    appState,
  )) {
    const members = getNonDeletedElements(group);
    if (members.length > 0) {
      clusters.push({
        key: members
          .map((member) => member.id)
          .sort()
          .join("|"),
        elements: [...members],
      });
    }
  }

  return clusters;
};

/**
 * Longest-path layering over a DAG. Cycles are broken first by dropping the
 * back edges a depth-first walk finds, so a cyclic graph still gets layered.
 */
const assignLayers = (
  nodeCount: number,
  edges: readonly TidyEdge[],
  visitOrder: readonly number[],
): number[] => {
  const outgoing: number[][] = Array.from({ length: nodeCount }, () => []);
  edges.forEach((edge, index) => outgoing[edge.from].push(index));

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Array<number>(nodeCount).fill(WHITE);
  const forwardEdges: TidyEdge[] = [];

  for (const root of visitOrder) {
    if (color[root] !== WHITE) {
      continue;
    }
    const stack: { node: number; cursor: number }[] = [
      { node: root, cursor: 0 },
    ];
    color[root] = GRAY;

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.cursor >= outgoing[frame.node].length) {
        color[frame.node] = BLACK;
        stack.pop();
        continue;
      }
      const edge = edges[outgoing[frame.node][frame.cursor++]];
      if (color[edge.to] === GRAY) {
        // back edge — keep the arrow, drop it from the layering graph
        continue;
      }
      forwardEdges.push(edge);
      if (color[edge.to] === WHITE) {
        color[edge.to] = GRAY;
        stack.push({ node: edge.to, cursor: 0 });
      }
    }
  }

  const indegree = new Array<number>(nodeCount).fill(0);
  const forwardOutgoing: number[][] = Array.from(
    { length: nodeCount },
    () => [],
  );
  for (const edge of forwardEdges) {
    indegree[edge.to]++;
    forwardOutgoing[edge.from].push(edge.to);
  }

  const layers = new Array<number>(nodeCount).fill(0);
  const queue = visitOrder.filter((node) => indegree[node] === 0);

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of forwardOutgoing[node]) {
      layers[next] = Math.max(layers[next], layers[node] + 1);
      if (--indegree[next] === 0) {
        queue.push(next);
      }
    }
  }

  return layers;
};

const findComponents = (
  nodeCount: number,
  edges: readonly TidyEdge[],
  visitOrder: readonly number[],
): number[][] => {
  const parent = Array.from({ length: nodeCount }, (_, index) => index);
  const find = (node: number): number => {
    let root = node;
    while (parent[root] !== root) {
      root = parent[root];
    }
    while (parent[node] !== root) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };

  for (const edge of edges) {
    const a = find(edge.from);
    const b = find(edge.to);
    if (a !== b) {
      parent[a] = b;
    }
  }

  const components = new Map<number, number[]>();
  for (const node of visitOrder) {
    const root = find(node);
    const component = components.get(root);
    if (component) {
      component.push(node);
    } else {
      components.set(root, [node]);
    }
  }

  return [...components.values()];
};

/**
 * Pool-adjacent-violators: the closest non-decreasing sequence to `values`.
 * Used to honour the minimum gap between neighbours while staying as close as
 * possible to where each node wants to sit.
 */
const isotonicRegression = (values: readonly number[]): number[] => {
  const blocks: { sum: number; count: number }[] = [];

  for (const value of values) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const previous = blocks[blocks.length - 2];
      if (previous.sum / previous.count <= last.sum / last.count) {
        break;
      }
      previous.sum += last.sum;
      previous.count += last.count;
      blocks.pop();
    }
  }

  const result: number[] = [];
  for (const block of blocks) {
    const mean = block.sum / block.count;
    for (let i = 0; i < block.count; i++) {
      result.push(mean);
    }
  }

  return result;
};

/**
 * Places an ordered row of nodes as close to `desired` as the minimum gap
 * allows, without reordering them.
 */
const placeRow = (
  desired: readonly number[],
  sizes: readonly number[],
  gap: number,
): number[] => {
  const offsets: number[] = [0];
  for (let i = 1; i < desired.length; i++) {
    offsets.push(offsets[i - 1] + sizes[i - 1] / 2 + gap + sizes[i] / 2);
  }

  return isotonicRegression(
    desired.map((value, index) => value - offsets[index]),
  ).map((value, index) => value + offsets[index]);
};

const layoutComponent = (
  nodes: readonly TidyNode[],
  component: readonly number[],
  edges: readonly TidyEdge[],
  crossOf: (node: TidyNode) => number,
  crossSizeOf: (node: TidyNode) => number,
  flowSizeOf: (node: TidyNode) => number,
  nodeGap: number,
  layerGap: number,
): Map<number, { cross: number; flow: number }> => {
  const local = new Map<number, number>();
  component.forEach((node, index) => local.set(node, index));
  const localEdges = edges
    .filter((edge) => local.has(edge.from) && local.has(edge.to))
    .map((edge) => ({
      from: local.get(edge.from)!,
      to: local.get(edge.to)!,
    }));
  const localNodes = component.map((node) => nodes[node]);
  const visitOrder = sortedByOrigin(localNodes);

  const layerOf = assignLayers(localNodes.length, localEdges, visitOrder);

  const neighbours: number[][] = localNodes.map(() => []);
  for (const edge of localEdges) {
    neighbours[edge.from].push(edge.to);
    neighbours[edge.to].push(edge.from);
  }

  const layers: number[][] = [];
  for (const node of visitOrder) {
    (layers[layerOf[node]] ??= []).push(node);
  }
  for (let i = 0; i < layers.length; i++) {
    layers[i] ??= [];
  }

  const cross = new Map<number, number>();
  for (const layer of layers) {
    layer.sort(
      (a, b) =>
        crossOf(localNodes[a]) - crossOf(localNodes[b]) ||
        (localNodes[a].key < localNodes[b].key ? -1 : 1),
    );
    placeRow(
      layer.map((node) => crossOf(localNodes[node])),
      layer.map((node) => crossSizeOf(localNodes[node])),
      nodeGap,
    ).forEach((position, index) => cross.set(layer[index], position));
  }

  for (let sweep = 0; sweep < CROSSING_REDUCTION_SWEEPS; sweep++) {
    const downwards = sweep % 2 === 0;
    for (let i = 0; i < layers.length; i++) {
      const layerIndex = downwards ? i : layers.length - 1 - i;
      const layer = layers[layerIndex];
      if (layer.length === 0) {
        continue;
      }

      const barycenter = new Map<number, number>();
      for (const node of layer) {
        const anchors = neighbours[node].filter(
          (neighbour) =>
            layerOf[neighbour] === layerIndex + (downwards ? -1 : 1),
        );
        barycenter.set(
          node,
          anchors.length > 0
            ? anchors.reduce(
                (sum, neighbour) => sum + cross.get(neighbour)!,
                0,
              ) / anchors.length
            : cross.get(node)!,
        );
      }

      layer.sort(
        (a, b) =>
          barycenter.get(a)! - barycenter.get(b)! ||
          cross.get(a)! - cross.get(b)! ||
          (localNodes[a].key < localNodes[b].key ? -1 : 1),
      );
      placeRow(
        layer.map((node) => barycenter.get(node)!),
        layer.map((node) => crossSizeOf(localNodes[node])),
        nodeGap,
      ).forEach((position, index) => cross.set(layer[index], position));
    }
  }

  const result = new Map<number, { cross: number; flow: number }>();
  let flowCursor = 0;
  for (const layer of layers) {
    const extent = layer.reduce(
      (max, node) => Math.max(max, flowSizeOf(localNodes[node])),
      0,
    );
    for (const node of layer) {
      result.set(component[node], {
        cross: cross.get(node)!,
        flow: flowCursor + extent / 2,
      });
    }
    flowCursor += extent + layerGap;
  }

  return result;
};

const inferDirection = (
  nodes: readonly TidyNode[],
  edges: readonly TidyEdge[],
): TidyFlowDirection => {
  let horizontal = 0;
  let vertical = 0;

  for (const edge of edges) {
    const from = nodes[edge.from].originCenter;
    const to = nodes[edge.to].originCenter;
    horizontal += Math.abs(to.x - from.x);
    vertical += Math.abs(to.y - from.y);
  }

  return horizontal > vertical ? "right" : "down";
};

/**
 * Whether the selection holds at least two things that can be laid out.
 * Cheaper than {@link computeTidyLayout}, for predicates that run on render.
 */
export const canTidyElements = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  appState: AppStateSlice,
): boolean =>
  buildClusters(selectedElements, elementsMap, appState).filter(
    (cluster) => !isConnector(cluster.elements),
  ).length >= 2;

/**
 * Computes a deterministic layered ("Sugiyama-style") layout for the selected
 * elements and returns the translation to apply to each element.
 *
 * Pure: the same selection always yields the same translations. Nodes end up
 * in non-overlapping slots, and the layout as a whole stays centered on the
 * selection's original bounding box.
 */
export const computeTidyLayout = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  appState: AppStateSlice,
  options: TidyLayoutOptions = {},
): Map<string, TidyTranslation> => {
  const layerGap = options.layerGap ?? DEFAULT_TIDY_LAYER_GAP;
  const nodeGap = options.nodeGap ?? DEFAULT_TIDY_NODE_GAP;
  const componentGap = options.componentGap ?? DEFAULT_TIDY_COMPONENT_GAP;

  const clusters = buildClusters(selectedElements, elementsMap, appState);
  const nodes: TidyNode[] = [];
  const nodeOfElement = new Map<string, number>();
  const connectors: ExcalidrawArrowElement[] = [];

  for (const cluster of clusters) {
    if (isConnector(cluster.elements)) {
      connectors.push(cluster.elements[0]);
      continue;
    }
    const index = nodes.length;
    nodes.push(toNode(cluster.key, cluster.elements, elementsMap));
    for (const element of cluster.elements) {
      nodeOfElement.set(element.id, index);
    }
  }

  if (nodes.length < 2) {
    return new Map();
  }

  const edges: TidyEdge[] = [];
  for (const connector of connectors) {
    const from = connector.startBinding
      ? nodeOfElement.get(connector.startBinding.elementId)
      : undefined;
    const to = connector.endBinding
      ? nodeOfElement.get(connector.endBinding.elementId)
      : undefined;
    if (from !== undefined && to !== undefined && from !== to) {
      edges.push({ from, to });
    }
  }

  const direction =
    !options.direction || options.direction === "auto"
      ? inferDirection(nodes, edges)
      : options.direction;
  const down = direction === "down";

  const crossOf = (node: TidyNode) =>
    down ? node.originCenter.x : node.originCenter.y;
  const crossSizeOf = (node: TidyNode) => (down ? node.width : node.height);
  const flowSizeOf = (node: TidyNode) => (down ? node.height : node.width);

  const visitOrder = sortedByOrigin(nodes);
  const components = findComponents(nodes.length, edges, visitOrder);

  const placement = new Map<number, { cross: number; flow: number }>();
  let crossCursor = 0;

  for (const component of components) {
    const local = layoutComponent(
      nodes,
      component,
      edges,
      crossOf,
      crossSizeOf,
      flowSizeOf,
      nodeGap,
      layerGap,
    );

    let minCross = Infinity;
    let maxCross = -Infinity;
    for (const node of component) {
      const { cross } = local.get(node)!;
      const half = crossSizeOf(nodes[node]) / 2;
      minCross = Math.min(minCross, cross - half);
      maxCross = Math.max(maxCross, cross + half);
    }

    const shift = crossCursor - minCross;
    for (const node of component) {
      const { cross, flow } = local.get(node)!;
      placement.set(node, { cross: cross + shift, flow });
    }
    crossCursor += maxCross - minCross + componentGap;
  }

  // keep the tidied diagram centered where the user left it
  let minCross = Infinity;
  let maxCross = -Infinity;
  let minFlow = Infinity;
  let maxFlow = -Infinity;
  let originMinCross = Infinity;
  let originMaxCross = -Infinity;
  let originMinFlow = Infinity;
  let originMaxFlow = -Infinity;

  nodes.forEach((node, index) => {
    const { cross, flow } = placement.get(index)!;
    const halfCross = crossSizeOf(node) / 2;
    const halfFlow = flowSizeOf(node) / 2;
    minCross = Math.min(minCross, cross - halfCross);
    maxCross = Math.max(maxCross, cross + halfCross);
    minFlow = Math.min(minFlow, flow - halfFlow);
    maxFlow = Math.max(maxFlow, flow + halfFlow);

    const originCross = crossOf(node);
    const originFlow = down ? node.originCenter.y : node.originCenter.x;
    originMinCross = Math.min(originMinCross, originCross - halfCross);
    originMaxCross = Math.max(originMaxCross, originCross + halfCross);
    originMinFlow = Math.min(originMinFlow, originFlow - halfFlow);
    originMaxFlow = Math.max(originMaxFlow, originFlow + halfFlow);
  });

  const crossRecenter =
    (originMinCross + originMaxCross) / 2 - (minCross + maxCross) / 2;
  const flowRecenter =
    (originMinFlow + originMaxFlow) / 2 - (minFlow + maxFlow) / 2;

  const translations = new Map<string, TidyTranslation>();

  nodes.forEach((node, index) => {
    const { cross, flow } = placement.get(index)!;
    const crossDelta = cross + crossRecenter - crossOf(node);
    const flowDelta =
      flow + flowRecenter - (down ? node.originCenter.y : node.originCenter.x);
    const translation = {
      x: Math.round(down ? crossDelta : flowDelta),
      y: Math.round(down ? flowDelta : crossDelta),
    };

    if (translation.x === 0 && translation.y === 0) {
      return;
    }

    for (const element of node.elements) {
      translations.set(element.id, translation);
    }
  });

  return translations;
};

/**
 * Applies {@link computeTidyLayout} to the scene, moving each cluster and
 * letting the binding machinery re-route the arrows that connect them.
 *
 * Returns the elements that were moved.
 */
export const tidyElements = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  scene: Scene,
  appState: AppStateSlice,
  options: TidyLayoutOptions = {},
): NonDeletedExcalidrawElement[] => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const translations = computeTidyLayout(
    selectedElements,
    elementsMap,
    appState,
    options,
  );

  if (translations.size === 0) {
    return [];
  }

  const moved: NonDeletedExcalidrawElement[] = [];

  for (const element of elementsMap.values()) {
    const translation = translations.get(element.id);
    if (!translation) {
      continue;
    }
    moved.push(
      scene.mutateElement(element, {
        x: element.x + translation.x,
        y: element.y + translation.y,
      }),
    );
  }

  // re-route afterwards so every binding sees the final positions
  for (const element of moved) {
    updateBoundElements(element, scene, { simultaneouslyUpdated: moved });
  }

  return moved;
};

/**
 * Number of pairs of selected clusters whose bounding boxes overlap. Used to
 * assert that tidying actually untangles a diagram.
 */
export const countOverlappingClusters = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  appState: AppStateSlice,
): number => {
  const boxes = buildClusters(selectedElements, elementsMap, appState)
    .filter((cluster) => !isConnector(cluster.elements))
    .map((cluster) => getCommonBounds(cluster.elements, elementsMap));

  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [aMinX, aMinY, aMaxX, aMaxY] = boxes[i];
      const [bMinX, bMinY, bMaxX, bMaxY] = boxes[j];
      if (aMinX < bMaxX && bMinX < aMaxX && aMinY < bMaxY && bMinY < aMaxY) {
        overlaps++;
      }
    }
  }

  return overlaps;
};
