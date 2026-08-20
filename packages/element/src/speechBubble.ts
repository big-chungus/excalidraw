const TAIL_HEIGHT_RATIO = 0.22;
const MAX_TAIL_HEIGHT = 28;

export const getSpeechBubbleTailHeight = (height: number) =>
  Math.min(MAX_TAIL_HEIGHT, height * TAIL_HEIGHT_RATIO);

export const getSpeechBubbleBodyHeight = (height: number) =>
  height - getSpeechBubbleTailHeight(height);

export const getSpeechBubbleHeightForBodyHeight = (bodyHeight: number) => {
  const proportionalHeight = bodyHeight / (1 - TAIL_HEIGHT_RATIO);
  return getSpeechBubbleTailHeight(proportionalHeight) < MAX_TAIL_HEIGHT
    ? proportionalHeight
    : bodyHeight + MAX_TAIL_HEIGHT;
};
