/** Bottom offset for an absolute chat overlay above the IME / home indicator. */
export const chatOverlayBottom = ({
    keyboardHeight,
    safeBottom,
    restingGap,
    keyboardGap = 4,
}: {
    keyboardHeight: number;
    safeBottom: number;
    restingGap: number;
    keyboardGap?: number;
}) =>
    keyboardHeight > 0
        ? keyboardHeight + keyboardGap
        : Math.max(safeBottom, restingGap);
