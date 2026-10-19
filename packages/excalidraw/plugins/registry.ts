/**
 * Runtime registry of shape packs.
 *
 * Owns the whole loading path — fetch, sandbox, validate, register — and the
 * render cache that lets an async, sandboxed `render` hook feed a synchronous
 * canvas renderer:
 *
 * 1. the renderer asks for an element's display list;
 * 2. on a cache miss the element is drawn as its base shape and a render is
 *    requested from the pack's worker;
 * 3. when the worker answers, the display list is validated, cached, the
 *    revision is bumped and the editor repaints — now with the pack's shape.
 *
 * Every failure is reported through `onEvent` and leaves the element drawn as
 * its base shape. Nothing here throws into the editor.
 */

import { applyDarkModeFilter, Emitter, THEME } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { Theme } from "@excalidraw/element/types";

import { SHAPE_PACK_LIMITS } from "./constants";
import { paintDrawOps, validateDrawOps } from "./drawOps";
import { getShapePackRef } from "./element";
import { ShapePackError } from "./errors";
import { validatePackManifest } from "./manifest";
import { ShapePackSandbox } from "./sandbox";

import type {
  ShapeDescriptor,
  ShapeDrawOp,
  ShapePackDescriptor,
  ShapePackLoadResult,
  ShapePackWorkerFactory,
  ShapeRenderContext,
} from "./types";

export type ShapePackEvent =
  | { type: "loaded"; pack: ShapePackDescriptor }
  | { type: "unloaded"; packId: string }
  /** a pack's rendered output changed; the editor should repaint */
  | { type: "render"; revision: number }
  | { type: "error"; error: ShapePackError };

export type ShapePackRegistryOptions = {
  /** swap the sandbox runner (tests, hosts with a custom worker transport) */
  workerFactory?: ShapePackWorkerFactory;
  /** swap how pack source is fetched (tests, hosts proxying pack downloads) */
  loadSource?: (url: string) => Promise<string>;
  initTimeout?: number;
  renderTimeout?: number;
};

/** Renders in flight per pack; keeps a resize storm from flooding a worker. */
const MAX_CONCURRENT_RENDERS = 8;

const defaultLoadSource = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const source = await response.text();

  if (source.length > SHAPE_PACK_LIMITS.maxSourceBytes) {
    throw new Error(
      `pack source exceeds ${SHAPE_PACK_LIMITS.maxSourceBytes} bytes`,
    );
  }

  return source;
};

const getRenderCacheKey = (context: ShapeRenderContext, packId: string) =>
  [
    packId,
    context.shapeId,
    context.width,
    context.height,
    context.strokeColor,
    context.backgroundColor,
    context.strokeWidth,
    context.theme,
    JSON.stringify(context.props),
  ].join("|");

type RegisteredPack = {
  descriptor: ShapePackDescriptor;
  sandbox: ShapePackSandbox;
};

export class ShapePackRegistry {
  private packs = new Map<string, RegisteredPack>();

  private shapes = new Map<string, ShapeDescriptor>();

  private renderCache = new Map<string, readonly ShapeDrawOp[]>();

  private inFlight = new Set<string>();

  /**
   * Shapes whose `render` failed. They stay disabled (drawn as their base
   * shape) until the pack is reloaded, so one broken shape can't spam the
   * worker — or the user — on every repaint.
   */
  private disabledShapes = new Set<string>();

  private revision = 0;

  /**
   * Bumped by `destroy()`. A load that was in flight across it is discarded
   * instead of registering into a registry nobody is watching — while the
   * instance itself stays usable, because React StrictMode mounts, unmounts
   * and remounts the same editor instance.
   */
  private generation = 0;

  private readonly emitter = new Emitter<[event: ShapePackEvent]>();

  private readonly options: ShapePackRegistryOptions;

  constructor(options: ShapePackRegistryOptions = {}) {
    this.options = options;
  }

  public onEvent(callback: (event: ShapePackEvent) => void) {
    return this.emitter.on(callback);
  }

