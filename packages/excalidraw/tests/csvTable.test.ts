import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  FONT_FAMILY,
} from "@excalidraw/common";

import {
  buildCsvTableElements,
  isCsvTableGrid,
  parseDelimitedGrid,
} from "../charts";

const defaultStyle = {
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid" as const,
  currentItemStrokeStyle: "solid" as const,
  currentItemRoughness: 1,
  currentItemOpacity: 100,
  currentItemFontSize: DEFAULT_FONT_SIZE,
  currentItemFontFamily: DEFAULT_FONT_FAMILY,
  strokeWidth: 1,
};

describe("parseDelimitedGrid", () => {
  it("parses consistent CSV", () => {
    const result = parseDelimitedGrid("Name,Age,City\nAlice,30,NYC\nBob,25,LA");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.delimiter).toBe(",");
    expect(result.cells).toEqual([
      ["Name", "Age", "City"],
      ["Alice", "30", "NYC"],
      ["Bob", "25", "LA"],
    ]);
  });

  it("prefers tab when tabs produce multiple columns", () => {
    const result = parseDelimitedGrid("A\tB\n1\t2");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.delimiter).toBe("\t");
    expect(result.cells).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("rejects empty input", () => {
    expect(parseDelimitedGrid("\n\n")).toEqual({
      ok: false,
      reason: "No values",
    });
  });

  it("falls back to single-column when comma columns are inconsistent", () => {
    // Tab/semicolon splits yield one column per row (consistent), so the
    // parser prefers that over an inconsistent comma split — same as charts.
    const result = parseDelimitedGrid("a,b\nc,d,e");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.cells[0].length).toBe(1);
    expect(isCsvTableGrid(result.cells)).toBe(false);
  });
});

describe("isCsvTableGrid", () => {
  it("requires at least 2 rows and 2 columns", () => {
    expect(isCsvTableGrid([["a", "b"]])).toBe(false);
    expect(isCsvTableGrid([["a"], ["b"]])).toBe(false);
    expect(
      isCsvTableGrid([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe(true);
  });
});

describe("buildCsvTableElements", () => {
  it("creates one text element per cell with a shared groupId", () => {
    const cells = [
      ["Name", "Age", "City"],
      ["Alice", "30", "NYC"],
      ["Bob", "25", "LA"],
    ];
    const elements = buildCsvTableElements(cells, defaultStyle);
    expect(elements).toHaveLength(9);

    const groupId = elements[0].groupIds[0];
    expect(groupId).toBeTruthy();
    expect(elements.every((el) => el.groupIds[0] === groupId)).toBe(true);
  });

  it("uses Lilita One for a non-numeric header row", () => {
    const elements = buildCsvTableElements(
      [
        ["Name", "Age"],
        ["Alice", "30"],
      ],
      defaultStyle,
    );
    expect(elements[0].fontFamily).toBe(FONT_FAMILY["Lilita One"]);
    expect(elements[1].fontFamily).toBe(FONT_FAMILY["Lilita One"]);
    expect(elements[2].fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(elements[3].fontFamily).toBe(DEFAULT_FONT_FAMILY);
  });

  it("does not treat a numeric first row as a header", () => {
    const elements = buildCsvTableElements(
      [
        ["10", "20"],
        ["30", "40"],
      ],
      defaultStyle,
    );
    expect(elements.every((el) => el.fontFamily === DEFAULT_FONT_FAMILY)).toBe(
      true,
    );
  });

  it("lays out cells in a grid (columns share x, rows share y)", () => {
    const elements = buildCsvTableElements(
      [
        ["A", "BB"],
        ["C", "D"],
      ],
      defaultStyle,
    );
    // row 0
    expect(elements[0].y).toBe(elements[1].y);
    expect(elements[0].x).toBeLessThan(elements[1].x);
    // row 1 shares column x with row 0
    expect(elements[2].x).toBe(elements[0].x);
    expect(elements[3].x).toBe(elements[1].x);
    expect(elements[2].y).toBeGreaterThan(elements[0].y);
  });

  it("returns empty array for empty cells", () => {
    expect(buildCsvTableElements([], defaultStyle)).toEqual([]);
  });
});
