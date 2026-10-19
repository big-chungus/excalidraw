# Example shape pack

`network-shapes.pack.js` is a runtime-loaded Excalidraw shape pack. It adds two shapes — a router and a cloud — and needs no build step and no rebuild of the editor: it is a single script, served over HTTP, evaluated inside a worker sandbox with no network and no storage access.

## Try it

Serve this folder (any static server will do):

```bash
npx http-server examples/shape-pack -p 5101 --cors
```

Then, from the host app embedding `<Excalidraw />`:

```ts
const result = await excalidrawAPI.shapePacks.load(
  "http://localhost:5101/network-shapes.pack.js",
);

if (result.status === "error") {
  // every failure mode is reported, never thrown
  console.error(result.error.code, result.error.message);
} else {
  const router = excalidrawAPI.shapePacks.getShape("network", "router")!;

  excalidrawAPI.updateScene({
    elements: [
      ...excalidrawAPI.getSceneElements(),
      newShapePackElement(router, { x: 100, y: 100, props: { ports: 6 } }),
    ],
  });
}
```

The editor has no toolbar entry for pack shapes yet — hosts insert them through the imperative API, and can build their own picker from `excalidrawAPI.shapePacks.getShapes()` (each shape carries an `icon` display list that `paintDrawOps` can render).

## What to look at

- `render(context)` returns a display list, not canvas calls. The pack never touches a canvas, the DOM, or the scene.
- Colors use the `"stroke"` / `"background"` tokens, so the shapes follow the user's color pickers and the current theme.
- `defaultProps.fallback` decides what the element degrades to: open a scene containing these shapes without loading the pack and the routers render as rectangles, the clouds as ellipses — still selectable, bindable and exportable.

The contract, its versioning rules and every failure mode are documented in [`packages/excalidraw/plugins/README.md`](../../packages/excalidraw/plugins/README.md).
