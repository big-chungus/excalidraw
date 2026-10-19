import { getDefaultAppState } from "../appState";
import { API } from "../tests/helpers/api";

import { exportFramesToPdf, sortFramesInReadingOrder } from "./pdf";

import type { AppState } from "../types";

const PX_TO_PT = 72 / 96;

const readBlobAsText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

const getPageSizes = (pdf: string) =>
  [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(
    ([, width, height]) => [Number(width), Number(height)],
  );

describe("sortFramesInReadingOrder", () => {
  it("orders frames left to right, then top to bottom", () => {
    const topRight = API.createElement({ type: "frame", x: 500, y: 0 });
    // slightly lower than its row neighbour, still on the first row
    const topLeft = API.createElement({ type: "frame", x: 0, y: 20 });
    const bottom = API.createElement({ type: "frame", x: 0, y: 400 });

    expect(
      sortFramesInReadingOrder([bottom, topRight, topLeft]).map((f) => f.id),
    ).toEqual([topLeft.id, topRight.id, bottom.id]);
  });
});

describe("exportFramesToPdf", () => {
  const appState: AppState = {
    ...getDefaultAppState(),
    width: 1000,
    height: 1000,
    offsetLeft: 0,
    offsetTop: 0,
  } as AppState;

  it("exports one page per frame in reading order", async () => {
    // distinct sizes so each page can be matched back to its frame
    const first = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    const second = API.createElement({
      type: "frame",
      x: 600,
      y: 0,
      width: 300,
      height: 300,
    });
    const third = API.createElement({
      type: "frame",
      x: 0,
      y: 500,
      width: 200,
      height: 600,
    });
    const insideSecond = API.createElement({
      type: "rectangle",
      x: 650,
      y: 50,
      width: 100,
      height: 100,
      frameId: second.id,
    });
    const outsideFrames = API.createElement({
      type: "ellipse",
      x: 2000,
      y: 2000,
      width: 100,
      height: 100,
    });

    const blob = await exportFramesToPdf(
      [third, insideSecond, outsideFrames, second, first],
      appState,
      {},
      { exportBackground: true, viewBackgroundColor: "#ffffff" },
    );

    expect(blob.type).toBe("application/pdf");

    const pdf = await readBlobAsText(blob);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toMatch(/\/Type \/Pages\s*\/Kids \[[^\]]*\]\s*\/Count 3/);
    expect(getPageSizes(pdf)).toEqual(
      [first, second, third].map((frame) => [
        frame.width * PX_TO_PT,
        frame.height * PX_TO_PT,
      ]),
    );
  });

  it("throws when there are no frames", async () => {
    await expect(
      exportFramesToPdf(
        [API.createElement({ type: "rectangle" })],
        appState,
        {},
        { exportBackground: true, viewBackgroundColor: "#ffffff" },
      ),
    ).rejects.toThrow("Add at least one frame to export as PDF.");
  });
});
