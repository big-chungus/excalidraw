/**
 * Runtime shape packs — the supported surface.
 *
 * See `./README.md` for the contract, the failure modes and an example pack.
 */

export {
  SHAPE_PACK_API_VERSION,
  SHAPE_PACK_CUSTOM_DATA_KEY,
  SHAPE_PACK_ICON_SIZE,
  SHAPE_PACK_LIMITS,
} from "./constants";
export { ShapePackError } from "./errors";
export { ShapePackRegistry } from "./registry";
export {
  createShapePackRef,
  getShapePackRef,
  isShapePackElement,
  newShapePackElement,
} from "./element";
/** exported so hosts can paint pack icons in their own shape picker */
export { paintDrawOps } from "./drawOps";
export { isShapePackSandboxSupported } from "./sandbox";

export type { ShapePackErrorCode } from "./errors";
export type { ShapePackEvent, ShapePackRegistryOptions } from "./registry";
export type {
  ShapeColor,
  ShapeDefaultProps,
  ShapeDefinition,
  ShapeDescriptor,
  ShapeDrawOp,
  ShapeFallback,
  ShapePack,
  ShapePackApi,
  ShapePackDescriptor,
  ShapePackElementRef,
  ShapePackLoadResult,
  ShapePackWorker,
  ShapePackWorkerFactory,
  ShapeProps,
  ShapePropValue,
  ShapeRenderContext,
} from "./types";
