import type { OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";
declare const plugin: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    configSchema: {
        type: "object";
        additionalProperties: boolean;
        properties: {
            baseUrl: {
                type: "string";
                description: string;
            };
            token: {
                type: "string";
                description: string;
            };
            tenantId: {
                type: "string";
                description: string;
            };
            search: {
                type: "object";
                properties: {
                    partitions: {
                        type: "array";
                        items: {
                            type: "string";
                        };
                    };
                    layers: {
                        type: "array";
                        items: {
                            type: "string";
                        };
                    };
                    limit: {
                        type: "number";
                    };
                    rerank: {
                        type: "boolean";
                    };
                };
            };
            read: {
                type: "object";
                properties: {
                    defaultLines: {
                        type: "number";
                    };
                    maxLines: {
                        type: "number";
                    };
                };
            };
        };
    };
    register(api: OpenClawPluginApi): void;
};
export default plugin;
