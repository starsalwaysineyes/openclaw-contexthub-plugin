import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
declare const plugin: {
    id: string;
    name: string;
    description: string;
    kind: "integration";
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
            defaultPartitionKey: {
                type: "string";
                description: string;
            };
            recall: {
                type: "object";
                properties: {
                    preAnswer: {
                        type: "object";
                        properties: {
                            enabled: {
                                type: "boolean";
                                description: string;
                            };
                            partitions: {
                                type: "array";
                                items: {
                                    type: "string";
                                };
                                description: string;
                            };
                            layers: {
                                type: "array";
                                items: {
                                    type: "string";
                                };
                                description: string;
                            };
                            limit: {
                                type: "number";
                                description: string;
                            };
                            rerank: {
                                type: "boolean";
                                description: string;
                            };
                        };
                    };
                };
            };
            importPresets: {
                type: "object";
                additionalProperties: boolean;
                description: string;
            };
        };
    };
    register(api: OpenClawPluginApi): void;
};
export default plugin;
