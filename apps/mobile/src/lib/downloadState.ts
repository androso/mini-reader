export type DownloadStatus =
    | "not_downloaded"
    | "downloading"
    | "complete"
    | "failed";

export const canOpenOffline = (status: DownloadStatus) => status === "complete";

export const nextDownloadStatus = (
    current: DownloadStatus,
    event: "start" | "complete" | "fail" | "remove"
): DownloadStatus => {
    if (event === "remove") return "not_downloaded";
    if (event === "start") return "downloading";
    if (event === "complete" && current === "downloading") return "complete";
    if (event === "fail" && current === "downloading") return "failed";
    return current;
};
