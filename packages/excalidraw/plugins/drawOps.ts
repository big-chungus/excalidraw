/**
 * Validation and painting of the display list a shape pack returns.
 *
 * Draw ops arrive from sandboxed, third-party code, so nothing here trusts its
 * input: every op is re-checked (shape, numbers, lengths, colors) before it is
 * allowed anywhere near a canvas context, and anything unexpected fails the
 * whole display list rather than painting half a shape.
 */

import { SHAPE_PACK_LIMITS } from "./constants";

import type { ShapeColor, ShapeDrawOp } from "./types";

export type DrawOpsValidationResult =
  | { ok: true; ops: readonly ShapeDrawOp[] }
  | { ok: false; reason: string };

export type PaintContext = {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
};

const CSS_COLOR_REGEX =
  /^(transparent|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\))$/i;

const SVG_PATH_REGEX = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isValidColor = (value: unknown): value is ShapeColor =>
  typeof value === "string" &&
  (value === "stroke" ||
    value === "background" ||
    CSS_COLOR_REGEX.test(value.trim()));

const validateStrokeProps = (op: Record<string, unknown>): string | null => {
  if ("stroke" in op && op.stroke !== undefined && !isValidColor(op.stroke)) {
    return `invalid stroke color "${String(op.stroke)}"`;
  }
  if ("fill" in op && op.fill !== undefined && !isValidColor(op.fill)) {
    return `invalid fill color "${String(op.fill)}"`;
  }
  if (
    "strokeWidth" in op &&
    op.strokeWidth !== undefined &&
    (!isFiniteNumber(op.strokeWidth) || op.strokeWidth < 0)
  ) {
    return "invalid strokeWidth";
  }
  if (
    "opacity" in op &&
    op.opacity !== undefined &&
    (!isFiniteNumber(op.opacity) || op.opacity < 0 || op.opacity > 1)
  ) {
    return "invalid opacity";
  }
  if ("dash" in op && op.dash !== undefined) {
    if (
      !Array.isArray(op.dash) ||
      op.dash.length > 8 ||
      !op.dash.every((entry) => isFiniteNumber(entry) && entry >= 0)
    ) {
      return "invalid dash pattern";
    }
  }
  return null;
};

const validateOp = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "op must be an object";
  }

  const op = value as Record<string, unknown>;
  const strokeError = validateStrokeProps(op);

  if (strokeError) {
    return strokeError;
  }

  switch (op.op) {
    case "path": {
      if (typeof op.d !== "string" || !op.d.trim()) {
        return "path op requires a non-empty `d`";
      }
      if (op.d.length > SHAPE_PACK_LIMITS.maxPathLength) {
        return `path data exceeds ${SHAPE_PACK_LIMITS.maxPathLength} chars`;
      }
      if (!SVG_PATH_REGEX.test(op.d)) {
        return "path data contains unsupported characters";
      }
      return null;
    }
    case "rect": {
      if (
        !isFiniteNumber(op.x) ||
        !isFiniteNumber(op.y) ||
        !isFiniteNumber(op.width) ||
        !isFiniteNumber(op.height)
      ) {
        return "rect op requires finite x/y/width/height";
      }
      if (
        op.radius !== undefined &&
        (!isFiniteNumber(op.radius) || op.radius < 0)
      ) {
        return "invalid rect radius";
      }
      return null;
    }
    case "ellipse": {
      if (
        !isFiniteNumber(op.cx) ||
        !isFiniteNumber(op.cy) ||
        !isFiniteNumber(op.rx) ||
        !isFiniteNumber(op.ry)
      ) {
        return "ellipse op requires finite cx/cy/rx/ry";
      }
      return null;
    }
    case "polyline": {
      if (!Array.isArray(op.points) || op.points.length < 2) {
        return "polyline op requires at least 2 points";
      }
      if (op.points.length > SHAPE_PACK_LIMITS.maxPolylinePoints) {
        return `polyline exceeds ${SHAPE_PACK_LIMITS.maxPolylinePoints} points`;
      }
      for (const point of op.points) {
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          !isFiniteNumber(point[0]) ||
          !isFiniteNumber(point[1])
        ) {
          return "polyline points must be [x, y] number pairs";
        }
      }
      return null;
    }
    case "text": {
      if (typeof op.text !== "string") {
        return "text op requires a string `text`";
      }
      if (op.text.length > SHAPE_PACK_LIMITS.maxTextLength) {
        return `text exceeds ${SHAPE_PACK_LIMITS.maxTextLength} chars`;
      }
      if (!isFiniteNumber(op.x) || !isFiniteNumber(op.y)) {
        return "text op requires finite x/y";
      }
      if (
        op.fontSize !== undefined &&
        (!isFiniteNumber(op.fontSize) || op.fontSize <= 0 || op.fontSize > 512)
      ) {
        return "invalid text fontSize";
      }
      if (
        op.fontFamily !== undefined &&
        op.fontFamily !== "sans" &&
        op.fontFamily !== "mono"
      ) {
        return "invalid text fontFamily";
      }
      if (
        op.align !== undefined &&
        op.align !== "left" &&
        op.align !== "center" &&
        op.align !== "right"
      ) {
        return "invalid text align";
      }
      if (op.color !== undefined && !isValidColor(op.color)) {
        return `invalid text color "${String(op.color)}"`;
      }
      return null;
    }
    default:
      return `unknown op "${String(op.op)}"`;
  }
};

