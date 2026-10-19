/**
 * Source of the script that runs inside the shape pack worker.
 *
 * It is kept as a plain string (rather than a bundled worker entry point) for
 * two reasons: the editor is shipped as a library and must not rely on the
 * host's bundler to emit a worker chunk, and the exact text that ships is the
 * text the tests exercise — `SHAPE_PACK_SANDBOX_RUNTIME_SOURCE` can be
 * evaluated against a stand-in global to assert what a pack can and cannot
 * reach.
 *
 * What the runtime guarantees:
 *
 * 1. Network and storage globals are removed from the worker realm *before*
 *    any pack code runs, so there is no reachable `fetch`/`indexedDB`/… left
 *    in the realm — not even via `Function("return this")()`.
 * 2. Pack code is additionally evaluated with those names shadowed by
 *    parameters, so the common cases fail loudly with a clear message instead
 *    of a `TypeError`.
 * 3. Only JSON data crosses back to the editor: the manifest is round-tripped
 *    through `JSON` before it is posted, so pack functions, DOM handles and
 *    cyclic objects can never reach the host.
 *
 * This is a capability boundary, not a defence against a malicious pack
 * exhausting CPU — the host guards that with timeouts and by terminating the
 * worker.
 */

/** Globals replaced by a function that throws when called or constructed. */
const BLOCKED_CALLABLE_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "Notification",
  "eval",
];

/** Globals removed outright (reading them yields `undefined`). */
const BLOCKED_NAMESPACE_GLOBALS = [
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "navigator",
  "location",
  "document",
  "window",
  "cookieStore",
];

/**
 * Names shadowed as parameters when pack code is evaluated. `eval` is absent
 * on purpose: it is not a legal strict-mode parameter name, and it is covered
 * by the realm-level hardening above.
 */
const SHADOWED_IDENTIFIERS = [
  ...BLOCKED_CALLABLE_GLOBALS.filter((name) => name !== "eval"),
  ...BLOCKED_NAMESPACE_GLOBALS,
  "self",
  "globalThis",
  "postMessage",
  "addEventListener",
  "removeEventListener",
  "close",
  "Function",
];

const json = (value: unknown) => JSON.stringify(value);

/**
 * Defines `__excalidrawShapePackRuntime(scope)`. Exported so tests can run the
 * very same source against a fake scope.
 */
