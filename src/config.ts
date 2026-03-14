import type { ContextHubPluginConfig, RecallLayer } from "./types.js";

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function parseLayers(value: string | undefined, fallback: RecallLayer[]): RecallLayer[] {
  return parseCsv(value, fallback).map((item) => item.toLowerCase() as RecallLayer);
}

export function resolveConfig(raw: Record<string, unknown> | undefined): ContextHubPluginConfig {
  const cfg = (raw ?? {}) as Record<string, any>;
  const recall = (cfg.recall ?? {}) as Record<string, any>;
  const preAnswer = (recall.preAnswer ?? {}) as Record<string, any>;

  return {
    baseUrl: String(cfg.baseUrl ?? process.env.CONTEXT_HUB_BASE_URL ?? "http://127.0.0.1:4040"),
    token: String(cfg.token ?? process.env.CONTEXT_HUB_TOKEN ?? "") || undefined,
    tenantId: String(cfg.tenantId ?? process.env.CONTEXT_HUB_TENANT_ID ?? ""),
    recall: {
      preAnswer: {
        enabled: Boolean(preAnswer.enabled ?? parseBool(process.env.CONTEXT_HUB_RECALL_ENABLED, true)),
        partitions: parseCsv(preAnswer.partitions?.join?.(",") ?? process.env.CONTEXT_HUB_RECALL_PARTITIONS ?? process.env.CONTEXT_HUB_PARTITIONS, []),
        layers: parseLayers(preAnswer.layers?.join?.(",") ?? process.env.CONTEXT_HUB_RECALL_LAYERS, ["l0"]),
        limit: Number(preAnswer.limit ?? process.env.CONTEXT_HUB_RECALL_LIMIT ?? 5),
        rerank: Boolean(preAnswer.rerank ?? parseBool(process.env.CONTEXT_HUB_RECALL_RERANK, false)),
      },
    },
  };
}
