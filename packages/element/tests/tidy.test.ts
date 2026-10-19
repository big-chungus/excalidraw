import { arrayToMap } from "@excalidraw/common";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  DEFAULT_TIDY_NODE_GAP,
  canTidyElements,
  computeTidyLayout,
  countOverlappingClusters,
} from "../src/tidy";

import type { TidyTranslation } from "../src/tidy";
import type {
  FixedPointBinding,
  NonDeletedExcalidrawElement,
} from "../src/types";

const appState = { selectedGroupIds: {}, editingGroupId: null };

const bindingTo = (
  element: NonDeletedExcalidrawElement,
): FixedPointBinding => ({
  elementId: element.id,
  fixedPoint: [0.5, 0.5],
  mode: "orbit",
});

const connect = (
  from: NonDeletedExcalidrawElement,
  to: NonDeletedExcalidrawElement,
) =>
  API.createElement({
    type: "arrow",
    startBinding: bindingTo(from),
    endBinding: bindingTo(to),
  });

const translate = (
  elements: NonDeletedExcalidrawElement[],
  translations: Map<string, TidyTranslation>,
) =>
  elements.map((element) => {
    const translation = translations.get(element.id);
    return translation
      ? ({
          ...element,
          x: element.x + translation.x,
          y: element.y + translation.y,
        } as NonDeletedExcalidrawElement)
      : element;
  });

const centerOf = (element: NonDeletedExcalidrawElement) => ({
  x: element.x + element.width / 2,
  y: element.y + element.height / 2,
});

const byId = (elements: NonDeletedExcalidrawElement[], id: string) =>
  elements.find((element) => element.id === id)!;

/**
 * Five boxes piled on top of each other, wired up as a diamond flowchart:
 * a → b, a → c, b → d, c → d, d → e.
 */
const createMessyFlowchart = () => {
  const a = API.createElement({ x: 0, y: 0, width: 120, height: 60 });
  const b = API.createElement({ x: 20, y: 30, width: 120, height: 60 });
  const c = API.createElement({ x: 40, y: 10, width: 120, height: 60 });
  const d = API.createElement({ x: 10, y: 50, width: 120, height: 60 });
  const e = API.createElement({ x: 60, y: 70, width: 120, height: 60 });

  return [
    a,
    b,
    c,
    d,
    e,
    connect(a, b),
    connect(a, c),
    connect(b, d),
    connect(c, d),
    connect(d, e),
  ];
};

