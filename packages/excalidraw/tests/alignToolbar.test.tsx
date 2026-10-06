import React from "react";

import { defaultLang, setLanguage } from "../i18n";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import {
  fireEvent,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  unmountComponent,
} from "./test-utils";

const h = window.h;

const toolbarAlign = () =>
  document.querySelector<HTMLElement>(
    ".App-toolbar [data-testid='toolbar-align']",
  );

const alignButton = (label: string) =>
  toolbarAlign()?.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) ??
  null;

const selectMixedShapes = () => {
  const rectangle = API.createElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 80,
  });
  const ellipse = API.createElement({
    type: "ellipse",
    x: 180,
    y: 40,
    width: 60,
    height: 40,
  });
  const diamond = API.createElement({
    type: "diamond",
    x: 40,
    y: 160,
    width: 50,
    height: 90,
  });
  API.setElements([rectangle, ellipse, diamond]);
  API.setSelectedElements([rectangle, ellipse, diamond]);
  return { rectangle, ellipse, diamond };
};

describe("toolbar align", () => {
  beforeEach(async () => {
    unmountComponent();
    await setLanguage(defaultLang);
    // jsdom reports a 0-size container, which the editor treats as a phone.
    mockBoundingClientRect({ width: 1920, height: 1080 });
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    expect(h.app.editorInterface.formFactor).toBe("desktop");
  });

  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
  });

  it("enables align left / center / right only for a multi-select", async () => {
    expect(toolbarAlign()).toBeNull();

    const rectangle = API.createElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    expect(toolbarAlign()).toBeNull();

    selectMixedShapes();

    const root = toolbarAlign();
    expect(root).not.toBeNull();
    for (const label of ["Align left", "Center horizontally", "Align right"]) {
      const button = alignButton(label);
      expect(button).not.toBeNull();
      expect(button).toBeEnabled();
    }
  });

  it("aligns mixed shapes to the selection bounding box and undo restores positions", () => {
    const rectangle = UI.createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
    const ellipse = UI.createElement("ellipse", {
      x: 180,
      y: 40,
      width: 60,
      height: 40,
    });
    const diamond = UI.createElement("diamond", {
      x: 40,
      y: 160,
      width: 50,
      height: 90,
    });
    const shapes = [rectangle, ellipse, diamond];
    const selectShapes = () => {
      API.setAppState({
        selectedElementIds: {
          [rectangle.id]: true,
          [ellipse.id]: true,
          [diamond.id]: true,
        },
      });
    };
    selectShapes();
    const original = shapes.map((element) => ({
      id: element.id,
      x: element.x,
      y: element.y,
      width: element.width,
    }));
    const minX = Math.min(...original.map((element) => element.x));
    const maxX = Math.max(
      ...original.map((element) => element.x + element.width),
    );
    const centerX = (minX + maxX) / 2;

    const click = (label: string) => {
      const button = alignButton(label);
      expect(button).not.toBeNull();
      fireEvent.click(button!);
    };

    const expectRestored = () => {
      for (const element of original) {
        const current = h.elements.find(({ id }) => id === element.id);
        expect(current?.x).toBe(element.x);
        expect(current?.y).toBe(element.y);
      }
    };

    click("Align left");
    for (const element of shapes) {
      expect(element.x).toBe(minX);
      expect(element.y).toBe(
        original.find((item) => item.id === element.id)!.y,
      );
    }

    Keyboard.undo();
    expectRestored();
    selectShapes();

    click("Center horizontally");
    for (const element of shapes) {
      expect(element.x + element.width / 2).toBe(centerX);
    }

    Keyboard.undo();
    expectRestored();
    selectShapes();

    click("Align right");
    for (const element of shapes) {
      expect(element.x + element.width).toBe(maxX);
    }

    Keyboard.undo();
    expectRestored();
  });
});
