import type { ExcalidrawElement } from "@excalidraw/element/types";

import { t } from "../../i18n";

import "./ElementCount.scss";

export const getSceneElementCount = (
  elements: readonly ExcalidrawElement[],
): number => {
  let count = 0;
  for (const element of elements) {
    // selection is a legacy/ephemeral box-select helper, not a scene shape
    if (!element.isDeleted && element.type !== "selection") {
      count++;
    }
  }
  return count;
};

export const ElementCount = ({
  elements,
}: {
  elements: readonly ExcalidrawElement[];
}) => {
  const count = getSceneElementCount(elements);

  return (
    <div
      className="element-count"
      data-testid="element-count"
      role="status"
      aria-live="polite"
    >
      {t("labels.elementCount", { count })}
    </div>
  );
};
