import type { LastSessionCapture } from "./types.js";
export declare function captureLastSession(event: {
    messages?: unknown[];
    success?: boolean;
    error?: string;
    durationMs?: number;
}): LastSessionCapture | null;
