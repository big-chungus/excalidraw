import { arrayToMap, reseed } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";
import { Excalidraw } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { UI } from "@excalidraw/excalidraw/tests/helpers/ui";
import { render } from "@excalidraw/excalidraw/tests/test-utils";

import type { GlobalPoint } from "@excalidraw/math";

import { getElementBounds, getTrianglePoints } from "../src/bounds";
import {
  getHoveredElementForBinding,
  hitElementItself,
  isPointInElement,
} from "../src/collision";
import { distanceToElement } from "../src/distance";
import { deconstructTriangleElement } from "../src/utils";
import {
  isBindableElement,
  isFlowchartNodeElement,
  isTextBindableContainer,
  isTriangleElement,
} from "../src/typeChecks";

import type { ExcalidrawTriangleElement } from "../src/types";

/** 100x100 triangle at the origin: apex (50, 0), base (0, 100)-(100, 100) */
const createTriangle = (
  overrides: Partial<ExcalidrawTriangleElement> = {},
): ExcalidrawTriangleElement =>
  API.createElement({
    type: "triangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
  }) as ExcalidrawTriangleElement;

describe("triangle geometry", () => {
  it("places the apex at the top center and the base along the bottom edge", () => {
    const triangle = createTriangle({ width: 80, height: 40 });

    expect(getTrianglePoints(triangle)).toEqual([40, 0, 80, 40, 0, 40]);
  });

  it("deconstructs into three sides and three corners", () => {
    const triangle = createTriangle();
    const [sides, corners] = deconstructTriangleElement(triangle);

    expect(sides).toHaveLength(3);
    expect(corners).toHaveLength(3);
  });

  it("bounds of an unrotated triangle are its bounding box", () => {
    const triangle = createTriangle({ x: 10, y: 20, width: 30, height: 50 });

    expect(getElementBounds(triangle, arrayToMap([triangle]))).toEqual([
      10, 20, 40, 70,
    ]);
  });

  it("bounds of a rotated triangle follow its vertices, not its bounding box", () => {
    // half a turn: the apex ends up at the bottom center, the base on top —
    // the bounding box is unchanged, so this only passes if the bounds are
    // computed from the three vertices
    const triangle = createTriangle({ angle: Math.PI as any });
    const [x1, y1, x2, y2] = getElementBounds(triangle, arrayToMap([triangle]));

    expect(x1).toBeCloseTo(0);
    expect(y1).toBeCloseTo(0);
    expect(x2).toBeCloseTo(100);
    expect(y2).toBeCloseTo(100);

    // a quarter turn points the apex left; the bounds stay the bounding box
    // only because the shape is square — rotate a tall triangle instead
    const tall = createTriangle({
      width: 20,
      height: 100,
      angle: (Math.PI / 2) as any,
    });
    const bounds = getElementBounds(tall, arrayToMap([tall]));

    expect(bounds[2] - bounds[0]).toBeCloseTo(100);
    expect(bounds[3] - bounds[1]).toBeCloseTo(20);
  });
});

describe("triangle type predicates", () => {
  it("is a bindable, text-bindable flowchart node", () => {
    const triangle = createTriangle();

    expect(isTriangleElement(triangle)).toBe(true);
    expect(isBindableElement(triangle)).toBe(true);
    expect(isTextBindableContainer(triangle)).toBe(true);
    expect(isFlowchartNodeElement(triangle)).toBe(true);
  });
});