describe("computeTidyLayout", () => {
  it("removes box overlaps and layers the flowchart by depth", () => {
    const elements = createMessyFlowchart();
    const [a, b, c, d, e] = elements;
    const elementsMap = arrayToMap(elements);

    expect(
      countOverlappingClusters(elements, elementsMap, appState),
    ).toBeGreaterThan(0);

    const translations = computeTidyLayout(elements, elementsMap, appState, {
      direction: "down",
    });
    const tidied = translate(elements, translations);

    expect(countOverlappingClusters(tidied, arrayToMap(tidied), appState)).toBe(
      0,
    );

    const center = (element: NonDeletedExcalidrawElement) =>
      centerOf(byId(tidied, element.id));

    expect(center(a).y).toBeLessThan(center(b).y);
    expect(center(b).y).toEqual(center(c).y);
    expect(center(c).y).toBeLessThan(center(d).y);
    expect(center(d).y).toBeLessThan(center(e).y);

    // siblings sit side by side with at least the configured gap between them
    expect(Math.abs(center(b).x - center(c).x)).toBeGreaterThanOrEqual(
      120 + DEFAULT_TIDY_NODE_GAP,
    );
  });

  it("keeps the diagram centered where the user left it", () => {
    const elements = createMessyFlowchart();
    const nodes = elements.slice(0, 5);

    const tidied = translate(
      elements,
      computeTidyLayout(elements, arrayToMap(elements), appState, {
        direction: "down",
      }),
    ).slice(0, 5);

    const midpoint = (boxes: NonDeletedExcalidrawElement[]) => ({
      x:
        (Math.min(...boxes.map((box) => box.x)) +
          Math.max(...boxes.map((box) => box.x + box.width))) /
        2,
      y:
        (Math.min(...boxes.map((box) => box.y)) +
          Math.max(...boxes.map((box) => box.y + box.height))) /
        2,
    });

    expect(midpoint(tidied).x).toBeCloseTo(midpoint(nodes).x, 0);
    expect(midpoint(tidied).y).toBeCloseTo(midpoint(nodes).y, 0);
  });

  it("is deterministic for the same input", () => {
    const elements = createMessyFlowchart();
    const elementsMap = arrayToMap(elements);

    const first = computeTidyLayout(elements, elementsMap, appState);
    const second = computeTidyLayout(elements, elementsMap, appState);

    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it("follows the direction the diagram already flows in", () => {
    const a = API.createElement({ x: 0, y: 0, width: 100, height: 100 });
    const b = API.createElement({ x: 320, y: 10, width: 100, height: 100 });
    const c = API.createElement({ x: 640, y: 20, width: 100, height: 100 });
    const elements = [a, b, c, connect(a, b), connect(b, c)];

    const tidied = translate(
      elements,
      computeTidyLayout(elements, arrayToMap(elements), appState),
    );

    expect(centerOf(byId(tidied, a.id)).x).toBeLessThan(
      centerOf(byId(tidied, b.id)).x,
    );
    expect(centerOf(byId(tidied, b.id)).x).toBeLessThan(
      centerOf(byId(tidied, c.id)).x,
    );
    expect(centerOf(byId(tidied, a.id)).y).toEqual(
      centerOf(byId(tidied, c.id)).y,
    );
  });

  it("moves a group as one rigid unit", () => {
    const grouped1 = API.createElement({
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      groupIds: ["group1"],
    });
    const grouped2 = API.createElement({
      x: 40,
      y: 120,
      width: 100,
      height: 60,
      groupIds: ["group1"],
    });
    const other = API.createElement({ x: 10, y: 10, width: 100, height: 60 });
    const elements = [grouped1, grouped2, other];

    const translations = computeTidyLayout(
      elements,
      arrayToMap(elements),
      { selectedGroupIds: { group1: true }, editingGroupId: null },
      { direction: "down" },
    );

    expect(translations.get(grouped1.id)).toEqual(
      translations.get(grouped2.id),
    );
    expect(translations.get(other.id)).not.toEqual(
      translations.get(grouped1.id),
    );
  });

  it("moves a frame together with its children", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    const child = API.createElement({
      x: 20,
      y: 20,
      width: 60,
      height: 60,
      frameId: frame.id,
    });
    const other = API.createElement({ x: 10, y: 10, width: 100, height: 60 });
    const elements = [frame, child, other];

    const translations = computeTidyLayout(
      elements,
      arrayToMap(elements),
      appState,
      { direction: "down" },
    );

    expect(translations.get(child.id)).toEqual(translations.get(frame.id));
  });

  it("keeps disconnected sub-diagrams apart instead of stacking them", () => {
    const a = API.createElement({ x: 0, y: 0, width: 100, height: 60 });
    const b = API.createElement({ x: 5, y: 5, width: 100, height: 60 });
    const c = API.createElement({ x: 10, y: 10, width: 100, height: 60 });
    const elements = [a, b, c, connect(a, b)];

    const tidied = translate(
      elements,
      computeTidyLayout(elements, arrayToMap(elements), appState, {
        direction: "down",
      }),
    );

    expect(countOverlappingClusters(tidied, arrayToMap(tidied), appState)).toBe(
      0,
    );
  });

  it("does nothing when there is less than one box to arrange", () => {
    const a = API.createElement({ x: 0, y: 0, width: 100, height: 60 });
    const arrow = API.createElement({
      type: "arrow",
      startBinding: bindingTo(a),
    });
    const elements = [a, arrow];

    expect(canTidyElements(elements, arrayToMap(elements), appState)).toBe(
      false,
    );
    expect(
      computeTidyLayout(elements, arrayToMap(elements), appState).size,
    ).toBe(0);
  });
});
