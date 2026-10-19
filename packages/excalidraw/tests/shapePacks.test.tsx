import { act } from "@testing-library/react";
import React from "react";

import { CaptureUpdateAction } from "@excalidraw/element";

import { Excalidraw } from "../index";
import { newShapePackElement } from "../plugins";

import { render, waitFor } from "./test-utils";

import type { ShapeDescriptor } from "../plugins";

const { h } = window;

/** a pack that is registered nowhere — the element must still behave */
const GHOST_SHAPE: ShapeDescriptor = {
  packId: "ghost",
  id: "router",
  key: "ghost:router",
  label: "Router",
  icon: null,
  defaultProps: {
    width: 140,
    height: 90,
    fallback: "rectangle",
    props: { ports: 4 },
  },
};

describe("shape packs in the editor", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("exposes the registry on the imperative API", () => {
    expect(window.h.app.shapePacks.getPacks()).toEqual([]);
    expect(window.h.app.shapePacks.getShapes()).toEqual([]);
  });

  it("surfaces a failed load as a toast instead of crashing", async () => {
    // jsdom has no Worker, so the sandbox can't be created — a representative
    // load failure, reported rather than thrown
    const result = await act(async () =>
      h.app.shapePacks.load(
        "data:application/javascript,var%20unused%20%3D%201%3B",
      ),
    );

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error.code).toBe(
      "PACK_SANDBOX_UNAVAILABLE",
    );

    await waitFor(() => {
      expect(h.state.toast?.message).toContain("Shape pack error");
    });
  });

  it("renders elements of a missing pack as their base shape", async () => {
    const element = newShapePackElement(GHOST_SHAPE, { x: 100, y: 100 });

    act(() => {
      h.app.updateScene({
        elements: [element],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });

    await waitFor(() => {
      expect(h.elements).toHaveLength(1);
    });

    expect(h.elements[0].type).toBe("rectangle");
    expect(h.elements[0].customData?.shapePack).toMatchObject({
      packId: "ghost",
      shapeId: "router",
    });
  });
});
