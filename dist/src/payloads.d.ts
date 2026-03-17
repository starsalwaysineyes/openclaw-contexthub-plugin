import type { ContextHubPluginConfig, LastSessionCapture, RecallLayer } from "./types.js";
export declare function buildSaveTextPayload(params: {
    config: ContextHubPluginConfig;
    partitionKey: string;
    layer: RecallLayer;
    title: string;
    text: string;
    tags?: string[];
}): Record<string, unknown>;
export declare function buildImportFilePayload(params: {
    config: ContextHubPluginConfig;
    partitionKey: string;
    layer: RecallLayer;
    filePath: string;
    titleOverride?: string;
    tags?: string[];
}): Record<string, unknown>;
export declare function buildUploadLastSessionPayload(params: {
    config: ContextHubPluginConfig;
    partitionKey: string;
    capture: LastSessionCapture;
    titleOverride?: string;
}): Record<string, unknown>;
