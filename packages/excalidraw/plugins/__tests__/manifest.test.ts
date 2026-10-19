import { validatePackManifest } from "../manifest";

const URL = "https://packs.test/pack.js";

const manifest = (overrides: Record<string, any> = {}) => ({
  id: "network",
  name: "Network gear",
  apiVersion: 1,
  shapes: [{ id: "router", label: "Router" }],
  ...overrides,
});

const expectError = (raw: unknown) => {
  const result = validatePackManifest(raw, URL);

  if (result.ok) {
    throw new Error("expected the manifest to be rejected");
  }
  return result.error;
};

describe("shape pack manifest validation", () => {
  it("fills in defaults and derives shape keys", () => {
    const result = validatePackManifest(manifest(), URL);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.pack).toEqual({
      id: "network",
      name: "Network gear",
      version: null,
      apiVersion: 1,
      url: URL,
      shapes: [
        {
          packId: "network",
          id: "router",
          key: "network:router",
          label: "Router",
          icon: null,
          defaultProps: {
            width: 120,
            height: 100,
            fallback: "rectangle",
            props: {},
          },
        },
      ],
    });
  });

  it("rejects a pack targeting another api version", () => {
    const error = expectError(manifest({ apiVersion: 2 }));

    expect(error.code).toBe("PACK_API_VERSION_MISMATCH");
    expect(error.packId).toBe("network");
  });

  it("rejects duplicate shape ids", () => {
    const error = expectError(
      manifest({
        shapes: [
          { id: "router", label: "Router" },
          { id: "router", label: "Router again" },
        ],
      }),
    );

    expect(error.code).toBe("SHAPE_DUPLICATE_ID");
    expect(error.shapeId).toBe("router");
  });

  it.each([
    ["a non-object", 42],
    ["a missing id", manifest({ id: undefined })],
    ["an id with spaces", manifest({ id: "network gear" })],
    ["a missing name", manifest({ name: "" })],
    ["no shapes", manifest({ shapes: [] })],
    ["a shape without a label", manifest({ shapes: [{ id: "router" }] })],
    [
      "an invalid icon op",
      manifest({
        shapes: [{ id: "router", label: "Router", icon: [{ op: "nope" }] }],
      }),
    ],
    [
      "an unsupported fallback",
      manifest({
        shapes: [
          {
            id: "router",
            label: "Router",
            defaultProps: { fallback: "triangle" },
          },
        ],
      }),
    ],
    [
      "negative default dimensions",
      manifest({
        shapes: [
          { id: "router", label: "Router", defaultProps: { width: -10 } },
        ],
      }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(expectError(raw).code).toBe("PACK_INVALID_MANIFEST");
  });

  it("rejects non-serializable default props", () => {
    const error = expectError(
      manifest({
        shapes: [
          {
            id: "router",
            label: "Router",
            defaultProps: { props: { onClick: () => {} } },
          },
        ],
      }),
    );

    expect(error.code).toBe("PACK_INVALID_MANIFEST");
    expect(error.message).toContain("non-serializable");
  });
});
