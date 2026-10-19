import { ShapePackRegistry } from "../registry";

import type { ShapePackRegistryOptions } from "../registry";
import type { ShapePackWorker, ShapePackWorkerFactory } from "../types";

/**
 * Runs the real sandbox runtime source in-process, against a stand-in global.
 *
 * jsdom has no `Worker`, and we want the tests to exercise the exact script
 * that ships rather than a mock of it: the source is evaluated with `self`
 * bound to a plain object, which is also what makes the global hardening
 * observable from a test.
 */
export const createFakeWorkerFactory = (): ShapePackWorkerFactory => {
  return (source) => {
    const scope: any = {
      onmessage: null,
      postMessage: (data: any) => {
        queueMicrotask(() => worker.onmessage?.({ data }));
      },
    };

    const worker: ShapePackWorker = {
      onmessage: null,
      onerror: null,
      postMessage: (message: any) => {
        queueMicrotask(() => scope.onmessage?.({ data: message }));
      },
      terminate: () => {
        scope.onmessage = null;
      },
    };

    // eslint-disable-next-line no-new-func
    new Function("self", source)(scope);

    return worker;
  };
};

/** A worker that boots but never answers — for timeout coverage. */
export const createSilentWorkerFactory = (): ShapePackWorkerFactory => () => ({
  onmessage: null,
  onerror: null,
  postMessage: () => {},
  terminate: () => {},
});

export const createTestRegistry = (
  source: string,
  options: ShapePackRegistryOptions = {},
) =>
  new ShapePackRegistry({
    workerFactory: createFakeWorkerFactory(),
    loadSource: async () => source,
    ...options,
  });

export const VALID_PACK_SOURCE = `
excalidraw.registerShapePack({
  id: "test-pack",
  name: "Test pack",
  version: "1.0.0",
  apiVersion: 1,
  shapes: [
    {
      id: "box",
      label: "Box",
      icon: [{ op: "rect", x: 0, y: 0, width: 24, height: 24 }],
      defaultProps: { width: 100, height: 60, fallback: "rectangle", props: { tone: "calm" } },
      render: function (context) {
        return [
          {
            op: "rect",
            x: 0,
            y: 0,
            width: context.width,
            height: context.height,
            fill: "background",
            stroke: "stroke",
          },
          { op: "text", x: 2, y: 12, text: String(context.props.tone) },
        ];
      },
    },
  ],
});
`;
