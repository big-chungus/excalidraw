/* global excalidraw */

/**
 * Example Excalidraw shape pack: a couple of network-diagram shapes.
 *
 * It is a plain script — no build step, no imports, no npm package. Serve this
 * file from anywhere the editor's page can reach and load it at runtime:
 *
 *   excalidrawAPI.shapePacks.load("https://example.com/network-shapes.pack.js");
 *
 * The script runs inside a worker sandbox with no network and no storage, and
 * its only entry point is the `excalidraw` object. See
 * `packages/excalidraw/plugins/README.md` for the full contract.
 */

const PORT_COUNT = 4;

/** Rounded body shared by both shapes, following the user's colors. */
function body(width, height) {
  return {
    op: "rect",
    x: 1,
    y: 1,
    width: width - 2,
    height: height - 2,
    radius: 6,
    fill: "background",
    stroke: "stroke",
  };
}

function label(text, width, height) {
  return {
    op: "text",
    x: width / 2,
    y: height - 10,
    text,
    fontSize: 12,
    align: "center",
    color: "stroke",
  };
}

function router(context) {
  const width = context.width;
  const height = context.height;
  const ops = [body(width, height)];

  // antenna
  ops.push({
    op: "polyline",
    points: [
      [width / 2, 12],
      [width / 2, -10],
    ],
    stroke: "stroke",
  });
  ops.push({
    op: "ellipse",
    cx: width / 2,
    cy: -12,
    rx: 3,
    ry: 3,
    fill: "stroke",
    stroke: "stroke",
  });

  // front ports
  const ports = Math.max(
    1,
    Math.min(PORT_COUNT, Number(context.props.ports) || PORT_COUNT),
  );
  const portWidth = Math.min(14, (width - 20) / ports - 4);
  const totalWidth = ports * (portWidth + 4) - 4;

  for (let i = 0; i < ports; i++) {
    ops.push({
      op: "rect",
      x: (width - totalWidth) / 2 + i * (portWidth + 4),
      y: height / 2 - 4,
      width: portWidth,
      height: 8,
      radius: 2,
      stroke: "stroke",
      fill: context.theme === "dark" ? "#4f5d75" : "#dbe2ef",
    });
  }

  ops.push(label(String(context.props.label || "Router"), width, height));

  return ops;
}

function cloud(context) {
  const width = context.width;
  const height = context.height;

  return [
    {
      op: "path",
      d: `M ${width * 0.25} ${height * 0.7} a ${height * 0.2} ${
        height * 0.2
      } 0 0 1 ${width * 0.05} -${height * 0.38} a ${height * 0.26} ${
        height * 0.26
      } 0 0 1 ${width * 0.42} -${height * 0.07} a ${height * 0.2} ${
        height * 0.2
      } 0 0 1 ${width * 0.1} ${height * 0.45} z`,
      fill: "background",
      stroke: "stroke",
    },
    label(String(context.props.label || "Cloud"), width, height),
  ];
}

excalidraw.registerShapePack({
  id: "network",
  name: "Network gear",
  version: "1.0.0",
  // the contract version this pack was written against; the editor refuses
  // packs it can't support rather than half-loading them
  apiVersion: 1,
  shapes: [
    {
      id: "router",
      label: "Router",
      icon: [
        { op: "rect", x: 2, y: 10, width: 20, height: 10, radius: 2 },
        {
          op: "polyline",
          points: [
            [12, 10],
            [12, 3],
          ],
        },
      ],
      defaultProps: {
        width: 140,
        height: 90,
        fallback: "rectangle",
        props: { ports: PORT_COUNT, label: "Router" },
      },
      render: router,
    },
    {
      id: "cloud",
      label: "Cloud",
      icon: [{ op: "ellipse", cx: 12, cy: 13, rx: 9, ry: 6 }],
      defaultProps: {
        width: 160,
        height: 100,
        fallback: "ellipse",
        props: { label: "Cloud" },
      },
      render: cloud,
    },
  ],
});
