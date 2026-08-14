import React from "react";

import { DEFAULT_ELEMENT_PROPS } from "@excalidraw/common";

import { clearAppStateForLocalStorage, getDefaultAppState } from "../appState";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { render, togglePopover } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

describe("session stroke color", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("remembers last stroke color for new shapes and keeps fill independent", async () => {
    UI.clickTool("rectangle");
    togglePopover("Stroke");
    UI.clickOnTestId("color-red");

    expect(h.state.currentItemStrokeColor).toBe("#e03131");

    mouse.reset();
    mouse.down(10, 10);
    mouse.up(40, 40);

    expect(h.elements[0].strokeColor).toBe("#e03131");

    UI.clickTool("ellipse");
    mouse.reset();
    mouse.down(80, 10);
    mouse.up(120, 50);

    expect(h.elements[1].strokeColor).toBe("#e03131");
    expect(h.elements[1].backgroundColor).toBe(
      DEFAULT_ELEMENT_PROPS.backgroundColor,
    );

    togglePopover("Background");
    UI.clickOnTestId("color-blue");

    expect(h.state.currentItemBackgroundColor).toBe("#a5d8ff");
    expect(h.state.currentItemStrokeColor).toBe("#e03131");

    UI.clickTool("diamond");
    mouse.reset();
    mouse.down(10, 80);
    mouse.up(50, 120);

    expect(h.elements[2].strokeColor).toBe("#e03131");
    expect(h.elements[2].backgroundColor).toBe("#a5d8ff");
  });

  it("does not persist stroke color across refresh (session-only)", () => {
    API.setAppState({
      currentItemStrokeColor: "#e03131",
      currentItemBackgroundColor: "#a5d8ff",
    });

    const persisted = clearAppStateForLocalStorage(h.state);

    expect("currentItemStrokeColor" in persisted).toBe(false);
    expect(persisted.currentItemBackgroundColor).toBe("#a5d8ff");

    const afterRefresh = {
      ...getDefaultAppState(),
      ...persisted,
    };

    expect(afterRefresh.currentItemStrokeColor).toBe(
      DEFAULT_ELEMENT_PROPS.strokeColor,
    );
    expect(afterRefresh.currentItemBackgroundColor).toBe("#a5d8ff");
  });
});
