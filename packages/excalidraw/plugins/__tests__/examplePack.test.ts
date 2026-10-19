import fs from "fs";
import path from "path";

import { newShapePackElement } from "../element";
import { ShapePackRegistry } from "../registry";

import { createFakeWorkerFactory } from "./helpers";

/**
 * Loads the example pack shipped in `examples/shape-pack` exactly as a host
 * would: as source text, through the sandbox, with no build step.
 */
const EXAMPLE_PACK_PATH = path.resolve(
  __dirname,
  "../../../../examples/shape-pack/network-shapes.pack.js",
);

describe("examples/shape-pack", () => {
  const load = async () => {
    const registry = new ShapePackRegistry({
      workerFactory: createFakeWorkerFactory(),
      loadSource: async () => fs.readFileSync(EXAMPLE_PACK_PATH, "utf8"),
    });

    const result = await registry.load(
      "https://packs.test/network-shapes.pack.js",
    );

    if (result.status === "error") {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }

    return { registry, pack: result.pack };
  };

  it("registers its shapes", async () => {
    const { registry, pack } = await load();

    expect(pack).toMatchObject({ id: "network", name: "Network gear" });
    expect(registry.getShapes().map((shape) => shape.key)).toEqual([
      "network:router",
      "network:cloud",
    ]);
    expect(registry.getShape("network", "router")?.icon).not.toBeNull();

    registry.destroy();
  });

  it("renders its shapes through the sandbox", async () => {
    const { registry } = await load();
    const shape = registry.getShape("network", "router")!;
    const element = newShapePackElement(shape, { x: 0, y: 0 });

    const rendered = new Promise<void>((resolve) => {
      const unsubscribe = registry.onEvent((event) => {
        if (event.type === "render") {
          unsubscribe();
          resolve();
        }
        if (event.type === "error") {
          throw new Error(event.error.message);
        }
      });
    });

    const context = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      rect: () => {},
      roundRect: () => {},
      ellipse: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fill: () => {},
      stroke: () => {},
      fillText: (text: string) => painted.push(text),
      setLineDash: () => {},
    } as unknown as CanvasRenderingContext2D;
    const painted: string[] = [];

    expect(
      registry.renderSource.drawShape(element, context, { theme: "light" }),
    ).toBe(false);

    await rendered;

    expect(
      registry.renderSource.drawShape(element, context, { theme: "light" }),
    ).toBe(true);
    expect(painted).toEqual(["Router"]);

    registry.destroy();
  });

  it("degrades to its declared base shapes without the pack", () => {
    const registry = new ShapePackRegistry({
      workerFactory: createFakeWorkerFactory(),
    });

    const router = newShapePackElement(
      {
        packId: "network",
        id: "router",
        key: "network:router",
        label: "Router",
        icon: null,
        defaultProps: {
          width: 140,
          height: 90,
          fallback: "rectangle",
          props: {},
        },
      },
      { x: 0, y: 0 },
    );

    expect(router.type).toBe("rectangle");
    expect(
      registry.renderSource.drawShape(router, {} as CanvasRenderingContext2D, {
        theme: "light",
      }),
    ).toBe(false);

    registry.destroy();
  });
});
