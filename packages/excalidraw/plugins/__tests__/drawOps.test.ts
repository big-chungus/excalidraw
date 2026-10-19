import { paintDrawOps, validateDrawOps } from "../drawOps";

import type { ShapeDrawOp } from "../types";

const createContext = () => {
  const calls: string[] = [];
  const context = {
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    closePath: () => calls.push("closePath"),
    rect: (...args: number[]) => calls.push(`rect(${args.join(",")})`),
    roundRect: (...args: number[]) =>
      calls.push(`roundRect(${args.join(",")})`),
    ellipse: (...args: number[]) => calls.push(`ellipse(${args.join(",")})`),
    moveTo: (...args: number[]) => calls.push(`moveTo(${args.join(",")})`),
    lineTo: (...args: number[]) => calls.push(`lineTo(${args.join(",")})`),
    fill: () => calls.push(`fill:${context.fillStyle}`),
    stroke: () => calls.push(`stroke:${context.strokeStyle}`),
    fillText: (text: string) => calls.push(`fillText(${text})`),
    setLineDash: (dash: number[]) => calls.push(`dash(${dash.join(",")})`),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    font: "",
    textAlign: "",
    globalAlpha: 1,
  };

  return { context: context as unknown as CanvasRenderingContext2D, calls };
};

const paintContext = {
  strokeColor: "#1e1e1e",
  backgroundColor: "#ffc9c9",
  strokeWidth: 2,
};

describe("shape pack draw ops", () => {
  describe("validation", () => {
    it("accepts a well-formed display list", () => {
      const ops: ShapeDrawOp[] = [
        { op: "rect", x: 0, y: 0, width: 10, height: 10, radius: 2 },
        { op: "ellipse", cx: 5, cy: 5, rx: 2, ry: 2, fill: "background" },
        {
          op: "polyline",
          points: [
            [0, 0],
            [1, 1],
          ],
          dash: [4, 2],
        },
        { op: "path", d: "M 0 0 L 10 10 z", stroke: "#ff0000" },
        { op: "text", x: 1, y: 2, text: "hi", align: "center" },
      ];

      expect(validateDrawOps(ops)).toEqual({ ok: true, ops });
    });

    it.each([
      ["a non-array", "nope"],
      ["an unknown op", [{ op: "sprite" }]],
      [
        "a non-finite number",
        [{ op: "rect", x: NaN, y: 0, width: 1, height: 1 }],
      ],
      ["a short polyline", [{ op: "polyline", points: [[0, 0]] }]],
      [
        "a malformed polyline point",
        [{ op: "polyline", points: [[0, 0], [1]] }],
      ],
      [
        "a color the editor can't parse",
        [{ op: "rect", x: 0, y: 0, width: 1, height: 1, fill: "url(#x)" }],
      ],
      ["script-ish path data", [{ op: "path", d: "M0 0 L10 10 </script>" }]],
      [
        "an out-of-range opacity",
        [{ op: "rect", x: 0, y: 0, width: 1, height: 1, opacity: 4 }],
      ],
    ])("rejects %s", (_label, ops) => {
      const result = validateDrawOps(ops);

      expect(result.ok).toBe(false);
    });

    it("rejects an oversized display list", () => {
      const ops = Array.from({ length: 513 }, () => ({
        op: "rect",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }));

      const result = validateDrawOps(ops);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toContain("512 ops");
    });
  });

  describe("painting", () => {
    it("resolves the stroke and background tokens against the element", () => {
      const { context, calls } = createContext();

      paintDrawOps(
        context,
        [
          {
            op: "rect",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            fill: "background",
            stroke: "stroke",
          },
        ],
        paintContext,
      );

      expect(calls).toContain("fill:#ffc9c9");
      expect(calls).toContain("stroke:#1e1e1e");
    });

    it("skips the fill for transparent ops", () => {
      const { context, calls } = createContext();

      paintDrawOps(
        context,
        [{ op: "ellipse", cx: 1, cy: 1, rx: 1, ry: 1 }],
        paintContext,
      );

      expect(calls.some((call) => call.startsWith("fill:"))).toBe(false);
      expect(calls).toContain("stroke:#1e1e1e");
    });

    it("paints text with the pack's font settings", () => {
      const { context, calls } = createContext();

      paintDrawOps(
        context,
        [
          {
            op: "text",
            x: 0,
            y: 0,
            text: "router",
            fontSize: 12,
            fontFamily: "mono",
            align: "center",
          },
        ],
        paintContext,
      );

      expect(calls).toContain("fillText(router)");
      expect(context.font).toBe("12px monospace");
      expect(context.textAlign).toBe("center");
    });
  });
});