export const validateDrawOps = (value: unknown): DrawOpsValidationResult => {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "render must return an array of draw ops" };
  }
  if (value.length > SHAPE_PACK_LIMITS.maxOpsPerShape) {
    return {
      ok: false,
      reason: `display list exceeds ${SHAPE_PACK_LIMITS.maxOpsPerShape} ops`,
    };
  }

  for (let index = 0; index < value.length; index++) {
    const reason = validateOp(value[index]);
    if (reason) {
      return { ok: false, reason: `op #${index}: ${reason}` };
    }
  }

  return { ok: true, ops: value as readonly ShapeDrawOp[] };
};

const resolveColor = (
  color: ShapeColor | undefined,
  fallback: string,
  paintContext: PaintContext,
): string => {
  if (color === undefined) {
    return fallback;
  }
  if (color === "stroke") {
    return paintContext.strokeColor;
  }
  if (color === "background") {
    return paintContext.backgroundColor;
  }
  return color;
};

const applyStrokeAndFill = (
  context: CanvasRenderingContext2D,
  op: Extract<ShapeDrawOp, { op: "path" | "rect" | "ellipse" | "polyline" }>,
  paintContext: PaintContext,
  draw: { fill: () => void; stroke: () => void },
) => {
  const fill = resolveColor(op.fill, "transparent", paintContext);
  const stroke = resolveColor(
    op.stroke,
    paintContext.strokeColor,
    paintContext,
  );

  context.save();
  context.globalAlpha = op.opacity ?? 1;
  context.lineWidth = op.strokeWidth ?? paintContext.strokeWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash(op.dash ? [...op.dash] : []);

  if (fill !== "transparent") {
    context.fillStyle = fill;
    draw.fill();
  }
  if (stroke !== "transparent" && context.lineWidth > 0) {
    context.strokeStyle = stroke;
    draw.stroke();
  }

  context.restore();
};

const traceRect = (
  context: CanvasRenderingContext2D,
  op: Extract<ShapeDrawOp, { op: "rect" }>,
) => {
  context.beginPath();
  const radius = op.radius ?? 0;
  if (radius > 0 && typeof context.roundRect === "function") {
    context.roundRect(
      op.x,
      op.y,
      op.width,
      op.height,
      Math.min(radius, Math.abs(op.width) / 2, Math.abs(op.height) / 2),
    );
  } else {
    context.rect(op.x, op.y, op.width, op.height);
  }
};

/**
 * Paints a validated display list into a context already translated so that
 * `(0, 0)` is the element's top-left corner.
 */
export const paintDrawOps = (
  context: CanvasRenderingContext2D,
  ops: readonly ShapeDrawOp[],
  paintContext: PaintContext,
) => {
  for (const op of ops) {
    switch (op.op) {
      case "path": {
        if (typeof Path2D === "undefined") {
          break;
        }
        const path = new Path2D(op.d);
        applyStrokeAndFill(context, op, paintContext, {
          fill: () => context.fill(path),
          stroke: () => context.stroke(path),
        });
        break;
      }
      case "rect": {
        applyStrokeAndFill(context, op, paintContext, {
          fill: () => {
            traceRect(context, op);
            context.fill();
          },
          stroke: () => {
            traceRect(context, op);
            context.stroke();
          },
        });
        break;
      }
      case "ellipse": {
        const trace = () => {
          context.beginPath();
          context.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, Math.PI * 2);
        };
        applyStrokeAndFill(context, op, paintContext, {
          fill: () => {
            trace();
            context.fill();
          },
          stroke: () => {
            trace();
            context.stroke();
          },
        });
        break;
      }
      case "polyline": {
        const trace = () => {
          context.beginPath();
          context.moveTo(op.points[0][0], op.points[0][1]);
          for (let index = 1; index < op.points.length; index++) {
            context.lineTo(op.points[index][0], op.points[index][1]);
          }
          if (op.closed) {
            context.closePath();
          }
        };
        applyStrokeAndFill(context, op, paintContext, {
          fill: () => {
            trace();
            context.fill();
          },
          stroke: () => {
            trace();
            context.stroke();
          },
        });
        break;
      }
      case "text": {
        context.save();
        context.globalAlpha = op.opacity ?? 1;
        context.fillStyle = resolveColor(
          op.color,
          paintContext.strokeColor,
          paintContext,
        );
        context.font = `${op.fontSize ?? 16}px ${
          op.fontFamily === "mono" ? "monospace" : "sans-serif"
        }`;
        context.textAlign = op.align ?? "left";
        context.fillText(op.text, op.x, op.y);
        context.restore();
        break;
      }
      default: {
        // exhaustive — validation rejects unknown ops before we get here
        break;
      }
    }
  }
};
