import { newElement } from "@excalidraw/element";

import { restoreElements } from "../../data/restore";
import { SHAPE_PACK_CUSTOM_DATA_KEY } from "../constants";
import {
  getShapePackRef,
  isShapePackElement,
  newShapePackElement,
} from "../element";

import type { ShapeDescriptor } from "../types";

const shape: ShapeDescriptor = {
  packId: "network",
  id: "router",
  key: "network:router",
  label: "Router",
  icon: null,
  defaultProps: {
    width: 140,
    height: 90,
    fallback: "rectangle",
    props: { ports: 4 },
  },
};

describe("shape pack elements", () => {
  it("creates an ordinary element carrying a pack reference", () => {
    const element = newShapePackElement(shape, { x: 10, y: 20 });

    expect(element.type).toBe("rectangle");
    expect(element.width).toBe(140);
    expect(element.height).toBe(90);
    expect(getShapePackRef(element)).toEqual({
      packId: "network",
      shapeId: "router",
      apiVersion: 1,
      props: { ports: 4 },
    });
  });

  it("merges per-element props over the shape defaults", () => {
    const element = newShapePackElement(shape, {
      x: 0,
      y: 0,
      props: { ports: 8 },
    });

    expect(getShapePackRef(element)?.props).toEqual({ ports: 8 });
  });

  it("uses the shape's declared fallback as the element type", () => {
    const element = newShapePackElement(
      {
        ...shape,
        defaultProps: { ...shape.defaultProps, fallback: "ellipse" },
      },
      { x: 0, y: 0 },
    );

    expect(element.type).toBe("ellipse");
  });

  describe("reading untrusted scene data", () => {
    const withCustomData = (customData: any) =>
      newElement({ type: "rectangle", x: 0, y: 0, customData });

    it("ignores elements without a pack reference", () => {
      expect(
        getShapePackRef(newElement({ type: "rectangle", x: 0, y: 0 })),
      ).toBeNull();
      expect(isShapePackElement(withCustomData({ other: 1 }))).toBe(false);
    });

    it.each([
      ["a non-object reference", "network:router"],
      ["a missing shapeId", { packId: "network" }],
      ["a non-string packId", { packId: 1, shapeId: "router" }],
    ])("ignores %s", (_label, ref) => {
      expect(
        getShapePackRef(withCustomData({ [SHAPE_PACK_CUSTOM_DATA_KEY]: ref })),
      ).toBeNull();
    });

    it("drops props that aren't serializable", () => {
      const element = withCustomData({
        [SHAPE_PACK_CUSTOM_DATA_KEY]: {
          packId: "network",
          shapeId: "router",
          props: { nested: { ok: true } },
        },
      });

      expect(getShapePackRef(element)?.props).toEqual({ nested: { ok: true } });

      const broken = withCustomData({
        [SHAPE_PACK_CUSTOM_DATA_KEY]: {
          packId: "network",
          shapeId: "router",
          props: { fn: () => {} },
        },
      });

      expect(getShapePackRef(broken)?.props).toEqual({});
    });
  });

  it("survives a scene round-trip so packs can be loaded later", () => {
    const element = newShapePackElement(shape, { x: 0, y: 0 });

    const [restored] = restoreElements(
      JSON.parse(JSON.stringify([element])),
      null,
    );

    expect(restored.type).toBe("rectangle");
    expect(getShapePackRef(restored)).toEqual(getShapePackRef(element));
  });
});
