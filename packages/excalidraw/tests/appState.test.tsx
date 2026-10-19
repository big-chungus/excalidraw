import React from "react";

import {
  DEFAULT_GRID_SIZE,
  DEFAULT_GRID_STEP,
  EXPORT_DATA_TYPES,
  MIME_TYPES,
} from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { clearAppStateForLocalStorage, getDefaultAppState } from "../appState";
import { serializeAsJSON } from "../data/json";
import { restoreAppState } from "../data/restore";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { fireEvent, queryByTestId, render, waitFor } from "./test-utils";

const { h } = window;

describe("appState", () => {
  it("drag&drop file doesn't reset non-persisted appState", async () => {
    const defaultAppState = getDefaultAppState();
    const exportBackground = !defaultAppState.exportBackground;

    await render(
      <Excalidraw
        initialData={{
          appState: {
            exportBackground,
            viewBackgroundColor: "#F00",
          },
        }}
      />,
      {},
    );

    await waitFor(() => {
      expect(h.state.exportBackground).toBe(exportBackground);
      expect(h.state.viewBackgroundColor).toBe("#F00");
    });

    await API.drop([
      {
        kind: "file",
        file: new Blob(
          [
            JSON.stringify({
              type: EXPORT_DATA_TYPES.excalidraw,
              appState: {
                viewBackgroundColor: "#000",
              },
              elements: [API.createElement({ type: "rectangle", id: "A" })],
            }),
          ],
          { type: MIME_TYPES.json },
        ),
      },
    ]);

    await waitFor(() => {
      expect(h.elements).toEqual([expect.objectContaining({ id: "A" })]);
      // non-imported prop → retain
      expect(h.state.exportBackground).toBe(exportBackground);
      // imported prop → overwrite
      expect(h.state.viewBackgroundColor).toBe("#000");
    });
  });

  it("changing fontSize with text tool selected (no element created yet)", async () => {
    const { container } = await render(
      <Excalidraw
        initialData={{
          appState: {
            currentItemFontSize: 30,
          },
        }}
      />,
    );

    UI.clickTool("text");

    expect(h.state.currentItemFontSize).toBe(30);
    fireEvent.click(queryByTestId(container, "fontSize-small")!);
    expect(h.state.currentItemFontSize).toBe(16);

    const mouse = new Pointer("mouse");

    mouse.clickAt(100, 100);

    expect((h.elements[0] as ExcalidrawTextElement).fontSize).toBe(16);
  });

  describe("grid size and step", () => {
    it("persist to local storage and restore on reload", () => {
      const stored = clearAppStateForLocalStorage({
        ...getDefaultAppState(),
        gridSize: 40,
        gridStep: 10,
        gridModeEnabled: true,
      });

      expect(stored).toMatchObject({
        gridSize: 40,
        gridStep: 10,
        gridModeEnabled: true,
      });

      const localAppState = JSON.parse(JSON.stringify(stored));

      expect(restoreAppState(localAppState, null)).toMatchObject({
        gridSize: 40,
        gridStep: 10,
        gridModeEnabled: true,
      });
    });

    it("keep local values when imported scene has no grid settings", () => {
      const restored = restoreAppState(
        { viewBackgroundColor: "#000" },
        { gridSize: 40, gridStep: 10 },
      );
      expect(restored.gridSize).toBe(40);
      expect(restored.gridStep).toBe(10);
    });

    it("round-trip through .excalidraw file export", () => {
      const json = serializeAsJSON(
        [],
        { ...getDefaultAppState(), gridSize: 40, gridStep: 10 },
        {},
        "local",
      );
      const { appState } = JSON.parse(json);

      expect(appState).toMatchObject({ gridSize: 40, gridStep: 10 });

      const restored = restoreAppState(appState, null);
      expect(restored.gridSize).toBe(40);
      expect(restored.gridStep).toBe(10);
    });

    it("clamp out-of-range values on restore", () => {
      expect(
        restoreAppState({ gridSize: 500, gridStep: 1000 }, null),
      ).toMatchObject({ gridSize: 100, gridStep: 100 });
      expect(
        restoreAppState({ gridSize: 0, gridStep: -5 }, null),
      ).toMatchObject({ gridSize: 1, gridStep: 1 });
      expect(
        restoreAppState({ gridSize: 40.4, gridStep: 9.6 }, null),
      ).toMatchObject({ gridSize: 40, gridStep: 10 });
    });

    it("fall back to defaults for invalid values on restore", () => {
      for (const invalid of [NaN, Infinity, "40", null, undefined]) {
        expect(
          restoreAppState(
            { gridSize: invalid, gridStep: invalid } as any,
            null,
          ),
        ).toMatchObject({
          gridSize: DEFAULT_GRID_SIZE,
          gridStep: DEFAULT_GRID_STEP,
        });
      }
    });
  });
});