  public getPacks(): readonly ShapePackDescriptor[] {
    return [...this.packs.values()].map((pack) => pack.descriptor);
  }

  public getPack(packId: string): ShapePackDescriptor | null {
    return this.packs.get(packId)?.descriptor ?? null;
  }

  public getShapes(): readonly ShapeDescriptor[] {
    return [...this.shapes.values()];
  }

  public getShape(packId: string, shapeId: string): ShapeDescriptor | null {
    return this.shapes.get(`${packId}:${shapeId}`) ?? null;
  }

  /**
   * Loads a pack from `url`.
   *
   * Never rejects: every failure comes back as `{ status: "error" }` with a
   * coded {@link ShapePackError}, and is also emitted so the editor can toast
   * it. A failed load leaves the registry untouched.
   */
  public async load(url: string): Promise<ShapePackLoadResult> {
    const generation = this.generation;

    let source: string;
    try {
      source = await (this.options.loadSource ?? defaultLoadSource)(url);
    } catch (error: any) {
      return this.fail(
        new ShapePackError(
          "PACK_FETCH_FAILED",
          `could not load shape pack from ${url}: ${error?.message ?? error}`,
        ),
      );
    }

    let loaded: { sandbox: ShapePackSandbox; manifest: unknown };
    try {
      loaded = await ShapePackSandbox.load({
        packSource: source,
        url,
        workerFactory: this.options.workerFactory,
        initTimeout: this.options.initTimeout,
        renderTimeout: this.options.renderTimeout,
      });
    } catch (error: any) {
      return this.fail(
        error instanceof ShapePackError
          ? error
          : new ShapePackError(
              "PACK_RUNTIME_ERROR",
              `shape pack at ${url} failed to load: ${error?.message ?? error}`,
            ),
      );
    }

    const validated = validatePackManifest(loaded.manifest, url);

    if (!validated.ok) {
      loaded.sandbox.destroy();
      return this.fail(validated.error);
    }

    const { pack } = validated;

    if (this.generation !== generation) {
      loaded.sandbox.destroy();
      return {
        status: "error",
        error: new ShapePackError(
          "PACK_SANDBOX_UNAVAILABLE",
          `the registry was reset while ${url} was loading`,
        ),
      };
    }

    if (this.packs.has(pack.id)) {
      loaded.sandbox.destroy();
      return this.fail(
        new ShapePackError(
          "PACK_DUPLICATE_ID",
          `a shape pack with id "${pack.id}" is already loaded; unload it first`,
          { packId: pack.id },
        ),
      );
    }

    this.packs.set(pack.id, { descriptor: pack, sandbox: loaded.sandbox });
    for (const shape of pack.shapes) {
      this.shapes.set(shape.key, shape);
    }

    this.bumpRevision();
    this.emitter.trigger({ type: "loaded", pack });

    return { status: "ok", pack };
  }

  public unload(packId: string) {
    const pack = this.packs.get(packId);

    if (!pack) {
      return;
    }

    pack.sandbox.destroy();
    this.packs.delete(packId);

    for (const shape of pack.descriptor.shapes) {
      this.shapes.delete(shape.key);
      this.disabledShapes.delete(shape.key);
    }
    for (const key of [...this.renderCache.keys()]) {
      if (key.startsWith(`${packId}|`)) {
        this.renderCache.delete(key);
      }
    }

    this.bumpRevision();
    this.emitter.trigger({ type: "unloaded", packId });
  }

  /**
   * Releases everything the registry holds — workers, caches, subscribers.
   * The instance stays usable afterwards (as `Library.destroy()` does), so a
   * StrictMode remount of the editor doesn't leave it dead.
   */
  public destroy() {
    for (const packId of [...this.packs.keys()]) {
      this.unload(packId);
    }
    this.renderCache.clear();
    this.disabledShapes.clear();
    this.emitter.clear();
    this.generation++;
  }

