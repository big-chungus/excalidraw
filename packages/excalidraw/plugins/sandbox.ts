/**
 * Worker-backed sandbox hosting a single shape pack.
 *
 * One sandbox owns one worker owns one pack: a pack that hangs, throws or is
 * terminated can only affect its own shapes. The sandbox speaks a tiny
 * request/response protocol and times every exchange out, so the editor never
 * waits on pack code.
 */

import { SHAPE_PACK_API_VERSION, SHAPE_PACK_LIMITS } from "./constants";
import { ShapePackError } from "./errors";
import { createShapePackSandboxSource } from "./sandboxSource";

import type {
  ShapeRenderContext,
  ShapePackWorker,
  ShapePackWorkerFactory,
} from "./types";

export const isShapePackSandboxSupported = () =>
  typeof Worker !== "undefined" &&
  typeof Blob !== "undefined" &&
  typeof URL !== "undefined" &&
  typeof URL.createObjectURL === "function";

export const createWorkerFromSource: ShapePackWorkerFactory = (source) => {
  const objectURL = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  const worker = new Worker(objectURL);
  const revoke = () => URL.revokeObjectURL(objectURL);

  worker.addEventListener("message", revoke, { once: true });
  worker.addEventListener("error", revoke, { once: true });

  return worker;
};

type PendingRender = {
  resolve: (ops: unknown) => void;
  reject: (error: ShapePackError) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type ShapePackSandboxOptions = {
  packSource: string;
  /** only used for error messages */
  url: string;
  workerFactory?: ShapePackWorkerFactory;
  initTimeout?: number;
  renderTimeout?: number;
};

export class ShapePackSandbox {
  private worker: ShapePackWorker | null = null;

  private pendingRenders = new Map<number, PendingRender>();

  private nextRequestId = 0;

  private destroyed = false;

  private readonly renderTimeout: number;

  private readonly url: string;

  private onReady:
    | ((result: { manifest: unknown } | { error: ShapePackError }) => void)
    | null = null;

  private constructor(options: ShapePackSandboxOptions) {
    this.url = options.url;
    this.renderTimeout =
      options.renderTimeout ?? SHAPE_PACK_LIMITS.renderTimeout;
  }

  /**
   * Boots a worker, evaluates the pack inside it and resolves with the raw
   * (unvalidated) manifest the pack registered.
   *
   * Rejects with a {@link ShapePackError} — never with a bare `Error` — and
   * always leaves the worker terminated on failure.
   */
  public static load(
    options: ShapePackSandboxOptions,
  ): Promise<{ sandbox: ShapePackSandbox; manifest: unknown }> {
    const sandbox = new ShapePackSandbox(options);
    const workerFactory = options.workerFactory ?? createWorkerFromSource;

    if (!options.workerFactory && !isShapePackSandboxSupported()) {
      return Promise.reject(
        new ShapePackError(
          "PACK_SANDBOX_UNAVAILABLE",
          "this environment has no Web Worker support, shape packs cannot be sandboxed",
        ),
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        finish({
          error: new ShapePackError(
            "PACK_TIMEOUT",
            `pack at ${options.url} did not register within ${
              options.initTimeout ?? SHAPE_PACK_LIMITS.initTimeout
            }ms`,
          ),
        });
      }, options.initTimeout ?? SHAPE_PACK_LIMITS.initTimeout);

      const finish = (
        result: { manifest: unknown } | { error: ShapePackError },
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        sandbox.onReady = null;

        if ("error" in result) {
          sandbox.destroy();
          reject(result.error);
        } else {
          resolve({ sandbox, manifest: result.manifest });
        }
      };

      sandbox.onReady = finish;

      try {
        const worker = workerFactory(createShapePackSandboxSource());
        sandbox.attach(worker);
        worker.postMessage({
          type: "init",
          source: options.packSource,
          apiVersion: SHAPE_PACK_API_VERSION,
        });
      } catch (error: any) {
        finish({
          error: new ShapePackError(
            "PACK_SANDBOX_UNAVAILABLE",
            `could not start the sandbox worker: ${error?.message ?? error}`,
          ),
        });
      }
    });
  }

  private attach(worker: ShapePackWorker) {
    this.worker = worker;
    worker.onmessage = (event: any) => this.handleMessage(event?.data);
    worker.onerror = (event: any) => {
      const error = new ShapePackError(
        "PACK_RUNTIME_ERROR",
        `pack at ${this.url} crashed: ${event?.message ?? "unknown error"}`,
      );
      this.onReady?.({ error });
      this.rejectAllPending(error);
    };
  }

  private handleMessage(message: any) {
    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case "ready":
        this.onReady?.({ manifest: message.manifest });
        break;
      case "error":
        this.onReady?.({
          error: new ShapePackError(
            message.code === "PACK_INVALID_MANIFEST"
              ? "PACK_INVALID_MANIFEST"
              : "PACK_RUNTIME_ERROR",
            String(message.message ?? "pack failed to load"),
          ),
        });
        break;
      case "render:ok": {
        const pending = this.takePending(message.requestId);
        pending?.resolve(message.ops);
        break;
      }
      case "render:error": {
        const pending = this.takePending(message.requestId);
        pending?.reject(
          new ShapePackError(
            "SHAPE_RENDER_FAILED",
            String(message.message ?? "render failed"),
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  private takePending(requestId: unknown) {
    if (typeof requestId !== "number") {
      return null;
    }
    const pending = this.pendingRenders.get(requestId);
    if (!pending) {
      return null;
    }
    clearTimeout(pending.timeout);
    this.pendingRenders.delete(requestId);
    return pending;
  }

  private rejectAllPending(error: ShapePackError) {
    for (const [requestId] of [...this.pendingRenders]) {
      this.takePending(requestId)?.reject(error);
    }
  }

  public get pendingRenderCount() {
    return this.pendingRenders.size;
  }

  /** Resolves with the raw display list; the host validates it. */
  public render(context: ShapeRenderContext): Promise<unknown> {
    if (this.destroyed || !this.worker) {
      return Promise.reject(
        new ShapePackError(
          "SHAPE_RENDER_FAILED",
          "sandbox is no longer alive",
          {
            shapeId: context.shapeId,
          },
        ),
      );
    }

    const requestId = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRenders.delete(requestId);
        reject(
          new ShapePackError(
            "PACK_TIMEOUT",
            `rendering "${context.shapeId}" exceeded ${this.renderTimeout}ms`,
            { shapeId: context.shapeId },
          ),
        );
      }, this.renderTimeout);

      this.pendingRenders.set(requestId, { resolve, reject, timeout });
      this.worker?.postMessage({ type: "render", requestId, context });
    });
  }

  public destroy() {
    this.destroyed = true;
    this.rejectAllPending(
      new ShapePackError("SHAPE_RENDER_FAILED", "sandbox was destroyed"),
    );
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }
}
