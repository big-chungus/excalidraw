import React from "react";

import { COLOR_PALETTE, DEFAULT_ELEMENT_PROPS } from "@excalidraw/common";

import { clearAppStateForLocalStorage, getDefaultAppState } from "../appState";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { render, togglePopover } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

describe("session fill color", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("remembers last fill color for new shapes and keeps stroke independent", () => {
    UI.clickTool("rectangle");
    togglePopover("Background");
    UI.clickOnTestId("color-blue");

    mouse.reset();
    mouse.down(10, 10);
    mouse.up(40, 40);

    expect(h.elements[0].backgroundColor).toBe("#a5d8ff");
    expect(h.elements[0].strokeColor).toBe(DEFAULT_ELEMENT_PROPS.strokeColor);

    togglePopover("Stroke");
    UI.clickOnTestId("color-red");

    expect(h.state.currentItemBackgroundColor).toBe("#a5d8ff");

    UI.clickTool("ellipse");
    mouse.reset();
    mouse.down(80, 10);
    mouse.up(120, 50);

    expect(h.elements[1].backgroundColor).toBe("#a5d8ff");
    expect(h.elements[1].strokeColor).toBe("#e03131");
  });

  it("remembers transparent as the last fill color", () => {
    API.setAppState({
      currentItemBackgroundColor: "#a5d8ff",
    });

    UI.clickTool("rectangle");
    togglePopover("Background");
    UI.clickOnTestId(`color-${COLOR_PALETTE.transparent}`);

    mouse.reset();
    mouse.down(10, 10);
    mouse.up(40, 40);

    expect(h.state.currentItemBackgroundColor).toBe(COLOR_PALETTE.transparent);
    expect(h.elements[0].backgroundColor).toBe(COLOR_PALETTE.transparent);
  });

  it("does not persist fill color outside the tab session", () => {
    API.setAppState({
      currentItemBackgroundColor: "#a5d8ff",
      currentItemStrokeColor: "#e03131",
    });

    const persisted = clearAppStateForLocalStorage(h.state);

    expect("currentItemBackgroundColor" in persisted).toBe(false);
    expect(persisted.currentItemStrokeColor).toBe("#e03131");

    const afterSession = {
      ...getDefaultAppState(),
      ...persisted,
    };

    expect(afterSession.currentItemBackgroundColor).toBe(
      DEFAULT_ELEMENT_PROPS.backgroundColor,
    );
    expect(afterSession.currentItemStrokeColor).toBe("#e03131");
  });
});
