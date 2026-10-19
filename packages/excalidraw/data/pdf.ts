import { MIME_TYPES, arrayToMap } from "@excalidraw/common";

import {
  getElementsOverlappingFrame,
  getFrameLikeElements,
} from "@excalidraw/element";

import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { t } from "../i18n";
import { exportToCanvas, exportToSvg } from "../scene/export";

import type { AppState, BinaryFiles } from "../types";
import type { jsPDF } from "jspdf";

/** CSS px are 1/96in, PDF points are 1/72in */
const PX_TO_PT = 72 / 96;

/** minimum scale used when a page has to be rasterized */
const RASTER_FALLBACK_SCALE = 3;

/**
 * Orders frames like text on a page: rows top to bottom, and frames within a
 * row left to right. A frame joins the current row when its top edge sits
 * above the vertical midpoint of the row's first frame, so slightly misaligned
 * frames laid out side by side still read as one row.
 */
export const sortFramesInReadingOrder = <T extends ExcalidrawFrameLikeElement>(
  frames: readonly T[],
): T[] => {
  const rows: T[][] = [];

  for (const frame of [...frames].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && frame.y < row[0].y + row[0].height / 2) {
      row.push(frame);
    } else {
      rows.push([frame]);
    }
  }

  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
};

/**
 * Exports every frame in `elements` as one PDF page, sized to the frame and
 * ordered by `sortFramesInReadingOrder`. Pages are rendered as vector via
 * SVG, falling back to a high-DPI raster for pages svg2pdf can't convert.
 */
export const exportFramesToPdf = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
  {
    exportBackground,
    viewBackgroundColor,
    exportingFrame = null,
  }: {
    exportBackground: boolean;
    viewBackgroundColor: string;
    exportingFrame?: NonDeleted<ExcalidrawFrameLikeElement> | null;
  },
): Promise<Blob> => {
  const frames = exportingFrame
    ? [exportingFrame]
    : sortFramesInReadingOrder(
        getFrameLikeElements(
          elements,
        ) as NonDeleted<ExcalidrawFrameLikeElement>[],
      );

  if (!frames.length) {
    throw new Error(t("alerts.cannotExportPdfWithoutFrames"));
  }

  const [{ jsPDF }] = await Promise.all([
    import("jspdf"),
    // registers `jsPDF.prototype.svg`
    import("svg2pdf.js"),
  ]);

  const elementsMap = arrayToMap(elements);
  let doc: jsPDF | null = null;

  for (const frame of frames) {
    const frameElements = getElementsOverlappingFrame(
      elements,
      frame,
      elementsMap,
    );
    const width = frame.width * PX_TO_PT;
    const height = frame.height * PX_TO_PT;
    // jsPDF swaps the dimensions if they disagree with the orientation
    const format: [number, number] = [width, height];
    const orientation = width > height ? "landscape" : "portrait";

    if (doc) {
      doc.addPage(format, orientation);
    } else {
      doc = new jsPDF({ unit: "pt", format, orientation, compress: true });
    }

    try {
      const svg = await exportToSvg(
        frameElements,
        {
          exportBackground,
          viewBackgroundColor,
          exportWithDarkMode: appState.exportWithDarkMode,
          exportEmbedScene: false,
          frameRendering: appState.frameRendering,
        },
        files,
        {
          exportingFrame: frame,
          // svg2pdf can't use @font-face, and inlining is expensive
          skipInliningFonts: true,
          // svg2pdf resolves <image> more reliably than <use> to a <symbol>
          reuseImages: false,
        },
      );
      await doc.svg(svg, { x: 0, y: 0, width, height });
    } catch (error: any) {
      console.warn(
        `PDF export: rasterizing frame "${frame.id}" (vector failed)`,
        error,
      );
      // drop anything svg2pdf drew before failing
      doc.deletePage(doc.getNumberOfPages());
      doc.addPage(format, orientation);

      const canvas = await exportToCanvas(
        frameElements,
        {
          ...appState,
          exportScale: Math.max(appState.exportScale, RASTER_FALLBACK_SCALE),
        },
        files,
        { exportBackground, viewBackgroundColor, exportingFrame: frame },
      );
      doc.addImage(canvas, "PNG", 0, 0, width, height);
    }
  }

  return new Blob([doc!.output("arraybuffer")], { type: MIME_TYPES.pdf });
};
