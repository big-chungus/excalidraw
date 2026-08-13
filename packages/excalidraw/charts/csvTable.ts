import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_VERTICAL_ALIGN,
  FONT_FAMILY,
  FONT_SIZES,
  getFontString,
  getLineHeight,
  randomId,
} from "@excalidraw/common";

import {
  measureText,
  newTextElement,
  normalizeText,
  wrapText,
} from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  FontFamilyValues,
} from "@excalidraw/element/types";

import { tryParseNumber } from "./charts.parse";

const CELL_PADDING = 10;
/** Cap per-column content width so pasted tables stay readable. */
const MAX_COLUMN_WIDTH = 400;

export type CsvTableStyleSource = {
  currentItemStrokeColor: string;
  currentItemBackgroundColor: string;
  currentItemFillStyle: ExcalidrawTextElement["fillStyle"];
  currentItemStrokeStyle: ExcalidrawTextElement["strokeStyle"];
  currentItemRoughness: number;
  currentItemOpacity: number;
  currentItemFontSize: number;
  currentItemFontFamily: FontFamilyValues;
  strokeWidth: number;
};

const hasHeaderRow = (cells: string[][]) =>
  cells[0].every((cell) => tryParseNumber(cell) === null);

/**
 * Build a grouped grid of text elements from a delimited table.
 * Elements are positioned relative to (0, 0); callers should reposition via
 * addElementsFromPasteOrLibrary.
 */
export const buildCsvTableElements = (
  cells: string[][],
  style: CsvTableStyleSource,
): ExcalidrawTextElement[] => {
  if (cells.length === 0 || cells[0].length === 0) {
    return [];
  }

  const numCols = cells[0].length;
  const groupId = randomId();
  const useHeaderStyle = hasHeaderRow(cells);

  const bodyFontFamily = style.currentItemFontFamily;
  const bodyFontSize = style.currentItemFontSize;
  const headerFontFamily = FONT_FAMILY["Lilita One"];
  const headerFontSize = Math.max(bodyFontSize, FONT_SIZES.md);

  const bodyLineHeight = getLineHeight(bodyFontFamily);
  const headerLineHeight = getLineHeight(headerFontFamily);
  const bodyFontString = getFontString({
    fontSize: bodyFontSize,
    fontFamily: bodyFontFamily,
  });
  const headerFontString = getFontString({
    fontSize: headerFontSize,
    fontFamily: headerFontFamily,
  });

  const getCellFont = (rowIndex: number) => {
    const isHeader = useHeaderStyle && rowIndex === 0;
    return {
      fontFamily: isHeader ? headerFontFamily : bodyFontFamily,
      fontSize: isHeader ? headerFontSize : bodyFontSize,
      lineHeight: isHeader ? headerLineHeight : bodyLineHeight,
      fontString: isHeader ? headerFontString : bodyFontString,
    };
  };

  // First pass: measure unwrapped widths to size columns, then wrap if needed.
  const colContentWidths = Array.from({ length: numCols }, () => 0);
  const preparedCells: {
    originalText: string;
    text: string;
    width: number;
    height: number;
    fontFamily: FontFamilyValues;
    fontSize: number;
    lineHeight: ExcalidrawTextElement["lineHeight"];
    autoResize: boolean;
  }[][] = [];

  for (let r = 0; r < cells.length; r++) {
    const row = cells[r];
    const font = getCellFont(r);
    const preparedRow: typeof preparedCells[number] = [];

    for (let c = 0; c < numCols; c++) {
      const originalText = normalizeText(row[c] ?? "").trim();
      let metrics = measureText(
        originalText.length ? originalText : " ",
        font.fontString,
        font.lineHeight,
      );
      const needsWrap = metrics.width > MAX_COLUMN_WIDTH;
      const text = needsWrap
        ? wrapText(originalText, font.fontString, MAX_COLUMN_WIDTH)
        : originalText;
      if (needsWrap) {
        metrics = measureText(text, font.fontString, font.lineHeight);
      }

      colContentWidths[c] = Math.max(
        colContentWidths[c],
        Math.min(metrics.width, MAX_COLUMN_WIDTH),
      );

      preparedRow.push({
        originalText,
        text,
        width: metrics.width,
        height: metrics.height,
        fontFamily: font.fontFamily,
        fontSize: font.fontSize,
        lineHeight: font.lineHeight,
        autoResize: !needsWrap,
      });
    }
    preparedCells.push(preparedRow);
  }

  const colWidths = colContentWidths.map((width) => width + CELL_PADDING);

  const elements: ExcalidrawTextElement[] = [];
  let currentY = 0;

  for (let r = 0; r < preparedCells.length; r++) {
    const row = preparedCells[r];
    const rowHeight = Math.max(...row.map((cell) => cell.height));
    let currentX = 0;

    for (let c = 0; c < numCols; c++) {
      const cell = row[c];
      elements.push(
        newTextElement({
          x: currentX,
          y: currentY,
          strokeColor: style.currentItemStrokeColor,
          backgroundColor: style.currentItemBackgroundColor,
          fillStyle: style.currentItemFillStyle,
          strokeWidth: style.strokeWidth,
          strokeStyle: style.currentItemStrokeStyle,
          roundness: null,
          roughness: style.currentItemRoughness,
          opacity: style.currentItemOpacity,
          text: cell.text,
          originalText: cell.originalText,
          fontSize: cell.fontSize,
          fontFamily: cell.fontFamily,
          textAlign: DEFAULT_TEXT_ALIGN,
          verticalAlign: DEFAULT_VERTICAL_ALIGN,
          lineHeight: cell.lineHeight,
          autoResize: cell.autoResize,
          locked: false,
          groupIds: [groupId],
        }),
      );
      currentX += colWidths[c] + CELL_PADDING;
    }

    currentY += rowHeight + CELL_PADDING;
  }

  return elements;
};

/** Whether a delimited grid should be rendered as a canvas table. */
export const isCsvTableGrid = (cells: string[][]): boolean =>
  cells.length >= 2 && cells[0].length >= 2;
