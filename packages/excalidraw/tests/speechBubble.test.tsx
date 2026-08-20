import { ROUNDNESS } from "@excalidraw/common";
import type {
  ExcalidrawSpeechBubbleElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";
import * as exportUtils from "../scene/export";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { fireEvent, render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

describe("speech bubble", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw />);
  });

  it("creates a first-class element from the toolbar", () => {
    const tool = document.querySelector(
      '[data-testid="toolbar-speechBubble"]',
    )!;
    fireEvent.click(tool);

    mouse.downAt(30, 20);
    mouse.moveTo(230, 140);
    mouse.upAt(230, 140);

    expect(h.elements).toHaveLength(1);
    expect(h.elements[0]).toMatchObject({
      type: "speechBubble",
      x: 30,
      y: 20,
      width: 200,
      height: 120,
    });
  });

  it("binds and wraps text on double click", async () => {
    const bubble = API.createElement({
      type: "speechBubble",
      x: 100,
      y: 100,
      width: 180,
      height: 120,
    });
    API.setElements([bubble]);

    mouse.doubleClickAt(190, 140);
    const editor = await getTextEditor();
    updateTextEditor(
      editor,
      "Speech bubbles wrap text inside their rounded body.",
    );
    Keyboard.exitTextEditor(editor);

    const text = h.elements.find(
      (element) => element.type === "text",
    ) as ExcalidrawTextElement;
    expect(text.containerId).toBe(bubble.id);
    expect(text.text).toContain("\n");
    expect(text.height).toBeLessThanOrEqual(bubble.height * 0.78);
  });

  it("restores and exports the bubble shape", async () => {
    const bubble = API.createElement({
      type: "speechBubble",
      x: 10,
      y: 20,
      width: 200,
      height: 120,
      backgroundColor: "#ffc9c9",
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    }) as ExcalidrawSpeechBubbleElement;

    const restored = restoreElements([bubble], null);
    expect(restored[0]).toMatchObject({
      type: "speechBubble",
      width: 200,
      height: 120,
    });

    const svg = await exportUtils.exportToSvg(
      restored as NonDeletedExcalidrawElement[],
      {
        exportBackground: false,
        viewBackgroundColor: "#ffffff",
        files: {},
      },
      null,
    );
    const renderedBubble = svg.querySelector(`[data-id="${bubble.id}"]`);
    expect(renderedBubble).not.toBeNull();
    expect(renderedBubble?.querySelector("path")).not.toBeNull();
  });
});
