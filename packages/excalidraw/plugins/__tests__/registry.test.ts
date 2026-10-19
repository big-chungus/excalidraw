import { newElement } from "@excalidraw/element";

import { newShapePackElement } from "../element";
import { ShapePackRegistry } from "../registry";

import {
  createFakeWorkerFactory,
  createTestRegistry,
  VALID_PACK_SOURCE,
} from "./helpers";

import type { ShapePackEvent } from "../registry";
import type { ShapeDescriptor } from "../types";

const createCanvasContext = () => {
  const calls: string[] = [];
  const context = {
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => {},
    closePath: () => {},
    rect: () => {},
    roundRect: () => {},
    ellipse: () => {},
    moveTo: () => {},
    lineTo: () => {},
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    fillText: (text: string) => calls.push(`fillText(${text})`),
    setLineDash: () => {},
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

const nextEvent = (registry: ShapePackRegistry, type: ShapePackEvent["type"]) =>
  new Promise<ShapePackEvent>((resolve) => {
    const unsubscribe = registry.onEvent((event) => {
      if (event.type === type) {
        unsubscribe();
        resolve(event);
      }
    });
  });

const loadTestPack = async (registry: ShapePackRegistry) => {
  const result = await registry.load("https://packs.test/pack.js");

  if (result.status === "error") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.pack;
};

describe("ShapePackRegistry", () => {
  describe("loading", () => {
    it("registers a pack and its shapes", async () => {
      const registry = createTestRegistry(VALID_PACK_SOURCE);
      const pack = await loadTestPack(registry);

      expect(pack.id).toBe("test-pack");
      expect(registry.getPacks()).toHaveLength(1);
      expect(registry.getShapes().map((shape) => shape.key)).toEqual([
        "test-pack:box",
      ]);
      expect(registry.getShape("test-pack", "box")?.label).toBe("Box");
      expect(registry.getShape("test-pack", "missing")).toBeNull();

      registry.destroy();
    });

    it("emits a loaded event", async () => {
      const registry = createTestRegistry(VALID_PACK_SOURCE);
      const loaded = nextEvent(registry, "loaded");

      await loadTestPack(registry);

      expect(await loaded).toMatchObject({ type: "loaded" });

      registry.destroy();
    });

    it("reports a failed fetch instead of throwing", async () => {
      const registry = new ShapePackRegistry({
        workerFactory: createFakeWorkerFactory(),
        loadSource: async () => {
          throw new Error("404 Not Found");
        },
      });

      const result = await registry.load("https://packs.test/missing.js");

      expect(result).toMatchObject({ status: "error" });
      expect(result.status === "error" && result.error.code).toBe(
        "PACK_FETCH_FAILED",
      );
      expect(registry.getPacks()).toHaveLength(0);

      registry.destroy();
    });

    it("refuses a second pack with the same id and keeps the first", async () => {
      const registry = createTestRegistry(VALID_PACK_SOURCE);

      await loadTestPack(registry);
      const result = await registry.load("https://packs.test/pack.js");

      expect(result.status === "error" && result.error.code).toBe(
        "PACK_DUPLICATE_ID",
      );
      expect(registry.getPacks()).toHaveLength(1);

      registry.destroy();
    });

    it("stays usable after destroy, as a StrictMode remount requires", async () => {
      const registry = createTestRegistry(VALID_PACK_SOURCE);

      await loadTestPack(registry);
      registry.destroy();

      expect(registry.getPacks()).toHaveLength(0);

      await loadTestPack(registry);

      expect(registry.getShapes().map((shape) => shape.key)).toEqual([
        "test-pack:box",
      ]);

      registry.destroy();
    });

    it("discards a load that was in flight when the registry was reset", async () => {
      let release: (source: string) => void = () => {};
      const registry = new ShapePackRegistry({
        workerFactory: createFakeWorkerFactory(),
        loadSource: () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      });

      const loading = registry.load("https://packs.test/pack.js");
      registry.destroy();
      release(VALID_PACK_SOURCE);

      const result = await loading;

      expect(result.status === "error" && result.error.code).toBe(
        "PACK_SANDBOX_UNAVAILABLE",
      );
      expect(registry.getPacks()).toHaveLength(0);
    });

    it("does not register a pack whose manifest is invalid", async () => {
      const registry = createTestRegistry(
        `excalidraw.registerShapePack({
           id: "bad pack", name: "Bad", apiVersion: 1,
           shapes: [{ id: "x", label: "X", render: function () { return []; } }],
         });`,
      );

      const result = await registry.load("https://packs.test/bad.js");

      expect(result.status === "error" && result.error.code).toBe(
        "PACK_INVALID_MANIFEST",
      );
      expect(registry.getShapes()).toHaveLength(0);

      registry.destroy();
    });
  });

  describe("rendering", () => {
    const paintOnce = (
      registry: ShapePackRegistry,
      shape: ShapeDescriptor,
      element = newShapePackElement(shape, { x: 0, y: 0 }),
    ) => {
      const { context, calls } = createCanvasContext();
      const painted = registry.renderSource.drawShape(element, context, {
        theme: "light",
      });

      return { painted, calls, element };
    };

    it("falls back to the base shape until the pack's render resolves", async () => {
      const registry = createTestRegistry(VALID_PACK_SOURCE);
      await loadTestPack(registry);
      const shape = registry.getShape("test-pack", "box")!;
      const element = newShapePackElement(shape, { x: 0, y: 0 });

      const rendered = nextEvent(registry, "render");
      const first = paintOnce(registry, shape, element);

      expect(first.painted).toBe(false);
      expect(first.calls).toHaveLength(0);

      await rendered;

      const second = paintOnce(registry, shape, element);

      expect(second.painted).toBe(true);
      expect(second.calls).toContain("fillText(calm)");

      registry.destroy();
    });

    it("bumps the render revision only for pack-backed elements", async () => {
      const registry = createTestRegistry(VALID_PACK_SOURCE);
      await loadTestPack(registry);
      const shape = registry.getShape("test-pack", "box")!;
      const element = newShapePackElement(shape, { x: 0, y: 0 });
      const plainElement = newElement({ type: "rectangle", x: 0, y: 0 });

      const before = registry.renderSource.getRenderRevision(element);
      const rendered = nextEvent(registry, "render");
      paintOnce(registry, shape, element);
      await rendered;

      expect(registry.renderSource.getRenderRevision(element)).toBeGreaterThan(
        before,
      );
      expect(registry.renderSource.getRenderRevision(plainElement)).toBe(0);

      registry.destroy();
    });

    it("degrades elements of a pack that was never loaded", () => {
      const registry = createTestRegistry(VALID_PACK_SOURCE);
      const element = newShapePackElement(
        {
          packId: "ghost",
          id: "box",
          key: "ghost:box",
          label: "Box",
          icon: null,
          defaultProps: {
            width: 10,
            height: 10,
            fallback: "diamond",
            props: {},
          },
        },
        { x: 0, y: 0 },
      );

      const { context } = createCanvasContext();

      expect(
        registry.renderSource.drawShape(element, context, { theme: "light" }),
      ).toBe(false);
      expect(element.type).toBe("diamond");

      registry.destroy();
    });

    it("degrades the element again once the pack is unloaded", async () => {
      const registry = createTestRegistry(VALID_PACK_SOURCE);
      await loadTestPack(registry);
      const shape = registry.getShape("test-pack", "box")!;
      const element = newShapePackElement(shape, { x: 0, y: 0 });

      const rendered = nextEvent(registry, "render");
      paintOnce(registry, shape, element);
      await rendered;

      expect(paintOnce(registry, shape, element).painted).toBe(true);

      registry.unload("test-pack");

      expect(paintOnce(registry, shape, element).painted).toBe(false);
      expect(registry.getShapes()).toHaveLength(0);

      registry.destroy();
    });

    it("disables a shape whose render fails, and reports it once", async () => {
      const registry = createTestRegistry(
        `excalidraw.registerShapePack({
           id: "broken", name: "Broken", apiVersion: 1,
           shapes: [{
             id: "box", label: "Box",
             render: function () { throw new Error("render boom"); },
           }],
         });`,
      );

      const errors: ShapePackEvent[] = [];
      registry.onEvent((event) => {
        if (event.type === "error") {
          errors.push(event);
        }
      });

      await loadTestPack(registry);
      const shape = registry.getShape("broken", "box")!;
      const element = newShapePackElement(shape, { x: 0, y: 0 });
      const { context } = createCanvasContext();

      registry.renderSource.drawShape(element, context, { theme: "light" });
      await vi.waitFor(() => expect(errors).toHaveLength(1));

      // further repaints keep degrading silently instead of re-asking
      registry.renderSource.drawShape(element, context, { theme: "light" });
      registry.renderSource.drawShape(element, context, { theme: "light" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errors).toHaveLength(1);
      expect((errors[0] as any).error.code).toBe("SHAPE_RENDER_FAILED");

      registry.destroy();
    });

    it("disables a shape returning an invalid display list", async () => {
      const registry = createTestRegistry(
        `excalidraw.registerShapePack({
           id: "sloppy", name: "Sloppy", apiVersion: 1,
           shapes: [{
             id: "box", label: "Box",
             render: function () { return [{ op: "teleport" }]; },
           }],
         });`,
      );

      const error = nextEvent(registry, "error");

      await loadTestPack(registry);
      const shape = registry.getShape("sloppy", "box")!;
      const { context } = createCanvasContext();

      registry.renderSource.drawShape(
        newShapePackElement(shape, { x: 0, y: 0 }),
        context,
        { theme: "light" },
      );

      expect((await error) as any).toMatchObject({
        error: { code: "SHAPE_RENDER_FAILED" },
      });

      registry.destroy();
    });
  });
});
