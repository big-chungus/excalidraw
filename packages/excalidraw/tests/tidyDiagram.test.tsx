import { pointFrom } from "@excalidraw/math";
import { CaptureUpdateAction } from "@excalidraw/element";
import { KEYS } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  FixedPointBinding,
} from "@excalidraw/element/types";

import {
  actionCancelTidyDiagram,
  actionConfirmTidyDiagram,
  actionTidyDiagram,
} from "../actions/actionTidyDiagram";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import {
  fireEvent,
  render,
  screen,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

const bindingTo = (id: string): FixedPointBinding => ({
  elementId: id,
  fixedPoint: [0.5, 0.5],
  mode: "orbit",
});

/** three overlapping boxes wired as a → b → c */
const createMessyFlowchart = () => {
  const a = API.createElement({
    id: "a",
    x: 0,
    y: 0,
    width: 120,
    height: 60,
    boundElements: [{ id: "ab", type: "arrow" }],
  });
  const b = API.createElement({
    id: "b",
    x: 20,
    y: 20,
    width: 120,
    height: 60,
    boundElements: [
      { id: "ab", type: "arrow" },
      { id: "bc", type: "arrow" },
    ],
  });
  const c = API.createElement({
    id: "c",
    x: 40,
    y: 40,
    width: 120,
    height: 60,
    boundElements: [{ id: "bc", type: "arrow" }],
  });
  const ab = API.createElement({
    type: "arrow",
    id: "ab",
    x: 60,
    y: 30,
    points: [pointFrom(0, 0), pointFrom(20, 20)],
    startBinding: bindingTo("a"),
    endBinding: bindingTo("b"),
  });
  const bc = API.createElement({
    type: "arrow",
    id: "bc",
    x: 80,
    y: 50,
    points: [pointFrom(0, 0), pointFrom(20, 20)],
    startBinding: bindingTo("b"),
    endBinding: bindingTo("c"),
  });

  const elements = [a, b, c, ab, bc];

  API.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  API.setSelectedElements([a, b, c, ab, bc]);

  return { a, b, c, ab, bc };
};

const positionsOf = (ids: string[]) =>
  ids.map((id) => {
    const element = h.app.scene.getNonDeletedElementsMap().get(id)!;
    return { id, x: element.x, y: element.y };
  });

const elementById = (id: string) =>
  h.app.scene.getNonDeletedElementsMap().get(id) as ExcalidrawElement;

describe("tidy diagram", () => {
  beforeEach(async () => {
    unmountComponent();
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("is unavailable until at least two elements are selected", () => {
    const { a } = createMessyFlowchart();

    API.setSelectedElements([a]);
    expect(
      actionTidyDiagram.predicate!(h.elements, h.state, h.app.props, h.app),
    ).toBe(false);

    API.setSelectedElements([elementById("a"), elementById("b")] as ReturnType<
      typeof API.createElement
    >[]);
    expect(
      actionTidyDiagram.predicate!(h.elements, h.state, h.app.props, h.app),
    ).toBe(true);
  });

  it("previews without touching history and applies as a single undo step", () => {
    createMessyFlowchart();

    const before = positionsOf(["a", "b", "c"]);
    const undoStackSize = API.getUndoStack().length;

    API.executeAction(actionTidyDiagram);

    expect(positionsOf(["a", "b", "c"])).not.toEqual(before);
    // the preview is pending — nothing to undo yet
    expect(API.getUndoStack().length).toBe(undoStackSize);

    const previewed = positionsOf(["a", "b", "c"]);

    API.executeAction(actionConfirmTidyDiagram);

    expect(positionsOf(["a", "b", "c"])).toEqual(previewed);
    expect(API.getUndoStack().length).toBe(undoStackSize + 1);

    Keyboard.undo();

    expect(positionsOf(["a", "b", "c"])).toEqual(before);
  });

  it("restores the original layout when the preview is cancelled", () => {
    createMessyFlowchart();

    const before = positionsOf(["a", "b", "c", "ab", "bc"]);
    const arrowPointsBefore = (elementById("ab") as any).points.map(
      (point: readonly number[]) => [...point],
    );
    const undoStackSize = API.getUndoStack().length;

    API.executeAction(actionTidyDiagram);
    expect(positionsOf(["a", "b", "c"])).not.toEqual(before.slice(0, 3));

    API.executeAction(actionCancelTidyDiagram);

    expect(positionsOf(["a", "b", "c", "ab", "bc"])).toEqual(before);
    expect((elementById("ab") as any).points).toEqual(arrowPointsBefore);
    expect(API.getUndoStack().length).toBe(undoStackSize);
  });

  it("keeps bound arrows attached and re-routes them to the new positions", () => {
    createMessyFlowchart();

    API.executeAction(actionTidyDiagram);
    API.executeAction(actionConfirmTidyDiagram);

    const arrow = elementById("ab") as any;
    const a = elementById("a");
    const b = elementById("b");

    expect(arrow.startBinding?.elementId).toBe("a");
    expect(arrow.endBinding?.elementId).toBe("b");

    const start = {
      x: arrow.x + arrow.points[0][0],
      y: arrow.y + arrow.points[0][1],
    };
    const end = {
      x: arrow.x + arrow.points[arrow.points.length - 1][0],
      y: arrow.y + arrow.points[arrow.points.length - 1][1],
    };

    const near = (
      point: { x: number; y: number },
      element: ExcalidrawElement,
      margin = 40,
    ) =>
      point.x >= element.x - margin &&
      point.x <= element.x + element.width + margin &&
      point.y >= element.y - margin &&
      point.y <= element.y + element.height + margin;

    expect(near(start, a)).toBe(true);
    expect(near(end, b)).toBe(true);
  });

  it("shows a confirm/cancel preview bar that can discard the layout", async () => {
    createMessyFlowchart();
    const before = positionsOf(["a", "b", "c"]);

    API.executeAction(actionTidyDiagram);

    expect(screen.queryByLabelText("Keep layout")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Discard layout"));

    await waitFor(() => {
      expect(screen.queryByLabelText("Keep layout")).toBeNull();
    });
    expect(positionsOf(["a", "b", "c"])).toEqual(before);
  });

  it("discards the preview on Escape and keeps it on Enter", () => {
    createMessyFlowchart();
    const before = positionsOf(["a", "b", "c"]);

    API.executeAction(actionTidyDiagram);
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(positionsOf(["a", "b", "c"])).toEqual(before);

    API.executeAction(actionTidyDiagram);
    const previewed = positionsOf(["a", "b", "c"]);
    Keyboard.keyPress(KEYS.ENTER);

    expect(positionsOf(["a", "b", "c"])).toEqual(previewed);
    expect(screen.queryByLabelText("Keep layout")).toBeNull();
  });

  it("produces the same layout every time it runs on the same scene", () => {
    createMessyFlowchart();

    API.executeAction(actionTidyDiagram);
    const first = positionsOf(["a", "b", "c"]);
    API.executeAction(actionCancelTidyDiagram);

    API.executeAction(actionTidyDiagram);

    expect(positionsOf(["a", "b", "c"])).toEqual(first);
  });
});
