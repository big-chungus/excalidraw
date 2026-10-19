/**
 * Validation of the pack manifest that comes back from the sandbox.
 *
 * The worker strips pack code before posting, so what arrives here is plain
 * data that still has to be proven well-formed: ids, labels, icon display
 * lists, default props. Validation is all-or-nothing — a pack with one bad
 * shape is rejected whole, so a pack is never half-registered.
 */

import {
  SHAPE_PACK_API_VERSION,
  SHAPE_PACK_DEFAULTS,
  SHAPE_PACK_ID_REGEX,
  SHAPE_PACK_LIMITS,
} from "./constants";
import { validateDrawOps } from "./drawOps";
import { ShapePackError } from "./errors";

import type {
  ShapeDescriptor,
  ShapePackDescriptor,
  ShapeProps,
  ShapePropValue,
} from "./types";

export type ManifestValidationResult =
  | { ok: true; pack: ShapePackDescriptor }
  | { ok: false; error: ShapePackError };

const MAX_PROPS_DEPTH = 4;
const MAX_PROPS_KEYS = 64;

const isValidId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= SHAPE_PACK_LIMITS.maxIdLength &&
  SHAPE_PACK_ID_REGEX.test(value);

const isValidLabel = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= SHAPE_PACK_LIMITS.maxLabelLength;

/** Returns a cloned, JSON-safe copy of `value`, or `null` if it isn't. */
const sanitizePropValue = (
  value: unknown,
  depth: number,
): { ok: true; value: ShapePropValue } | { ok: false } => {
  if (depth > MAX_PROPS_DEPTH) {
    return { ok: false };
  }
  if (value === null) {
    return { ok: true, value: null };
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_PROPS_KEYS) {
      return { ok: false };
    }
    const items: ShapePropValue[] = [];
    for (const entry of value) {
      const sanitized = sanitizePropValue(entry, depth + 1);
      if (!sanitized.ok) {
        return { ok: false };
      }
      items.push(sanitized.value);
    }
    return { ok: true, value: items };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_PROPS_KEYS) {
      return { ok: false };
    }
    const result: Record<string, ShapePropValue> = {};
    for (const [key, entry] of entries) {
      const sanitized = sanitizePropValue(entry, depth + 1);
      if (!sanitized.ok) {
        return { ok: false };
      }
      result[key] = sanitized.value;
    }
    return { ok: true, value: result };
  }
  return { ok: false };
};

export const sanitizeShapeProps = (value: unknown): ShapeProps | null => {
  if (value === undefined) {
    return {};
  }
  const sanitized = sanitizePropValue(value, 1);
  if (
    !sanitized.ok ||
    typeof sanitized.value !== "object" ||
    sanitized.value === null ||
    Array.isArray(sanitized.value)
  ) {
    return null;
  }
  return sanitized.value as ShapeProps;
};

const invalid = (message: string, packId: string | null) => ({
  ok: false as const,
  error: new ShapePackError("PACK_INVALID_MANIFEST", message, { packId }),
});

