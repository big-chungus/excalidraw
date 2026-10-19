import React from "react";
import { vi } from "vitest";

import { Excalidraw } from "../index";
import * as sceneExport from "../scene/export";

import { API } from "./helpers/api";
import {
  fireEvent,
  queryByTestId,
  render,
  toggleMenu,
  waitFor,
} from "./test-utils";

vi.mock("../clipboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../clipboard")>();
  return {
    ...actual,
    probablySupportsClipboardBlob: true,
    copyBlobToClipboardAsPng: vi.fn().mockResolvedValue(undefined),
  };
});

const { h } = window;

describe("image export dialog — copy PNG background", () => {
  it("uses the dialog Background toggle for clipboard export even if appState is stale", async () => {
    const exportToCanvasSpy = vi.spyOn(sceneExport, "exportToCanvas");

    const { container } = await render(
      <Excalidraw
        initialData={{
          elements: [
            API.createElement({
              type: "rectangle",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            }),
          ],
          appState: {
            exportBackground: true,
            viewBackgroundColor: "#ffffff",
          },
        }}
      />,
    );

    toggleMenu(container);
    fireEvent.click(queryByTestId(container, "image-export-button")!);
    await waitFor(() => {
      expect(document.querySelector(".ImageExportModal")).not.toBe(null);
    });

    vi.spyOn(h.app.actionManager, "executeAction").mockImplementation(
      () => undefined,
    );

    const backgroundSwitch = document.querySelector(
      'input[name="exportBackgroundSwitch"]',
    ) as HTMLInputElement;
    expect(backgroundSwitch.checked).toBe(true);
    fireEvent.click(backgroundSwitch);
    expect(backgroundSwitch.checked).toBe(false);
    // live appState still has the default — the action was mocked out, which
    // is the stale-state case Copy used to read from
    expect(h.state.exportBackground).toBe(true);

    exportToCanvasSpy.mockClear();

    fireEvent.click(
      document.querySelector(
        'button[aria-label="Copy PNG to clipboard"]',
      ) as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(exportToCanvasSpy).toHaveBeenCalled();
    });

    const exportOpts = exportToCanvasSpy.mock.calls.at(-1)?.[3];
    expect(exportOpts?.exportBackground).toBe(false);
  });
});
