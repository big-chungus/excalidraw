import React from "react";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { GlobalTestState, render, screen } from "./test-utils";

const { h } = window;

const queryElementCount = () =>
  GlobalTestState.renderResult.container.querySelector(
    "[data-testid='element-count']",
  );

describe("footer element count", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("updates after adding, deleting, undo and redo", () => {
    expect(queryElementCount()?.textContent).toBe("0 elements");

    UI.createElement("rectangle", { x: 0, y: 0, size: 20 });
    expect(queryElementCount()?.textContent).toBe("1 element");

    UI.createElement("ellipse", { x: 50, y: 50, size: 20 });
    expect(queryElementCount()?.textContent).toBe("2 elements");

    Keyboard.keyPress(KEYS.DELETE);
    expect(h.elements.filter((el) => el.isDeleted)).toHaveLength(1);
    expect(queryElementCount()?.textContent).toBe("1 element");

    Keyboard.undo();
    expect(queryElementCount()?.textContent).toBe("2 elements");

    Keyboard.redo();
    expect(queryElementCount()?.textContent).toBe("1 element");
  });

  it("counts bound text once with its container", () => {
    const container = API.createElement({ type: "rectangle" });
    const text = API.createElement({
      type: "text",
      containerId: container.id,
    });
    API.setElements([
      { ...container, boundElements: [{ type: "text", id: text.id }] },
      text,
    ]);
    expect(queryElementCount()?.textContent).toBe("1 element");
  });

  it("is hidden in zen mode and view mode", () => {
    UI.createElement("rectangle", { size: 20 });
    expect(screen.getByTestId("element-count")).toBeTruthy();

    API.setAppState({ zenModeEnabled: true });
    expect(queryElementCount()).toBe(null);

    API.setAppState({ zenModeEnabled: false, viewModeEnabled: true });
    expect(queryElementCount()).toBe(null);
  });
});
