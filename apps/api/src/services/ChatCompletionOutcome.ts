export const MESSAGE_COMPLETION_STATUSES = [
    "complete",
    "truncated",
    "cancelled",
    "failed",
] as const;

export type MessageCompletionStatus =
    (typeof MESSAGE_COMPLETION_STATUSES)[number];

export type ChatCompletionOutcome = {
    content: string;
    status: MessageCompletionStatus;
    finishReason: string | null;
};

export const classifyChatCompletionStatus = ({
    finishReason,
    aborted,
    failed,
}: {
    finishReason: string | null;
    aborted: boolean;
    failed: boolean;
}): MessageCompletionStatus => {
    if (aborted) return "cancelled";
    if (failed) return "failed";
    if (finishReason === "stop") return "complete";
    if (finishReason === "length") return "truncated";
    return "failed";
};

export const isAbortError = (error: unknown) =>
    error instanceof Error && error.name === "AbortError";

type ResponseCloseEmitter = {
    once?: (event: string, listener: () => void) => void;
    off?: (event: string, listener: () => void) => void;
};

export const createResponseAbortController = (
    response: ResponseCloseEmitter
) => {
    const controller = new AbortController();
    let closed = false;
    const handleClose = () => {
        closed = true;
        controller.abort();
    };

    response.once?.("close", handleClose);

    return {
        controller,
        wasClosed: () => closed,
        cleanup: () => response.off?.("close", handleClose),
    };
};
