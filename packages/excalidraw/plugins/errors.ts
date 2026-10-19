/**
 * Failure modes of the shape pack loading path.
 *
 * Every one of them is reported, never thrown into the editor: a broken pack
 * degrades the elements that use it to their base shape and surfaces a toast.
 */
export type ShapePackErrorCode =
  /** the pack source could not be fetched (network, 404, CORS, too large) */
  | "PACK_FETCH_FAILED"
  /** the environment has no Worker, so there is nothing to sandbox with */
  | "PACK_SANDBOX_UNAVAILABLE"
  /** the pack did not register (or render) within its budget */
  | "PACK_TIMEOUT"
  /** the pack registered something that isn't a valid pack */
  | "PACK_INVALID_MANIFEST"
  /** the pack targets a contract version this editor doesn't implement */
  | "PACK_API_VERSION_MISMATCH"
  /** a pack with this id is already registered */
  | "PACK_DUPLICATE_ID"
  /** two shapes in the pack share an id */
  | "SHAPE_DUPLICATE_ID"
  /** pack code threw while loading */
  | "PACK_RUNTIME_ERROR"
  /** a `render` call threw, timed out, or returned an invalid display list */
  | "SHAPE_RENDER_FAILED";

export class ShapePackError extends Error {
  public readonly code: ShapePackErrorCode;

  public readonly packId: string | null;

  public readonly shapeId: string | null;

  constructor(
    code: ShapePackErrorCode,
    message: string,
    context?: { packId?: string | null; shapeId?: string | null },
  ) {
    super(message);
    this.name = "ShapePackError";
    this.code = code;
    this.packId = context?.packId ?? null;
    this.shapeId = context?.shapeId ?? null;
  }
}
