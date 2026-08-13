import {
  COLOR_PALETTE,
  FONT_FAMILY,
  TEXT_ALIGN,
  VERTICAL_ALIGN,
  getFontString,
  getLineHeight,
  randomId,
} from "@excalidraw/common";

import {
  convertToExcalidrawElements,
  measureText,
  newElementWith,
  type ExcalidrawElementSkeleton,
} from "@excalidraw/element";

import type {
  FillStyle,
  FontFamilyValues,
  StrokeStyle,
} from "@excalidraw/element/types";

import type { ChartElements, CsvTable } from "./charts.types";

const CELL_PADDING = 16;
const MIN_CELL_WIDTH = 48;

export type RenderCsvTableOpts = {
  x?: number;
  y?: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  fontSize: number;
  fontFamily: FontFamilyValues;
  roughness: number;
  opacity: number;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
};

const measureCell = (
  text: string,
  fontSize: number,
  fontFamily: FontFamilyValues,
) =>
  measureText(
    text || " ",
    getFontString({ fontSize, fontFamily }),
    getLineHeight(fontFamily),
  );

export const renderCsvTable = (
  table: CsvTable,
  opts: RenderCsvTableOpts,
): ChartElements => {
  const originX = opts.x ?? 0;
  const originY = opts.y ?? 0;
  const groupId = randomId();
  const headerFontFamily = table.hasHeader
    ? FONT_FAMILY["Lilita One"]
    : opts.fontFamily;
  const rowCount = table.rows.length;
  const colCount = table.rows[0].length;

  const fontFamilyForRow = (row: number) =>
    table.hasHeader && row === 0 ? headerFontFamily : opts.fontFamily;

  const columnWidths = Array.from({ length: colCount }, (_, col) => {
    let maxWidth = 0;
    for (let row = 0; row < rowCount; row++) {
      maxWidth = Math.max(
        maxWidth,
        measureCell(table.rows[row][col], opts.fontSize, fontFamilyForRow(row))
          .width,
      );
    }
    return Math.max(MIN_CELL_WIDTH, maxWidth + CELL_PADDING * 2);
  });

  const rowHeights = Array.from({ length: rowCount }, (_, row) => {
    let maxHeight = 0;
    for (let col = 0; col < colCount; col++) {
      maxHeight = Math.max(
        maxHeight,
        measureCell(table.rows[row][col], opts.fontSize, fontFamilyForRow(row))
          .height,
      );
    }
    return maxHeight + CELL_PADDING * 2;
  });

  const skeletons: ExcalidrawElementSkeleton[] = [];
  let y = originY;

  for (let row = 0; row < rowCount; row++) {
    let x = originX;
    const isHeader = table.hasHeader && row === 0;

    for (let col = 0; col < colCount; col++) {
      const text = table.rows[row][col];
      skeletons.push({
        type: "rectangle",
        x,
        y,
        width: columnWidths[col],
        height: rowHeights[row],
        groupIds: [groupId],
        strokeColor: opts.strokeColor,
        backgroundColor: isHeader
          ? COLOR_PALETTE.gray[0]
          : opts.backgroundColor,
        fillStyle: isHeader ? "solid" : opts.fillStyle,
        roughness: opts.roughness,
        opacity: opts.opacity,
        strokeWidth: opts.strokeWidth,
        strokeStyle: opts.strokeStyle,
        roundness: null,
        ...(text
          ? {
              label: {
                text,
                fontSize: opts.fontSize,
                fontFamily: fontFamilyForRow(row),
                textAlign: TEXT_ALIGN.CENTER,
                verticalAlign: VERTICAL_ALIGN.MIDDLE,
                groupIds: [groupId],
              },
            }
          : {}),
      });
      x += columnWidths[col];
    }

    y += rowHeights[row];
  }

  return convertToExcalidrawElements(skeletons).map((element) =>
    newElementWith(element, { groupIds: [groupId] }),
  );
};
