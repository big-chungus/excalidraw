import vm from "node:vm";

import { ShapePackError } from "../errors";
import { ShapePackSandbox } from "../sandbox";
import { createShapePackSandboxSource } from "../sandboxSource";

import {
  createFakeWorkerFactory,
  createSilentWorkerFactory,
  VALID_PACK_SOURCE,
} from "./helpers";

import type { ShapeRenderContext } from "../types";

const load = (packSource: string, overrides: Record<string, any> = {}) =>
  ShapePackSandbox.load({
    packSource,
    url: "https://packs.test/pack.js",
    workerFactory: createFakeWorkerFactory(),
    ...overrides,
  });

const renderContext = (
  overrides: Partial<ShapeRenderContext> = {},
): ShapeRenderContext => ({
  shapeId: "box",
  width: 100,
  height: 60,
  props: {},
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  strokeWidth: 2,
  theme: "light",
  ...overrides,
});

const expectShapePackError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ShapePackError);
    return error as ShapePackError;
  }
  throw new Error("expected the promise to reject");
};

describe("shape pack sandbox", () => {
  it("evaluates a pack and returns its manifest", async () => {
    const { manifest } = await load(VALID_PACK_SOURCE);

    expect(manifest).toMatchObject({
      id: "test-pack",
      apiVersion: 1,
      shapes: [{ id: "box", label: "Box" }],
    });
  });

  it("strips pack code from the manifest", async () => {
    const { manifest } = await load(VALID_PACK_SOURCE);

    expect((manifest as any).shapes[0].render).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("function");
  });

  it("renders through the sandbox", async () => {
    const { sandbox } = await load(VALID_PACK_SOURCE);

    const ops = await sandbox.render(
      renderContext({ props: { tone: "loud" } }),
    );

    expect(ops).toEqual([
      {
        op: "rect",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        fill: "background",
        stroke: "stroke",
      },
      { op: "text", x: 2, y: 12, text: "loud" },
    ]);
  });

  describe("hardening", () => {
    const BLOCKED_CALLS = [
      ["fetch", `fetch("https://example.com")`],
      ["XMLHttpRequest", `new XMLHttpRequest()`],
      ["WebSocket", `new WebSocket("wss://example.com")`],
      ["importScripts", `importScripts("https://example.com/x.js")`],
      ["Worker", `new Worker("x.js")`],
    ] as const;

    for (const [name, expression] of BLOCKED_CALLS) {
      it(`blocks ${name} by default`, async () => {
        const error = await expectShapePackError(
          load(`${expression};\nexcalidraw.registerShapePack({});`),
        );

        expect(error.code).toBe("PACK_RUNTIME_ERROR");
        expect(error.message).toContain(
          `${name}() is not available inside the shape pack sandbox`,
        );
      });
    }

    const BLOCKED_NAMESPACES = [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "caches",
      "navigator",
      "document",
    ];

    for (const name of BLOCKED_NAMESPACES) {
      it(`blocks ${name} by default`, async () => {
        const error = await expectShapePackError(
          load(`${name}.anything;\nexcalidraw.registerShapePack({});`),
        );

        // reading a property off the removed global is a plain TypeError
        expect(error.code).toBe("PACK_RUNTIME_ERROR");
        expect(error.message).toMatch(/undefined/);
      });
    }

    it("leaves nothing reachable even when pack code escapes to the realm global", () => {
      // the fake worker shares this file's realm, so the realm-level
      // guarantee is checked in a real separate realm instead
      const messages: any[] = [];
      const realm: any = {
        fetch: () => "real fetch",
        localStorage: { getItem: () => "real storage" },
        postMessage: (data: any) => messages.push(data),
        onmessage: null,
      };
      realm.self = realm;
      vm.createContext(realm);
      vm.runInContext(createShapePackSandboxSource(), realm);

      realm.onmessage({
        data: {
          type: "init",
          apiVersion: 1,
          source: `
            var escaped = ({}).constructor.constructor("return this")();
            var storage = typeof escaped.localStorage;
            var network;
            try {
              escaped.fetch("https://example.com");
              network = "reachable";
            } catch (error) {
              network = "blocked";
            }
            excalidraw.registerShapePack({
              id: "probe",
              name: storage + "/" + network,
              apiVersion: 1,
              shapes: [{ id: "x", label: "X", render: function () { return []; } }],
            });
          `,
        },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].manifest.name).toBe("undefined/blocked");
    });

    it("removes network and storage globals from the realm itself", () => {
      const scope: any = { postMessage: () => {}, onmessage: null };

      // eslint-disable-next-line no-new-func
      new Function("self", createShapePackSandboxSource())(scope);

      expect(() => scope.fetch("https://example.com")).toThrow(
        /not available inside the shape pack sandbox/,
      );
      expect(() => new scope.WebSocket("wss://example.com")).toThrow();
      expect(scope.localStorage).toBeUndefined();
      expect(scope.indexedDB).toBeUndefined();
      expect(scope.caches).toBeUndefined();
      expect(scope.navigator).toBeUndefined();
    });
  });

  describe("failure modes", () => {
    it("reports a pack that throws while loading", async () => {
      const error = await expectShapePackError(
        load(`throw new Error("boom");`),
      );

      expect(error.code).toBe("PACK_RUNTIME_ERROR");
      expect(error.message).toContain("boom");
    });

    it("reports a pack that never registers", async () => {
      const error = await expectShapePackError(load(`var noop = 1;`));

      expect(error.code).toBe("PACK_INVALID_MANIFEST");
      expect(error.message).toContain("registerShapePack");
    });

    it("reports a pack that registers twice", async () => {
      const error = await expectShapePackError(
        load(
          `excalidraw.registerShapePack({ id: "a", name: "A", apiVersion: 1, shapes: [] });
           excalidraw.registerShapePack({ id: "b", name: "B", apiVersion: 1, shapes: [] });`,
        ),
      );

      expect(error.code).toBe("PACK_RUNTIME_ERROR");
      expect(error.message).toContain("exactly once");
    });

    it("reports a shape without a render hook", async () => {
      const error = await expectShapePackError(
        load(
          `excalidraw.registerShapePack({
             id: "a", name: "A", apiVersion: 1,
             shapes: [{ id: "x", label: "X" }],
           });`,
        ),
      );

      expect(error.code).toBe("PACK_INVALID_MANIFEST");
      expect(error.message).toContain("render()");
    });

    it("times out a pack that never registers in time", async () => {
      vi.useFakeTimers();
      try {
        const promise = load(VALID_PACK_SOURCE, {
          workerFactory: createSilentWorkerFactory(),
          initTimeout: 100,
        });
        const assertion = expectShapePackError(promise);

        await vi.advanceTimersByTimeAsync(150);

        expect((await assertion).code).toBe("PACK_TIMEOUT");
      } finally {
        vi.useRealTimers();
      }
    });

    it("surfaces a render that throws", async () => {
      const { sandbox } = await load(
        `excalidraw.registerShapePack({
           id: "a", name: "A", apiVersion: 1,
           shapes: [{
             id: "x", label: "X",
             render: function () { throw new Error("render boom"); },
           }],
         });`,
      );

      const error = await expectShapePackError(
        sandbox.render(renderContext({ shapeId: "x" })),
      );

      expect(error.code).toBe("SHAPE_RENDER_FAILED");
      expect(error.message).toContain("render boom");
    });

    it("rejects renders once destroyed", async () => {
      const { sandbox } = await load(VALID_PACK_SOURCE);

      sandbox.destroy();

      const error = await expectShapePackError(sandbox.render(renderContext()));

      expect(error.code).toBe("SHAPE_RENDER_FAILED");
    });
  });
});
