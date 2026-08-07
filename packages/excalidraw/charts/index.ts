import type { ChartType } from "@excalidraw/element/types";

import { renderBarChart } from "./charts.bar";
import { renderLineChart } from "./charts.line";
import { renderRadarChart } from "./charts.radar";

import type { ChartElements, Spreadsheet } from "./charts.types";

export {
  type ParseSpreadsheetResult,
  type Spreadsheet,
  type SpreadsheetSeries,
  type ChartElements,
} from "./charts.types";

export type { ParseDelimitedGridResult, Delimiter } from "./charts.parse";

export { isSpreadsheetValidForChartType } from "./charts.helpers";
export {
  parseDelimitedGrid,
  tryParseCells,
  tryParseNumber,
  tryParseSpreadsheet,
} from "./charts.parse";
export { buildCsvTableElements, isCsvTableGrid } from "./csvTable";

export const renderSpreadsheet = (
  chartType: ChartType,
  spreadsheet: Spreadsheet,
  x: number,
  y: number,
  colorSeed?: number,
): ChartElements | null => {
  if (chartType === "line") {
    return renderLineChart(spreadsheet, x, y, colorSeed);
  }
  if (chartType === "radar") {
    return renderRadarChart(spreadsheet, x, y, colorSeed);
  }
  return renderBarChart(spreadsheet, x, y, colorSeed);
};