export const validatePackManifest = (
  raw: unknown,
  url: string,
): ManifestValidationResult => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("pack manifest must be an object", null);
  }

  const manifest = raw as Record<string, unknown>;
  const packId = typeof manifest.id === "string" ? manifest.id : null;

  if (!isValidId(manifest.id)) {
    return invalid(
      "pack id must match /^[a-z0-9][a-z0-9-_]*$/ and be at most " +
        `${SHAPE_PACK_LIMITS.maxIdLength} chars`,
      packId,
    );
  }
  if (!isValidLabel(manifest.name)) {
    return invalid("pack name must be a non-empty string", packId);
  }
  if (typeof manifest.apiVersion !== "number") {
    return invalid("pack must declare a numeric apiVersion", packId);
  }
  if (manifest.apiVersion !== SHAPE_PACK_API_VERSION) {
    return {
      ok: false,
      error: new ShapePackError(
        "PACK_API_VERSION_MISMATCH",
        `pack targets shape pack API v${manifest.apiVersion}, this editor implements v${SHAPE_PACK_API_VERSION}`,
        { packId },
      ),
    };
  }
  if (
    manifest.version !== undefined &&
    (typeof manifest.version !== "string" ||
      manifest.version.length > SHAPE_PACK_LIMITS.maxLabelLength)
  ) {
    return invalid("pack version must be a short string", packId);
  }
  if (!Array.isArray(manifest.shapes) || manifest.shapes.length === 0) {
    return invalid("pack must register at least one shape", packId);
  }
  if (manifest.shapes.length > SHAPE_PACK_LIMITS.maxShapesPerPack) {
    return invalid(
      `pack exceeds ${SHAPE_PACK_LIMITS.maxShapesPerPack} shapes`,
      packId,
    );
  }

  const shapes: ShapeDescriptor[] = [];
  const seenShapeIds = new Set<string>();

  for (const rawShape of manifest.shapes) {
    if (!rawShape || typeof rawShape !== "object" || Array.isArray(rawShape)) {
      return invalid("shape must be an object", packId);
    }
    const shape = rawShape as Record<string, unknown>;

    if (!isValidId(shape.id)) {
      return invalid(
        `shape id "${String(shape.id)}" must match /^[a-z0-9][a-z0-9-_]*$/`,
        packId,
      );
    }
    if (seenShapeIds.has(shape.id)) {
      return {
        ok: false,
        error: new ShapePackError(
          "SHAPE_DUPLICATE_ID",
          `pack "${manifest.id}" registers shape "${shape.id}" more than once`,
          { packId, shapeId: shape.id },
        ),
      };
    }
    seenShapeIds.add(shape.id);

    if (!isValidLabel(shape.label)) {
      return invalid(`shape "${shape.id}" must have a non-empty label`, packId);
    }

    let icon: ShapeDescriptor["icon"] = null;
    if (shape.icon !== undefined) {
      const validated = validateDrawOps(shape.icon);
      if (!validated.ok) {
        return invalid(
          `shape "${shape.id}" has an invalid icon: ${validated.reason}`,
          packId,
        );
      }
      icon = validated.ops;
    }

    const rawDefaults = (shape.defaultProps ?? {}) as Record<string, unknown>;
    if (typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
      return invalid(`shape "${shape.id}" has invalid defaultProps`, packId);
    }

    const width = rawDefaults.width ?? SHAPE_PACK_DEFAULTS.width;
    const height = rawDefaults.height ?? SHAPE_PACK_DEFAULTS.height;
    const fallback = rawDefaults.fallback ?? SHAPE_PACK_DEFAULTS.fallback;

    if (
      typeof width !== "number" ||
      !Number.isFinite(width) ||
      width <= 0 ||
      typeof height !== "number" ||
      !Number.isFinite(height) ||
      height <= 0
    ) {
      return invalid(
        `shape "${shape.id}" has invalid default dimensions`,
        packId,
      );
    }
    if (
      fallback !== "rectangle" &&
      fallback !== "ellipse" &&
      fallback !== "diamond"
    ) {
      return invalid(
        `shape "${shape.id}" has an unsupported fallback "${String(fallback)}"`,
        packId,
      );
    }

    const props = sanitizeShapeProps(rawDefaults.props);
    if (!props) {
      return invalid(
        `shape "${shape.id}" has non-serializable default props`,
        packId,
      );
    }

    shapes.push({
      packId: manifest.id,
      id: shape.id,
      key: `${manifest.id}:${shape.id}`,
      label: shape.label,
      icon,
      defaultProps: { width, height, fallback, props },
    });
  }

  return {
    ok: true,
    pack: {
      id: manifest.id,
      name: manifest.name,
      version: (manifest.version as string | undefined) ?? null,
      apiVersion: manifest.apiVersion,
      url,
      shapes,
    },
  };
};
