# Runtime shape packs

A **shape pack** is a script, loaded at runtime, that contributes shapes to the editor: an id, a label, an icon, default props, and a `render` hook that returns a display list. Packs are not bundled, not installed and not trusted — they are fetched by the host, evaluated inside a worker sandbox with no network and no storage, and can only hand back JSON.

Status: **the contract is v1 and deliberately small.** It is meant to be grown additively; see [Not in v1](#not-in-v1) for what is intentionally missing.

```
host                      editor (ShapePackRegistry)             worker sandbox
 │   load(url) ───────────▶ fetch source                                │
 │                          start worker, post {init, source} ──────────▶
 │                                                        evaluate pack │
 │                          ◀──────────────────── {ready, manifest}     │
 │   ◀── {status:"ok"}      validate + register                         │
 │                                                                      │
 │        (repaint)         drawShape(element) → cache miss ────────────▶
 │                          ◀───────────────── {render:ok, ops}  render()│
 │                          validate ops, cache, bump revision          │
 │                          (editor repaints, pack shape appears)       │
```

## Writing a pack

A pack is a plain script. It is evaluated with one parameter in scope, `excalidraw`, and must call `registerShapePack` exactly once:

```js
excalidraw.registerShapePack({
  id: "network", // unique across packs, /^[a-z0-9][a-z0-9-_]*$/
  name: "Network gear",
  version: "1.0.0", // your pack's version, informational
  apiVersion: 1, // the contract version you wrote against
  shapes: [
    {
      id: "router", // unique within the pack
      label: "Router",
      icon: [{ op: "rect", x: 2, y: 10, width: 20, height: 10 }],
      defaultProps: {
        width: 140,
        height: 90,
        fallback: "rectangle",
        props: { ports: 4 },
      },
      render(context) {
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
        ];
      },
    },
  ],
});
```

A complete example lives in [`examples/shape-pack`](../../../examples/shape-pack).

### `render(context)`

`context` is a flat, frozen snapshot — never the element itself:

| field | meaning |
| --- | --- |
| `shapeId` | which of your shapes is being drawn |
| `width`, `height` | element size in scene px, rounded to integers |
| `props` | `defaultProps.props` merged with the element's own |
| `strokeColor`, `backgroundColor` | the element's colors, adjusted for the theme |
| `strokeWidth` | the element's stroke width |
| `theme` | `"light"` or `"dark"` |

`render` must be **pure and deterministic**: the editor caches its output per (shape, size, props, colors, theme) and will reuse it for every element with the same appearance. It must also be fast — it is cut off at `SHAPE_PACK_LIMITS.renderTimeout` (1s).

### Display list

`render` returns an array of draw ops in element-local coordinates: `(0, 0)` is the element's top-left corner, `(width, height)` its bottom-right. Position, rotation, zoom and element opacity are applied by the editor.

| op | fields |
| --- | --- |
| `path` | `d` (SVG path data) |
| `rect` | `x`, `y`, `width`, `height`, `radius?` |
| `ellipse` | `cx`, `cy`, `rx`, `ry` |
| `polyline` | `points: [x, y][]`, `closed?` |
| `text` | `x`, `y`, `text`, `fontSize?`, `fontFamily?`, `align?`, `color?` |

All but `text` also take `stroke`, `fill`, `strokeWidth`, `opacity` and `dash`.

Colors are either a CSS color (hex / `rgb()` / `rgba()` / `hsl()` / `hsla()` / `transparent`) or one of two tokens that resolve against the element, so your shape follows the user's color pickers:

- `"stroke"` → the element's stroke color
- `"background"` → the element's background color

Literal colors are used as-is, including in dark mode — use the tokens (or `context.theme`) if you want your shape to adapt.

Anything else — an unknown op, a non-finite number, a color the editor doesn't recognise, a display list over `SHAPE_PACK_LIMITS.maxOpsPerShape` — invalidates the whole display list. The shape is then disabled (see [Failure modes](#failure-modes)).

## Loading a pack

```ts
const result = await excalidrawAPI.shapePacks.load(url);

if (result.status === "error") {
  console.error(result.error.code, result.error.message);
}
```

`load()` **never rejects and never throws into the editor.** Every failure comes back as a coded `ShapePackError`, and is additionally emitted on `shapePacks.onEvent()` — which is how the editor turns pack failures into a toast.

Registry surface:

| method | notes |
| --- | --- |
| `load(url)` | fetch → sandbox → validate → register, atomically |
| `unload(packId)` | terminates the worker and drops the pack's shapes |
| `getPacks()` / `getPack(id)` | loaded packs |
| `getShapes()` / `getShape()` | registered shapes (id, label, icon, default props) |
| `onEvent(cb)` | `loaded` / `unloaded` / `render` / `error` |
| `destroy()` | called by the editor on unmount |

## Elements

A pack shape is **not** a new element type. `newShapePackElement()` creates an ordinary `rectangle` / `ellipse` / `diamond` (whichever the shape declares as its `fallback`) carrying a reference in `customData`:

```json
{
  "type": "rectangle",
  "customData": {
    "shapePack": {
      "packId": "network",
      "shapeId": "router",
      "apiVersion": 1,
      "props": { "ports": 6 }
    }
  }
}
```

That is what makes degradation free: a scene full of pack shapes opened **without** the pack is still a valid scene — the elements render, export, bind arrows, resize and round-trip as their base shape. Loading the pack later upgrades them in place; unloading it drops them back.

The tradeoff is that pack shapes get their base shape's geometry: hit-testing, bounds and arrow binding follow the rectangle/ellipse/diamond, not the drawing. Custom geometry would need a first-class element type, which would break every older client that reads the scene — not a price worth paying until the contract has proven itself.

## Sandbox

Each pack gets its own worker. Before any pack code runs, the worker runtime ([`sandboxSource.ts`](./sandboxSource.ts)) removes the network and storage globals from the realm:

- replaced with throwing stubs: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `Worker`, `SharedWorker`, `BroadcastChannel`, `Notification`, `eval`
- removed: `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `navigator`, `location`, `document`, `window`, `cookieStore`

Pack code is then evaluated with those names additionally shadowed as parameters, so the common cases fail with a clear message instead of a `TypeError`. Because the globals are gone from the realm itself, there is no way back to them — `Function("return this")()` reaches the same hardened global.

What the sandbox does **not** do: stop a pack from burning CPU (the host guards that with timeouts and by terminating the worker), and it is not a defence against a pack that merely draws something misleading. Packs are still code you chose to load.

Nothing but JSON crosses the boundary in either direction: the manifest is round-tripped through `JSON` inside the worker, so pack functions and DOM handles can never reach the editor, and the editor only sends the flat render context back.

## Failure modes

Every one of these is reported, never thrown, and always leaves the affected elements rendering as their base shape.

| `ShapePackError["code"]` | when |
| --- | --- |
| `PACK_FETCH_FAILED` | the source couldn't be fetched, or is over the size limit |
| `PACK_SANDBOX_UNAVAILABLE` | no `Worker` support (e.g. SSR), or the worker wouldn't start |
| `PACK_TIMEOUT` | registration or a `render` call exceeded its budget |
| `PACK_INVALID_MANIFEST` | the pack registered something malformed |
| `PACK_API_VERSION_MISMATCH` | `apiVersion` isn't the one this editor implements |
| `PACK_DUPLICATE_ID` | a pack with this id is already loaded |
| `SHAPE_DUPLICATE_ID` | two shapes in the pack share an id |
| `PACK_RUNTIME_ERROR` | pack code threw while loading, or the worker crashed |
| `SHAPE_RENDER_FAILED` | `render` threw or returned an invalid display list |

Two policies worth knowing:

- **Registration is atomic.** A pack with one bad shape is rejected whole, so a pack is never half-registered.
- **A shape that fails to render is disabled** until its pack is reloaded. It keeps rendering as its base shape, and the error is reported once — a broken shape can't spam the worker, or the user, on every repaint.

## Versioning

A pack declares `apiVersion`; the editor accepts it only when it equals `SHAPE_PACK_API_VERSION`. Additive changes to the contract will widen that to a range; anything that breaks packs bumps the version. Elements store the `apiVersion` they were authored with, so a future editor can migrate them.

## Not in v1

Deliberately out of scope, each one an additive follow-up:

- a toolbar entry / shape picker for pack shapes (hosts can build one today from `getShapes()` and `paintDrawOps`)
- custom hit-testing, bounds and binding geometry
- SVG export and `exportToCanvas`: pack shapes export as their base shape, because those paths build their own render config outside the editor
- pack-defined style controls, interaction handlers and element-type conversion
- pack discovery, marketplace, signing
