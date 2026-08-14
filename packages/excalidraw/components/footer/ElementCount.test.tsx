import { queryByTestId } from "@testing-library/react";
import React from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { actionDeleteSelected } from "../../actions";
import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { Keyboard, UI } from "../../tests/helpers/ui";
import { render } from "../../tests/test-utils";

import { getSceneElementCount } from "./ElementCount";

const element = (
  overrides: Partial<ExcalidrawElement> &
    Pick<ExcalidrawElement, "type" | "isDeleted">,
) => overrides as ExcalidrawElement;

describe("getSceneElementCount", () => {
  it("counts current scene elements", () => {
    expect(
      getSceneElementCount([
        element({ type: "rectangle", isDeleted: false }),
        element({ type: "ellipse", isDeleted: false }),
      ]),
    ).toBe(2);
  });

  it("does not count deleted elements", () => {
    expect(
      getSceneElementCount([
        element({ type: "rectangle", isDeleted: false }),
        element({ type: "ellipse", isDeleted: true }),
      ]),
    ).toBe(1);
  });

  it("does not count selection helpers", () => {
    expect(
      getSceneElementCount([
        element({ type: "rectangle", isDeleted: false }),
        element({ type: "selection", isDeleted: false }),
      ]),
    ).toBe(1);
  });
});

describe("element count status bar", () => {
  it("updates on add, delete, undo, and redo", async () => {
    const { container } = await render(<Excalidraw handleKeyboardGlobally />);
    const readout = () => queryByTestId(container, "element-count");

    expect(readout()).toHaveTextContent("0 elements");

    UI.createElement("rectangle");
    expect(readout()).toHaveTextContent("1 elements");

    UI.createElement("ellipse");
    expect(readout()).toHaveTextContent("2 elements");

    API.executeAction(actionDeleteSelected);
    expect(readout()).toHaveTextContent("1 elements");

    Keyboard.undo();
    expect(readout()).toHaveTextContent("2 elements");

    Keyboard.redo();
    expect(readout()).toHaveTextContent("1 elements");
  });

  it("does not count deleted elements in the scene", async () => {
    const { container } = await render(<Excalidraw />);

    API.setElements([
      API.createElement({ type: "rectangle" }),
      API.createElement({ type: "diamond", isDeleted: true }),
    ]);

    expect(queryByTestId(container, "element-count")).toHaveTextContent(
      "1 elements",
    );
  });
});
