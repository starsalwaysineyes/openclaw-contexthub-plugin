import { ContextHubHttpClient } from "./contexthub.js";
import type { ContextHubPluginConfig } from "./types.js";
export declare function runImportPreset(params: {
    client: ContextHubHttpClient;
    config: ContextHubPluginConfig;
    presetName: string;
    overrideLimit?: number;
    dryRun?: boolean;
}): Promise<{
    preset: string;
    rootPath: string;
    count: number;
    dryRun: boolean;
    results: Record<string, unknown>[];
}>;
