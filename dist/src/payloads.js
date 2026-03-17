import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
const HEADING_RE = /^#\s+(.+?)\s*$/m;
function defaultTypeForLayer(layer) {
    if (layer === "l0")
        return "memory";
    if (layer === "l1")
        return "summary";
    return "resource";
}
function fileTitle(filePath, fallback) {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(HEADING_RE);
    return match?.[1]?.trim() || fallback;
}
function fileIdempotencyKey(filePath, layer) {
    const digest = createHash("sha1").update(`${layer}:${path.resolve(filePath)}`).digest("hex").slice(0, 16);
    return `plugin-file:${layer}:${digest}`;
}
export function buildSaveTextPayload(params) {
    return {
        tenantId: params.config.tenantId,
        partitionKey: params.partitionKey,
        type: defaultTypeForLayer(params.layer),
        targetLayer: params.layer,
        title: params.title,
        content: { kind: "inline_text", text: params.text },
        tags: params.tags ?? [],
        metadata: {
            adapter: "openclaw-contexthub-plugin",
            sourceKind: "plugin_text",
        },
        derive: { enabled: false, mode: "sync", emitLayers: [], provider: "litellm", promptPreset: "archive_and_memory" },
    };
}
export function buildImportFilePayload(params) {
    const resolved = path.resolve(params.filePath);
    const text = fs.readFileSync(resolved, "utf-8");
    const title = params.titleOverride?.trim() || fileTitle(resolved, path.parse(resolved).name);
    return {
        tenantId: params.config.tenantId,
        partitionKey: params.partitionKey,
        type: defaultTypeForLayer(params.layer),
        targetLayer: params.layer,
        title,
        content: { kind: "inline_text", text },
        source: {
            kind: "local_file",
            path: resolved,
            fileName: path.basename(resolved),
        },
        tags: params.tags ?? [],
        metadata: {
            adapter: "openclaw-contexthub-plugin",
            sourceKind: "local_file",
            localPath: resolved,
        },
        idempotencyKey: fileIdempotencyKey(resolved, params.layer),
        derive: { enabled: false, mode: "sync", emitLayers: [], provider: "litellm", promptPreset: "archive_and_memory" },
    };
}
export function buildUploadLastSessionPayload(params) {
    return {
        tenantId: params.config.tenantId,
        partitionKey: params.partitionKey,
        type: defaultTypeForLayer("l2"),
        targetLayer: "l2",
        title: params.titleOverride?.trim() || params.capture.title,
        content: { kind: "inline_text", text: params.capture.transcript },
        source: {
            kind: "openclaw_session",
            capturedAt: params.capture.capturedAt,
        },
        tags: ["session", "raw", "openclaw"],
        metadata: {
            adapter: "openclaw-contexthub-plugin",
            sourceKind: "openclaw_session",
            capturedAt: params.capture.capturedAt,
            success: params.capture.success,
            durationMs: params.capture.durationMs,
            messageCount: params.capture.messageCount,
            error: params.capture.error,
        },
        idempotencyKey: params.capture.idempotencyKey,
        derive: { enabled: false, mode: "sync", emitLayers: [], provider: "litellm", promptPreset: "archive_and_memory" },
    };
}
