import type { ContextHubPluginConfig, DeriveMode, ImportPreset, RecallLayer } from "./types.js";

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

function parseDeriveMode(value: string | undefined, fallback: DeriveMode): DeriveMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "sync" || normalized === "async" ? normalized : fallback;
}

function normalizePreset(input: Record<string, any> | undefined): ImportPreset | null {
  if (!input) return null;
  const rootPath = String(input.rootPath ?? "").trim();
  const partitionKey = String(input.partitionKey ?? "").trim();
  const layer = String(input.layer ?? "").trim().toLowerCase() as RecallLayer;
  if (!rootPath || !partitionKey || !["l0", "l1", "l2"].includes(layer)) return null;
  return {
    rootPath,
    partitionKey,
    layer,
    deriveLayers: parseLayers(input.deriveLayers?.join?.(",") ?? input.deriveLayers, []),
    deriveMode: parseDeriveMode(input.deriveMode, "async"),
    limit: input.limit == null ? undefined : Number(input.limit),
    tags: Array.isArray(input.tags) ? input.tags.map((item) => String(item)) : parseCsv(input.tags, []),
  };
}

function resolveImportPresets(raw: Record<string, any> | undefined): Record<string, ImportPreset> {
  const presets: Record<string, ImportPreset> = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    const preset = normalizePreset(value as Record<string, any>);
    if (preset) presets[name] = preset;
  }
  return presets;
}

export function resolveConfig(raw: Record<string, unknown> | undefined): ContextHubPluginConfig {
  const cfg = (raw ?? {}) as Record<string, any>;
  const recall = (cfg.recall ?? {}) as Record<string, any>;
  const preAnswer = (recall.preAnswer ?? {}) as Record<string, any>;
  const commit = (cfg.commit ?? {}) as Record<string, any>;
  const afterAgentEnd = (commit.afterAgentEnd ?? {}) as Record<string, any>;

  return {
    baseUrl: String(cfg.baseUrl ?? process.env.CONTEXT_HUB_BASE_URL ?? "http://127.0.0.1:4040"),
    token: String(cfg.token ?? process.env.CONTEXT_HUB_TOKEN ?? "") || undefined,
    tenantId: String(cfg.tenantId ?? process.env.CONTEXT_HUB_TENANT_ID ?? ""),
    defaultPartitionKey: String(cfg.defaultPartitionKey ?? process.env.CONTEXT_HUB_DEFAULT_PARTITION_KEY ?? "") || undefined,
    recall: {
      preAnswer: {
        enabled: Boolean(preAnswer.enabled ?? parseBool(process.env.CONTEXT_HUB_RECALL_ENABLED, true)),
        partitions: parseCsv(preAnswer.partitions?.join?.(",") ?? process.env.CONTEXT_HUB_RECALL_PARTITIONS ?? process.env.CONTEXT_HUB_PARTITIONS, []),
        layers: parseLayers(preAnswer.layers?.join?.(",") ?? process.env.CONTEXT_HUB_RECALL_LAYERS, ["l0"]),
        limit: Number(preAnswer.limit ?? process.env.CONTEXT_HUB_RECALL_LIMIT ?? 5),
        rerank: Boolean(preAnswer.rerank ?? parseBool(process.env.CONTEXT_HUB_RECALL_RERANK, false)),
      },
    },
    commit: {
      afterAgentEnd: {
        enabled: Boolean(afterAgentEnd.enabled ?? parseBool(process.env.CONTEXT_HUB_COMMIT_AFTER_AGENT_END_ENABLED, false)),
        partitionKey: String(afterAgentEnd.partitionKey ?? process.env.CONTEXT_HUB_COMMIT_AFTER_AGENT_END_PARTITION_KEY ?? "") || undefined,
        writeMemory: Boolean(afterAgentEnd.writeMemory ?? parseBool(process.env.CONTEXT_HUB_COMMIT_AFTER_AGENT_END_WRITE_MEMORY, false)),
        memoryLayer: String(afterAgentEnd.memoryLayer ?? process.env.CONTEXT_HUB_COMMIT_AFTER_AGENT_END_MEMORY_LAYER ?? "l0").toLowerCase() as RecallLayer,
        maxSummaryChars: Number(afterAgentEnd.maxSummaryChars ?? process.env.CONTEXT_HUB_COMMIT_AFTER_AGENT_END_MAX_SUMMARY_CHARS ?? 1200),
      },
    },
    importPresets: resolveImportPresets(cfg.importPresets),
  };
}
