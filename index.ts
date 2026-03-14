import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerPluginCommands } from "./src/commands.js";
import { ContextHubHttpClient } from "./src/contexthub.js";
import { resolveConfig } from "./src/config.js";

const pluginConfigSchema = {
  type: "object" as const,
  additionalProperties: true,
  properties: {
    baseUrl: { type: "string" as const, description: "ContextHub base URL" },
    token: { type: "string" as const, description: "Optional bearer token" },
    tenantId: { type: "string" as const, description: "ContextHub tenant ID" },
    defaultPartitionKey: { type: "string" as const, description: "Default partition key for plugin write/import commands" },
    recall: {
      type: "object" as const,
      properties: {
        preAnswer: {
          type: "object" as const,
          properties: {
            enabled: { type: "boolean" as const, description: "Enable pre-answer recall" },
            partitions: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Default partitions used by pre-answer recall",
            },
            layers: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Layers queried by pre-answer recall (default: l0 only)",
            },
            limit: { type: "number" as const, description: "Max recall hits for one turn" },
            rerank: { type: "boolean" as const, description: "Enable rerank on recall" },
          },
        },
      },
    },
  },
};

function buildPrependContext(items: Array<{ title: string; layer: string; snippet: string; partitionKey: string }>): string {
  const lines = items.map((item, index) => {
    const snippet = item.snippet.replace(/\s+/g, " ").trim();
    return `${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey}) - ${snippet}`;
  });
  return [
    "## ContextHub recall",
    "Use these recalled L0 memory pointers as supporting context. Do not treat them as unquestionable truth.",
    ...lines,
  ].join("\n");
}

const plugin = {
  id: "openclaw-contexthub-plugin",
  name: "OpenClaw ContextHub Plugin",
  description: "Pre-answer recall plus explicit write/import bridge for ContextHub.",
  kind: "integration" as const,
  configSchema: pluginConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolveConfig((api.pluginConfig ?? {}) as Record<string, unknown>);
    const client = new ContextHubHttpClient({
      baseUrl: config.baseUrl,
      token: config.token,
    });

    registerPluginCommands({ api, config, client });

    api.on("before_agent_start", async (event: { prompt?: string }) => {
      const recall = config.recall.preAnswer;
      if (!recall.enabled) return;
      if (!config.tenantId) {
        api.logger.warn("contexthub-plugin: tenantId is missing; skipping recall");
        return;
      }
      const prompt = event.prompt?.trim();
      if (!prompt) return;

      try {
        const result = await client.query({
          tenantId: config.tenantId,
          query: prompt,
          partitions: recall.partitions,
          layers: recall.layers,
          limit: recall.limit,
          rerank: recall.rerank,
        });
        if (!result.items || result.items.length === 0) return;

        return {
          prependContext: buildPrependContext(
            result.items.map((item) => ({
              title: item.title,
              layer: item.layer,
              snippet: item.snippet,
              partitionKey: item.partitionKey,
            })),
          ),
        };
      } catch (error) {
        api.logger.warn(`contexthub-plugin: recall failed: ${String(error)}`);
        return;
      }
    }, { priority: 20 });
  },
};

export default plugin;
