import { ContextHubHttpClient } from "./contexthub.js";
import type { ContextHubPluginConfig } from "./types.js";
export declare function registerPluginTools(params: {
    api: {
        registerTool: Function;
    };
    config: ContextHubPluginConfig;
    client: ContextHubHttpClient;
}): void;
