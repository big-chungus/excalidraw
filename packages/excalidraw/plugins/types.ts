/**
 * Public contract for runtime-loaded shape packs.
 *
 * Everything in this file is part of the supported plugin surface. The types
 * are split in two halves:
 *
 * - **pack-authoring types** (`ShapePack`, `ShapeDefinition`, `ShapeDrawOp`,
 *   `ShapeRenderContext`) describe the code that runs *inside* the sandbox.
 * - **host types** (`ShapePackDescriptor`, `ShapeDescriptor`,
 *   `ShapePackLoadResult`) describe what the editor exposes to the host app.
 *
 * Nothing crosses the sandbox boundary except JSON-serializable data, so the
 * editor never holds a reference to pack code, and a pack never holds a
 * reference to editor internals.
 */

import type { ShapePackError } from "./errors";

/**
 * Colors accepted in a draw op.
 *
 * Besides CSS colors (hex / rgb() / rgba() / hsl() / hsla() / `transparent`),
 * two tokens resolve against the element being drawn, so that a pack shape
 * follows the user's stroke/background pickers:
 *
 * - `"stroke"` → the element's `strokeColor`
 * - `"background"` → the element's `backgroundColor`
 *
 * Any other value is rejected and the op is dropped.
 */
export type ShapeColor = string;

type ShapeStrokeProps = {
  /** @default "stroke" */
  stroke?: ShapeColor;
  /** @default "transparent" */
  fill?: ShapeColor;
  /** in element-local px. @default the element's strokeWidth */
  strokeWidth?: number;
  /** 0..1. @default 1 */
  opacity?: number;
  /** dash pattern in element-local px. @default solid */
  dash?: readonly number[];
};

/**
 * The display list a pack returns from `render`.
 *
 * Coordinates are element-local: `(0, 0)` is the element's top-left corner and
 * `(width, height)` its bottom-right, both as handed to `render`. The editor
 * applies position, rotation, zoom and opacity itself, so a pack never needs
 * to know where on the canvas its shape ended up.
 */
export type ShapeDrawOp =
  | ({
      op: "path";
      /** SVG path data, restricted to path commands and numbers */
      d: string;
    } & ShapeStrokeProps)
  | ({
      op: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      /** corner radius. @default 0 */
      radius?: number;
    } & ShapeStrokeProps)
  | ({
      op: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
    } & ShapeStrokeProps)
  | ({
      op: "polyline";
      points: readonly (readonly [number, number])[];
      /** @default false */
      closed?: boolean;
    } & ShapeStrokeProps)
  | {
      op: "text";
      x: number;
      y: number;
      text: string;
      /** @default 16 */
      fontSize?: number;
      /** @default "sans" */
      fontFamily?: "sans" | "mono";
      /** @default "left" */
      align?: "left" | "center" | "right";
      /** @default "stroke" */
      color?: ShapeColor;
      /** 0..1. @default 1 */
      opacity?: number;
    };

/** JSON-serializable per-element configuration owned by the pack. */
export type ShapePropValue =
  | string
  | number
  | boolean
  | null
  | readonly ShapePropValue[]
  | { readonly [key: string]: ShapePropValue };

export type ShapeProps = { readonly [key: string]: ShapePropValue };

/**
 * Everything a pack is told about the element it is asked to draw.
 *
 * This is deliberately a flat, serializable snapshot rather than the element
 * itself: packs cannot read the scene, and the editor is free to change the
 * element model without breaking packs.
 */
export type ShapeRenderContext = {
  shapeId: string;
  width: number;
  height: number;
  /** per-element props, merged over the shape's `defaultProps.props` */
  props: ShapeProps;
  /** the element's stroke color, already adjusted for the current theme */
  strokeColor: string;
  /** the element's background color, already adjusted for the current theme */
  backgroundColor: string;
  strokeWidth: number;
  theme: "light" | "dark";
};

/** Base shape used when the pack that owns an element isn't available. */
export type ShapeFallback = "rectangle" | "ellipse" | "diamond";

export type ShapeDefaultProps = {
  /** @default 120 */
  width?: number;
  /** @default 100 */
  height?: number;
  /** @default "rectangle" */
  fallback?: ShapeFallback;
  props?: ShapeProps;
};

/**
 * A single shape contributed by a pack.
 *
 * `render` runs inside the sandbox on every distinct appearance of the shape
 * (size, props, colors, theme). It must be pure and reasonably fast: the
 * editor caches its output and will time the call out.
 */
export type ShapeDefinition = {
  /** unique within the pack; `[a-z0-9-_]`, 1..64 chars */
  id: string;
  label: string;
  /**
   * Optional icon, drawn with the same op list as the shape itself inside a
   * square viewport of `SHAPE_PACK_ICON_SIZE`. Hosts use it to build their own
   * shape picker; the editor does not render it yet.
   */
  icon?: readonly ShapeDrawOp[];
  defaultProps?: ShapeDefaultProps;
  render: (context: ShapeRenderContext) => readonly ShapeDrawOp[];
};

/** What a pack passes to `excalidraw.registerShapePack()`. */
export type ShapePack = {
  /** unique across packs; `[a-z0-9-_]`, 1..64 chars */
  id: string;
  name: string;
  /** the pack's own version, informational only */
  version?: string;
  /** must be compatible with `SHAPE_PACK_API_VERSION` */
  apiVersion: number;
  shapes: readonly ShapeDefinition[];
};

/** The object handed to pack code as its only entry point. */
export type ShapePackApi = {
  readonly apiVersion: number;
  registerShapePack: (pack: ShapePack) => void;
};

/**
 * Host-side view of a registered shape. Contains no pack code — the `render`
 * hook stays behind the sandbox boundary.
 */
export type ShapeDescriptor = {
  packId: string;
  id: string;
  /** `${packId}:${id}`, the value stored on elements */
  key: string;
  label: string;
  icon: readonly ShapeDrawOp[] | null;
  defaultProps: Required<Omit<ShapeDefaultProps, "props">> & {
    props: ShapeProps;
  };
};

/** Host-side view of a registered pack. */
export type ShapePackDescriptor = {
  id: string;
  name: string;
  version: string | null;
  apiVersion: number;
  /** where the pack was loaded from */
  url: string;
  shapes: readonly ShapeDescriptor[];
};

/**
 * Reference stored on an element at `customData.shapePack`.
 *
 * Elements keep a real base shape type (`defaultProps.fallback`), so a scene
 * containing pack shapes stays a valid Excalidraw scene: without the pack the
 * element renders, exports, binds arrows and round-trips as that base shape.
 */
export type ShapePackElementRef = {
  packId: string;
  shapeId: string;
  /** api version the element was authored against */
  apiVersion: number;
  props?: ShapeProps;
};

/**
 * Result of `ShapePackRegistry.load()`.
 *
 * Loading never rejects and never throws into the editor — every failure mode
 * is reported here (and emitted on `onError`) with a machine-readable code.
 */
export type ShapePackLoadResult =
  | { status: "ok"; pack: ShapePackDescriptor }
  | { status: "error"; error: ShapePackError };

/**
 * Minimal worker interface the sandbox needs. A DOM `Worker` satisfies it;
 * hosts (and tests) can supply their own runner through
 * `ShapePackRegistry`'s `workerFactory` option.
 */
export type ShapePackWorker = {
  postMessage: (message: any) => void;
  terminate: () => void;
  onmessage: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
};

export type ShapePackWorkerFactory = (source: string) => ShapePackWorker;
