import { ContextHubHttpClient } from "./contexthub.js";
import type { ContextHubPluginConfig, LastSessionCapture } from "./types.js";
export declare function registerPluginCommands(params: {
    api: {
        registerCommand: Function;
    };
    config: ContextHubPluginConfig;
    client: ContextHubHttpClient;
    state: {
        lastSessionCapture: LastSessionCapture | null;
    };
}): void;
