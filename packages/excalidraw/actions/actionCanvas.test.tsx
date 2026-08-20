import { Excalidraw } from "../index";
import { act, render } from "../tests/test-utils";

import { actionZoomIn, actionZoomOut } from "./actionCanvas";

const { h } = window;

describe("zoom actions", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("zooms in and out in 15% steps", () => {
    act(() => {
      h.app.actionManager.executeAction(actionZoomIn);
    });
    expect(h.state.zoom.value).toBe(1.15);

    act(() => {
      h.app.actionManager.executeAction(actionZoomOut);
    });
    expect(h.state.zoom.value).toBe(1);

    act(() => {
      h.app.actionManager.executeAction(actionZoomOut);
    });
    expect(h.state.zoom.value).toBe(0.85);
  });
});