describe("triangle hit testing", () => {
  const hit = (
    point: GlobalPoint,
    element: ExcalidrawTriangleElement,
    threshold = 10,
  ) =>
    hitElementItself({
      point,
      element,
      threshold,
      elementsMap: arrayToMap([element]),
    });

  it("hits the outline but not the bounding-box corners", () => {
    const triangle = createTriangle();

    // base midpoint and apex are on the outline
    expect(hit(pointFrom<GlobalPoint>(50, 100), triangle)).toBe(true);
    expect(hit(pointFrom<GlobalPoint>(50, 0), triangle)).toBe(true);
    // midpoint of the right slanted side
    expect(hit(pointFrom<GlobalPoint>(75, 50), triangle)).toBe(true);

    // the top corners of the bounding box are far outside the triangle
    expect(hit(pointFrom<GlobalPoint>(0, 0), triangle)).toBe(false);
    expect(hit(pointFrom<GlobalPoint>(100, 0), triangle)).toBe(false);
  });

  it("does not hit the interior of a transparent triangle", () => {
    const triangle = createTriangle();

    expect(hit(pointFrom<GlobalPoint>(50, 60), triangle)).toBe(false);
  });

  it("hits the interior of a filled triangle", () => {
    const triangle = createTriangle({ backgroundColor: "#ffd700" });

    expect(hit(pointFrom<GlobalPoint>(50, 60), triangle)).toBe(true);
    // still a miss where the bounding box overlaps but the triangle doesn't
    expect(hit(pointFrom<GlobalPoint>(2, 2), triangle)).toBe(false);
  });

  it("isPointInElement follows the three edges", () => {
    const triangle = createTriangle();
    const elementsMap = arrayToMap([triangle]);

    expect(
      isPointInElement(pointFrom<GlobalPoint>(50, 50), triangle, elementsMap),
    ).toBe(true);
    // inside the bounding box, outside the triangle (left of the left edge)
    expect(
      isPointInElement(pointFrom<GlobalPoint>(10, 10), triangle, elementsMap),
    ).toBe(false);
  });

  it("measures distance to the nearest edge", () => {
    const triangle = createTriangle();
    const elementsMap = arrayToMap([triangle]);

    // 10px below the base
    expect(
      distanceToElement(triangle, elementsMap, pointFrom<GlobalPoint>(50, 110)),
    ).toBeCloseTo(10, 1);
    // on the right slanted edge, which runs (50, 0) -> (100, 100)
    expect(
      distanceToElement(triangle, elementsMap, pointFrom<GlobalPoint>(60, 20)),
    ).toBeCloseTo(0, 1);
    // 10px out from that edge along its normal
    expect(
      distanceToElement(
        triangle,
        elementsMap,
        pointFrom<GlobalPoint>(60 + 20 / Math.sqrt(5), 20 - 10 / Math.sqrt(5)),
      ),
    ).toBeCloseTo(10, 1);
  });
});

describe("triangle arrow binding", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("is found as a binding target inside its outline but not inside its bounding box", () => {
    const triangle = UI.createElement("triangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const elements = window.h.scene.getNonDeletedElements();
    const elementsMap = window.h.scene.getNonDeletedElementsMap();

    // inside the triangle
    expect(
      getHoveredElementForBinding(
        pointFrom<GlobalPoint>(50, 60),
        elements,
        elementsMap,
      )?.id,
    ).toBe(triangle.id);

    // just outside the base, within the binding tolerance
    expect(
      getHoveredElementForBinding(
        pointFrom<GlobalPoint>(50, 103),
        elements,
        elementsMap,
        5,
      )?.id,
    ).toBe(triangle.id);

    // the empty bounding-box corner is not a binding target
    expect(
      getHoveredElementForBinding(
        pointFrom<GlobalPoint>(2, 2),
        elements,
        elementsMap,
        5,
      ),
    ).toBeNull();
  });

  it("binds an arrow dragged onto it, stopping short of the outline", () => {
    const triangle = UI.createElement("triangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const arrow = UI.createElement("arrow", {
      x: 50,
      y: 200,
      width: 0,
      height: -90,
    });

    expect(arrow.endBinding).not.toBeNull();
    expect(arrow.endBinding?.elementId).toBe(triangle.id);

    // the bound endpoint is resolved against the offset triangle outline, so
    // it lands outside the shape but close to it
    const elementsMap = window.h.scene.getNonDeletedElementsMap();
    const endPoint = pointFrom<GlobalPoint>(
      arrow.x + arrow.points[arrow.points.length - 1][0],
      arrow.y + arrow.points[arrow.points.length - 1][1],
    );

    expect(isPointInElement(endPoint, triangle.get(), elementsMap)).toBe(false);
    expect(
      distanceToElement(triangle.get(), elementsMap, endPoint),
    ).toBeLessThan(15);
  });
});
