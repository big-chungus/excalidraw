import { tryParseSpreadsheet } from "../charts";

describe("tryParseSpreadsheet", () => {
  it("works for numbers with comma in them", () => {
    const result = tryParseSpreadsheet(
      `Week Index${"\t"}Users
Week 1${"\t"}814
Week 2${"\t"}10,301
Week 3${"\t"}4,264`,
    );
    expect(result).toMatchSnapshot();
  });

  it("parses multi-series CSV for radar charts", () => {
    const result = tryParseSpreadsheet(
      `Metric,Player A,Player B,Player C
Speed,80,60,75
Strength,65,85,70
Agility,90,70,88
Intelligence,70,88,92
Stamina,85,75,80`,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        title: "Metric",
        labels: ["Speed", "Strength", "Agility", "Intelligence", "Stamina"],
        series: [
          { title: "Player A", values: [80, 65, 90, 70, 85] },
          { title: "Player B", values: [60, 85, 70, 88, 75] },
          { title: "Player C", values: [75, 70, 88, 92, 80] },
        ],
      },
    });
  });

  it("parses TSV with empty chart-name header cell", () => {
    const result = tryParseSpreadsheet(
      `\tDunk\tEgg
Physical Strength\t10\t2
Swordsmanship\t8\t1
Political Instinct\t3\t9`,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        title: null,
        labels: ["Physical Strength", "Swordsmanship", "Political Instinct"],
        series: [
          { title: "Dunk", values: [10, 8, 3] },
          { title: "Egg", values: [2, 1, 9] },
        ],
      },
    });
  });

  it("parses 2-row multi-series TSV without transposing", () => {
    const result = tryParseSpreadsheet(
      `Physical Strength\t10\t2
Swordsmanship skill\t8\t1`,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        title: null,
        labels: ["Physical Strength", "Swordsmanship skill"],
        series: [
          { title: "Series 1", values: [10, 8] },
          { title: "Series 2", values: [2, 1] },
        ],
      },
    });
  });

  it("parses semicolon-separated values", () => {
    const result = tryParseSpreadsheet(
      `Metric;Player A;Player B
Speed;80;60
Strength;65;85
Agility;90;70`,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        title: "Metric",
        labels: ["Speed", "Strength", "Agility"],
        series: [
          { title: "Player A", values: [80, 65, 90] },
          { title: "Player B", values: [60, 85, 70] },
        ],
      },
    });
  });

  it("transposes wide data (more value cols than rows) into series-per-row", () => {
    const result = tryParseSpreadsheet(
      `trait,Dunk,Egg,Daeron
Physical,10,2,7
Mental,10,2,7`,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        title: "trait",
        labels: ["Dunk", "Egg", "Daeron"],
        series: [
          { title: "Physical", values: [10, 2, 7] },
          { title: "Mental", values: [10, 2, 7] },
        ],
      },
    });
  });

  it("transposes single data row with header into single series", () => {
    const result = tryParseSpreadsheet(
      `trait,Dunk,Egg,Daeron
Physical,10,2,7`,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        title: "Physical",
        labels: ["Dunk", "Egg", "Daeron"],
        series: [{ title: "Physical", values: [10, 2, 7] }],
      },
    });
  });

  it("transposes single data row without header into single series", () => {
    const result = tryParseSpreadsheet(`Physical,10,2,7`);

    expect(result).toEqual({
      ok: true,
      data: {
        title: "Physical",
        labels: null,
        series: [{ title: "Physical", values: [10, 2, 7] }],
      },
    });
  });

  it("prefers tab over comma/semicolon when tabs produce multiple columns", () => {
    const result = tryParseSpreadsheet(
      `Label\tValue
A\t10
B\t20`,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        title: "Value",
        labels: ["A", "B"],
        series: [{ title: "Value", values: [10, 20] }],
      },
    });
  });

  const expectedMonthSales = {
    ok: true,
    data: {
      title: "Sales",
      labels: ["Jan", "Feb", "Mar"],
      series: [{ title: "Sales", values: [10, 20, 15] }],
    },
  };

  it("ignores a blank row in CSV spreadsheet paste", () => {
    const result = tryParseSpreadsheet(`Month,Sales
Jan,10

Feb,20
Mar,15`);

    expect(result).toEqual(expectedMonthSales);
  });

  it("ignores delimiter-only blank rows from spreadsheet copy", () => {
    const result = tryParseSpreadsheet(`Month,Sales
Jan,10
,
Feb,20
Mar,15
`);

    expect(result).toEqual(expectedMonthSales);
  });

  it("ignores trailing blank columns and rows", () => {
    const result = tryParseSpreadsheet(`Month,Sales,
Jan,10,
Feb,20,
Mar,15,
,
`);

    expect(result).toEqual(expectedMonthSales);
  });

  it("ignores a tab-only blank row in TSV spreadsheet paste", () => {
    const result = tryParseSpreadsheet(
      `Month\tSales
Jan\t10
\t
Feb\t20
Mar\t15`,
    );

    expect(result).toEqual(expectedMonthSales);
  });

  it("ignores an empty column between label and values", () => {
    const result = tryParseSpreadsheet(`Month,,Sales
Jan,,10
Feb,,20
Mar,,15`);

    expect(result).toEqual(expectedMonthSales);
  });

  it("parses a single column when only some values use thousands separators", () => {
    const result = tryParseSpreadsheet(`1000
2,000
3000`);

    expect(result).toEqual({
      ok: true,
      data: {
        title: null,
        labels: null,
        series: [{ title: null, values: [1000, 2000, 3000] }],
      },
    });
  });

  it("keeps semicolon as the delimiter when commas appear in only some rows", () => {
    const result = tryParseSpreadsheet(`City;Population
New York;8000000
Paris, France;2000000`);

    expect(result).toEqual({
      ok: true,
      data: {
        title: "Population",
        labels: ["New York", "Paris, France"],
        series: [{ title: "Population", values: [8000000, 2000000] }],
      },
    });
  });
});
