import { t } from "../i18n";

describe("clipboard toasts", () => {
  it("uses the correct copy-success text", () => {
    expect(t("toast.copyToClipboard")).toBe("Copied to clipboard.");
  });

  it("uses the correct PNG copy-success text", () => {
    expect(
      t("toast.copyToClipboardAsPng", {
        exportSelection: t("toast.canvas"),
        exportColorScheme: t("buttons.lightMode"),
      }),
    ).toBe("Copied canvas to clipboard as PNG\n(Light mode)");
  });
});
