import React from "react";

import { Excalidraw, WelcomeScreen } from "../../index";
import { render } from "../../tests/test-utils";

describe("WelcomeScreen hints", () => {
  it("renders correctly spelled toolbar and help hints", async () => {
    await render(
      <Excalidraw>
        <WelcomeScreen />
      </Excalidraw>,
    );

    expect(
      document.querySelector(".welcome-screen-decor-hint--toolbar"),
    ).toHaveTextContent("Pick a tool & Start drawing!");
    expect(
      document.querySelector(".welcome-screen-decor-hint--help"),
    ).toHaveTextContent("Shortcuts & help");
  });
});
