import { useEffect, useRef, useState } from "react";

import { getCommonBoundingBox } from "@excalidraw/element";
import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  actionCancelTidyDiagram,
  actionConfirmTidyDiagram,
  tidyDiagramPreviewAtom,
} from "../actions/actionTidyDiagram";
import { useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import { FilledButton } from "./FilledButton";
import { tablerCheckIcon, CloseIcon } from "./icons";

import "./TidyDiagramPopup.scss";

import type App from "./App";

const GAP_BELOW_SELECTION = 16;

/**
 * Confirm / cancel bar for a pending "Tidy diagram" layout. The layout is
 * already applied to the scene so the user previews the real thing, re-routed
 * arrows included; this only decides whether it sticks.
 */
const TidyDiagramPopup = ({ app }: { app: App }) => {
  const preview = useAtomValue(tidyDiagramPreviewAtom);
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const elementsMap = app.scene.getNonDeletedElementsMap();
  const previewedElements = (preview?.selectedElementIds ?? []).reduce(
    (elements: NonDeletedExcalidrawElement[], id) => {
      const element = elementsMap.get(id);
      if (element) {
        elements.push(element);
      }
      return elements;
    },
    [],
  );
  const hasPreviewedElements = previewedElements.length > 0;

  const confirm = () =>
    app.actionManager.executeAction(actionConfirmTidyDiagram, "ui");
  const cancel = () =>
    app.actionManager.executeAction(actionCancelTidyDiagram, "ui");

  useEffect(() => {
    if (!hasPreviewedElements) {
      return;
    }
    const { midX, maxY } = getCommonBoundingBox(previewedElements);
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: midX, sceneY: maxY },
      app.state,
    );
    setPosition({ x, y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    preview,
    hasPreviewedElements,
    app.state.scrollX,
    app.state.scrollY,
    app.state.zoom.value,
    app.state.offsetLeft,
    app.state.offsetTop,
  ]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  if (!preview) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-label={t("labels.tidyDiagramPreview")}
      className="TidyDiagramPopup"
      style={{
        position: "absolute",
        top: `${position.y + GAP_BELOW_SELECTION - app.state.offsetTop}px`,
        left: `${position.x - app.state.offsetLeft}px`,
        zIndex: 2,
      }}
    >
      <div className="TidyDiagramPopup__label">{t("labels.tidyDiagram")}</div>
      <FilledButton
        variant="filled"
        color="primary"
        icon={tablerCheckIcon}
        label={t("labels.tidyDiagramConfirm")}
        onClick={confirm}
      >
        {t("labels.tidyDiagramConfirm")}
      </FilledButton>
      <FilledButton
        variant="outlined"
        color="muted"
        icon={CloseIcon}
        label={t("labels.tidyDiagramCancel")}
        onClick={cancel}
      >
        {t("labels.tidyDiagramCancel")}
      </FilledButton>
    </div>
  );
};

export default TidyDiagramPopup;
