import { CaptureUpdateAction } from "@excalidraw/element";
import {
  canTidyElements,
  computeTidyLayout,
  tidyElements,
  updateFrameMembershipOfSelectedElements,
} from "@excalidraw/element";
import { isArrowElement } from "@excalidraw/element";
import { arrayToMap } from "@excalidraw/common";

import type {
  ElementUpdate,
  Scene,
  TidyTranslation,
} from "@excalidraw/element";
import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { atom, editorJotaiStore } from "../editor-jotai";
import { MagicIcon } from "../components/icons";

import { register } from "./register";

import type { AppClassProperties, AppState } from "../types";

/**
 * Everything a tidy pass can change: the clusters move, the binding machinery
 * re-points (and for elbow arrows, re-routes) whatever is attached to them and
 * re-fits arrow labels, and frame membership is re-evaluated afterwards.
 */
const PREVIEW_FIELDS = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "points",
  "fixedSegments",
  "text",
  "fontSize",
  "frameId",
] as const;

type PreviewGeometry = Record<typeof PREVIEW_FIELDS[number], unknown>;

export type TidyDiagramPreview = {
  /** pre-tidy geometry, so cancelling restores the scene exactly */
  snapshot: Map<string, PreviewGeometry>;
  /** selection the preview was computed for */
  selectedElementIds: string[];
};

export const tidyDiagramPreviewAtom = atom<TidyDiagramPreview | null>(null);

const captureGeometry = (element: ExcalidrawElement): PreviewGeometry => {
  const source = element as unknown as Record<string, unknown>;
  const geometry = {} as PreviewGeometry;

  for (const field of PREVIEW_FIELDS) {
    const value = source[field];
    if (value === undefined) {
      continue;
    }
    geometry[field] = Array.isArray(value)
      ? value.map((entry) => (Array.isArray(entry) ? [...entry] : entry))
      : value;
  }

  return geometry;
};

/**
 * Snapshots the clusters that will move plus everything bound to them (arrows
 * and their labels), which is the full set of elements a tidy pass can touch.
 */
const captureTidySnapshot = (
  translations: ReadonlyMap<string, TidyTranslation>,
  elementsMap: ElementsMap,
): Map<string, PreviewGeometry> => {
  const ids = new Set<string>();

  const add = (id: string) => {
    const element = elementsMap.get(id);
    if (!element || ids.has(id)) {
      return;
    }
    ids.add(id);
    element.boundElements?.forEach((bound) => add(bound.id));
  };

  translations.forEach((_, id) => add(id));

  const snapshot = new Map<string, PreviewGeometry>();
  for (const id of ids) {
    const element = elementsMap.get(id);
    if (element) {
      snapshot.set(id, captureGeometry(element));
    }
  }

  return snapshot;
};

const restoreTidySnapshot = (
  snapshot: Map<string, PreviewGeometry>,
  scene: Scene,
) => {
  const elementsMap = scene.getNonDeletedElementsMap();
  const entries: [NonDeletedExcalidrawElement, PreviewGeometry][] = [];

  for (const [id, geometry] of snapshot) {
    const element = elementsMap.get(id);
    if (element) {
      entries.push([element, geometry]);
    }
  }

  const restore = ([element, geometry]: typeof entries[number]) =>
    scene.mutateElement(
      element,
      geometry as ElementUpdate<NonDeletedExcalidrawElement>,
    );

  // shapes first: elbow arrow routing is derived from where its anchors sit
  entries.filter(([element]) => !isArrowElement(element)).forEach(restore);
  entries.filter(([element]) => isArrowElement(element)).forEach(restore);
};

export const tidyDiagramPredicate = (
  appState: AppState,
  app: AppClassProperties,
) => {
  const selectedElements = app.scene.getSelectedElements(appState);

  return (
    selectedElements.length >= 2 &&
    canTidyElements(
      selectedElements,
      app.scene.getNonDeletedElementsMap(),
      appState,
    )
  );
};

export const actionTidyDiagram = register({
  name: "tidyDiagram",
  label: "labels.tidyDiagram",
  icon: MagicIcon,
  keywords: ["layout", "arrange", "cleanup", "flowchart", "auto"],
  trackEvent: { category: "element" },
  predicate: (elements, appState, appProps, app) =>
    tidyDiagramPredicate(appState, app),
  perform: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements(appState);
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const translations = computeTidyLayout(
      selectedElements,
      elementsMap,
      appState,
    );

    if (translations.size === 0) {
      return false;
    }

    // taken before mutating, so cancelling can put everything back
    const snapshot = captureTidySnapshot(translations, elementsMap);

    const moved = tidyElements(selectedElements, app.scene, appState);
    const movedMap = arrayToMap(moved);

    app.updateEditorAtom(tidyDiagramPreviewAtom, {
      snapshot,
      selectedElementIds: selectedElements.map((element) => element.id),
    });

    return {
      appState,
      elements: updateFrameMembershipOfSelectedElements(
        elements.map((element) => movedMap.get(element.id) || element),
        appState,
        app,
      ),
      // the preview is deliberately not captured on its own: the confirming
      // action captures it together, so applying costs a single undo step
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
});

export const actionConfirmTidyDiagram = register({
  name: "confirmTidyDiagram",
  label: "labels.tidyDiagramConfirm",
  trackEvent: { category: "element" },
  predicate: () => !!editorJotaiStore.get(tidyDiagramPreviewAtom),
  perform: (elements, appState, _, app) => {
    if (!editorJotaiStore.get(tidyDiagramPreviewAtom)) {
      return false;
    }

    app.updateEditorAtom(tidyDiagramPreviewAtom, null);

    return {
      appState,
      elements,
      // folds the deferred preview into one undoable increment
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});

export const actionCancelTidyDiagram = register({
  name: "cancelTidyDiagram",
  label: "labels.tidyDiagramCancel",
  trackEvent: { category: "element" },
  predicate: () => !!editorJotaiStore.get(tidyDiagramPreviewAtom),
  perform: (elements, appState, _, app) => {
    const preview = editorJotaiStore.get(tidyDiagramPreviewAtom);

    if (!preview) {
      return false;
    }

    restoreTidySnapshot(preview.snapshot, app.scene);
    app.updateEditorAtom(tidyDiagramPreviewAtom, null);

    return {
      appState,
      elements: app.scene.getElementsIncludingDeleted(),
      // the scene is back where it started, so there is nothing to record
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  },
});
