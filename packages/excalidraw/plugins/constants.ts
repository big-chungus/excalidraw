/**
 * Version of the shape pack contract implemented by this editor.
 *
 * A pack declares the version it was written against. The editor accepts a
 * pack when `pack.apiVersion === SHAPE_PACK_API_VERSION`; anything else fails
 * with `PACK_API_VERSION_MISMATCH` rather than silently half-working. Once the
 * contract gains backwards-compatible additions we can widen this to a range.
 */
export const SHAPE_PACK_API_VERSION = 1;

/** Key under which the pack reference lives in `element.customData`. */
export const SHAPE_PACK_CUSTOM_DATA_KEY = "shapePack";

/** Square viewport a pack's shape icon is drawn into. */
export const SHAPE_PACK_ICON_SIZE = 24;

export const SHAPE_PACK_DEFAULTS = {
  width: 120,
  height: 100,
  fallback: "rectangle",
} as const;

/**
 * Budgets. These are intentionally tight: a pack that exceeds them is a bug in
 * the pack, and the editor would rather drop its output than stutter.
 */
export const SHAPE_PACK_LIMITS = {
  /** ms allowed for fetching + evaluating + registering a pack */
  initTimeout: 5000,
  /** ms allowed for a single `render` call */
  renderTimeout: 1000,
  /** max bytes of pack source the editor will evaluate */
  maxSourceBytes: 512 * 1024,
  maxShapesPerPack: 64,
  maxOpsPerShape: 512,
  maxPathLength: 4096,
  maxPolylinePoints: 512,
  maxTextLength: 256,
  maxIdLength: 64,
  maxLabelLength: 120,
  /** max rendered appearances cached per pack before the cache is reset */
  maxRenderCacheEntries: 256,
} as const;

export const SHAPE_PACK_ID_REGEX = /^[a-z0-9][a-z0-9-_]*$/;