  /**
   * Seam consumed by the canvas renderer. Kept to two methods on purpose: the
   * element package knows nothing about packs beyond "try to draw this, tell
   * me whether you did".
   */
  public readonly renderSource = {
    drawShape: (
      element: ExcalidrawElement,
      context: CanvasRenderingContext2D,
      options: { theme: Theme },
    ): boolean => this.drawShape(element, context, options.theme),
    getRenderRevision: (element: ExcalidrawElement): number =>
      getShapePackRef(element) ? this.revision : 0,
  };

  private drawShape(
    element: ExcalidrawElement,
    canvasContext: CanvasRenderingContext2D,
    theme: Theme,
  ): boolean {
    const ref = getShapePackRef(element);

    if (!ref) {
      return false;
    }

    const shape = this.shapes.get(`${ref.packId}:${ref.shapeId}`);

    if (!shape || this.disabledShapes.has(shape.key)) {
      return false;
    }

    const isDarkMode = theme === THEME.DARK;
    const strokeColor = applyDarkModeFilter(element.strokeColor, isDarkMode);
    const backgroundColor = applyDarkModeFilter(
      element.backgroundColor,
      isDarkMode,
    );

    const renderContext: ShapeRenderContext = {
      shapeId: shape.id,
      // rounded so that dragging a resize handle doesn't mint a cache entry
      // (and a worker round-trip) per pointer move
      width: Math.round(element.width),
      height: Math.round(element.height),
      props: { ...shape.defaultProps.props, ...ref.props },
      strokeColor,
      backgroundColor,
      strokeWidth: element.strokeWidth,
      theme: isDarkMode ? THEME.DARK : THEME.LIGHT,
    };

    const cacheKey = getRenderCacheKey(renderContext, shape.packId);
    const ops = this.renderCache.get(cacheKey);

    if (!ops) {
      this.requestRender(shape, renderContext, cacheKey);
      return false;
    }

    paintDrawOps(canvasContext, ops, {
      strokeColor,
      backgroundColor,
      strokeWidth: element.strokeWidth,
    });

    return true;
  }

  private requestRender(
    shape: ShapeDescriptor,
    context: ShapeRenderContext,
    cacheKey: string,
  ) {
    const pack = this.packs.get(shape.packId);

    if (
      !pack ||
      this.inFlight.has(cacheKey) ||
      pack.sandbox.pendingRenderCount >= MAX_CONCURRENT_RENDERS
    ) {
      return;
    }

    this.inFlight.add(cacheKey);

    pack.sandbox
      .render(context)
      .then((rawOps) => {
        const validated = validateDrawOps(rawOps);

        if (!validated.ok) {
          this.disableShape(
            shape,
            new ShapePackError(
              "SHAPE_RENDER_FAILED",
              `shape "${shape.key}" returned an invalid display list: ${validated.reason}`,
              { packId: shape.packId, shapeId: shape.id },
            ),
          );
          return;
        }

        if (this.renderCache.size >= SHAPE_PACK_LIMITS.maxRenderCacheEntries) {
          this.renderCache.clear();
        }
        this.renderCache.set(cacheKey, validated.ops);
        this.bumpRevision();
        this.emitter.trigger({ type: "render", revision: this.revision });
      })
      .catch((error: unknown) => {
        this.disableShape(
          shape,
          error instanceof ShapePackError
            ? error
            : new ShapePackError(
                "SHAPE_RENDER_FAILED",
                `shape "${shape.key}" failed to render`,
                { packId: shape.packId, shapeId: shape.id },
              ),
        );
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
  }

  private disableShape(shape: ShapeDescriptor, error: ShapePackError) {
    if (this.disabledShapes.has(shape.key)) {
      return;
    }
    this.disabledShapes.add(shape.key);
    this.bumpRevision();
    this.emitter.trigger({ type: "error", error });
  }

  private bumpRevision() {
    this.revision++;
  }

  private fail(error: ShapePackError): ShapePackLoadResult {
    this.emitter.trigger({ type: "error", error });
    return { status: "error", error };
  }
}