export const SHAPE_PACK_SANDBOX_RUNTIME_SOURCE = `
"use strict";
var __EXCALIDRAW_BLOCKED_CALLABLE = ${json(BLOCKED_CALLABLE_GLOBALS)};
var __EXCALIDRAW_BLOCKED_NAMESPACES = ${json(BLOCKED_NAMESPACE_GLOBALS)};
var __EXCALIDRAW_SHADOWED = ${json(SHADOWED_IDENTIFIERS)};

function __excalidrawShapePackBlocked(name) {
  return function () {
    throw new Error(
      "[excalidraw] " + name + "() is not available inside the shape pack sandbox"
    );
  };
}

function __excalidrawShapePackHarden(scope) {
  var i;
  for (i = 0; i < __EXCALIDRAW_BLOCKED_CALLABLE.length; i++) {
    (function (name) {
      try {
        Object.defineProperty(scope, name, {
          configurable: true,
          writable: true,
          enumerable: false,
          value: __excalidrawShapePackBlocked(name),
        });
      } catch (error) {
        try {
          scope[name] = __excalidrawShapePackBlocked(name);
        } catch (ignored) {}
      }
    })(__EXCALIDRAW_BLOCKED_CALLABLE[i]);
  }
  for (i = 0; i < __EXCALIDRAW_BLOCKED_NAMESPACES.length; i++) {
    (function (name) {
      try {
        Object.defineProperty(scope, name, {
          configurable: true,
          writable: true,
          enumerable: false,
          value: undefined,
        });
      } catch (error) {
        try {
          scope[name] = undefined;
        } catch (ignored) {}
      }
    })(__EXCALIDRAW_BLOCKED_NAMESPACES[i]);
  }
  return scope;
}

function __excalidrawShapePackRuntime(scope) {
  var post = scope.postMessage.bind(scope);
  var SafeFunction = Function;
  var renderers = null;

  __excalidrawShapePackHarden(scope);

  function fail(code, message) {
    post({ type: "error", code: code, message: String(message) });
  }

  function toSerializable(value) {
    // strips functions and proves the value can cross the worker boundary
    return JSON.parse(JSON.stringify(value));
  }

  function evaluatePack(source, apiVersion) {
    var registered = null;
    var api = Object.freeze({
      apiVersion: apiVersion,
      registerShapePack: function (pack) {
        if (registered) {
          throw new Error("registerShapePack() must be called exactly once");
        }
        if (!pack || typeof pack !== "object") {
          throw new Error("registerShapePack() requires a pack object");
        }
        registered = pack;
      },
    });

    var args = ["excalidraw"].concat(__EXCALIDRAW_SHADOWED);
    var factory = SafeFunction.apply(
      null,
      args.concat(['"use strict";\\n' + source])
    );
    var values = [api];
    for (var i = 0; i < __EXCALIDRAW_SHADOWED.length; i++) {
      var name = __EXCALIDRAW_SHADOWED[i];
      values.push(
        __EXCALIDRAW_BLOCKED_CALLABLE.indexOf(name) !== -1 ||
          name === "Function" ||
          name === "postMessage" ||
          name === "addEventListener" ||
          name === "removeEventListener" ||
          name === "close"
          ? __excalidrawShapePackBlocked(name)
          : undefined
      );
    }
    factory.apply(undefined, values);

    return registered;
  }

  function handleInit(message) {
    var pack;
    try {
      pack = evaluatePack(message.source, message.apiVersion);
    } catch (error) {
      fail("PACK_RUNTIME_ERROR", (error && error.message) || error);
      return;
    }

    if (!pack) {
      fail(
        "PACK_INVALID_MANIFEST",
        "pack did not call excalidraw.registerShapePack()"
      );
      return;
    }
    if (!pack.shapes || typeof pack.shapes.length !== "number") {
      fail("PACK_INVALID_MANIFEST", "pack.shapes must be an array");
      return;
    }

    renderers = {};
    var shapes = [];
    for (var i = 0; i < pack.shapes.length; i++) {
      var shape = pack.shapes[i];
      if (!shape || typeof shape !== "object") {
        fail("PACK_INVALID_MANIFEST", "shape #" + i + " must be an object");
        return;
      }
      if (typeof shape.render !== "function") {
        fail(
          "PACK_INVALID_MANIFEST",
          'shape "' + String(shape.id) + '" must define a render() function'
        );
        return;
      }
      renderers[shape.id] = shape.render;
      shapes.push({
        id: shape.id,
        label: shape.label,
        icon: shape.icon,
        defaultProps: shape.defaultProps,
      });
    }

    var manifest;
    try {
      manifest = toSerializable({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        apiVersion: pack.apiVersion,
        shapes: shapes,
      });
    } catch (error) {
      fail("PACK_INVALID_MANIFEST", "pack manifest is not serializable");
      return;
    }

    post({ type: "ready", manifest: manifest });
  }

  function handleRender(message) {
    var requestId = message.requestId;
    var renderer = renderers && renderers[message.context.shapeId];
    if (!renderer) {
      post({
        type: "render:error",
        requestId: requestId,
        message: 'unknown shape "' + String(message.context.shapeId) + '"',
      });
      return;
    }
    try {
      var ops = toSerializable(renderer(Object.freeze(message.context)));
      post({ type: "render:ok", requestId: requestId, ops: ops });
    } catch (error) {
      post({
        type: "render:error",
        requestId: requestId,
        message: String((error && error.message) || error),
      });
    }
  }

  scope.onmessage = function (event) {
    var message = event && event.data;
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "init") {
      handleInit(message);
    } else if (message.type === "render") {
      handleRender(message);
    }
  };
}
`;

export const createShapePackSandboxSource = () =>
  `${SHAPE_PACK_SANDBOX_RUNTIME_SOURCE}\n__excalidrawShapePackRuntime(self);\n`;
