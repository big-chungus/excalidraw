/**
 * The element side of the contract.
 *
 * A pack shape is not a new element type. It is an ordinary generic element
 * (rectangle / ellipse / diamond) carrying a `customData.shapePack` reference,
 * which is what makes scenes with pack shapes degrade gracefully: without the
 * pack the element still renders, exports, binds arrows, resizes and
 * round-trips — just as its base shape.
 *
 * Adding a first-class element type was the alternative. It would give pack
 * shapes their own hit-testing and bounds, but it also breaks every older
 * client that reads the scene, and touches serialization, binding, collision
 * and export. Not worth it before the contract has proven itself.
 */

import { newElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawGenericElement,
  NonDeleted,
} from "@excalidraw/element/types";

import {
  SHAPE_PACK_API_VERSION,
  SHAPE_PACK_CUSTOM_DATA_KEY,
} from "./constants";
import { sanitizeShapeProps } from "./manifest";

import type { ShapeDescriptor, ShapePackElementRef, ShapeProps } from "./types";

/**
 * Reads the pack reference off an element.
 *
 * Scene data is untrusted (it can come from a file or a collaborator), so the
 * reference is validated here rather than where it is used; anything
 * malformed reads as "not a pack shape" and the element renders as its base
 * shape.
 */
export const getShapePackRef = (
  element: ExcalidrawElement,
): ShapePackElementRef | null => {
  const raw = element.customData?.[SHAPE_PACK_CUSTOM_DATA_KEY];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  if (typeof raw.packId !== "string" || typeof raw.shapeId !== "string") {
    return null;
  }

  const props = sanitizeShapeProps(raw.props);

  return {
    packId: raw.packId,
    shapeId: raw.shapeId,
    apiVersion:
      typeof raw.apiVersion === "number"
        ? raw.apiVersion
        : SHAPE_PACK_API_VERSION,
    props: props ?? {},
  };
};

export const isShapePackElement = (element: ExcalidrawElement) =>
  getShapePackRef(element) !== null;

export const createShapePackRef = (
  shape: Pick<ShapeDescriptor, "packId" | "id">,
  props?: ShapeProps,
): ShapePackElementRef => ({
  packId: shape.packId,
  shapeId: shape.id,
  apiVersion: SHAPE_PACK_API_VERSION,
  props: props ?? {},
});

/**
 * Creates an element backed by a registered pack shape. Hosts insert it with
 * `excalidrawAPI.updateScene()`; the editor has no toolbar entry for pack
 * shapes yet.
 */
export const newShapePackElement = (
  shape: ShapeDescriptor,
  opts: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    props?: ShapeProps;
  } & Partial<Omit<ExcalidrawGenericElement, "type" | "customData">>,
): NonDeleted<ExcalidrawGenericElement> => {
  const { props, ...elementOpts } = opts;

  return newElement({
    ...elementOpts,
    type: shape.defaultProps.fallback,
    width: opts.width ?? shape.defaultProps.width,
    height: opts.height ?? shape.defaultProps.height,
    customData: {
      [SHAPE_PACK_CUSTOM_DATA_KEY]: createShapePackRef(shape, {
        ...shape.defaultProps.props,
        ...props,
      }),
    },
  });
};
