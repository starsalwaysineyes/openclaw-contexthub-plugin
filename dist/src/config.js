function parseCsv(value, fallback) {
    if (!value)
        return fallback;
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
function parseBool(value, fallback) {
    if (value == null || value.trim() === "")
        return fallback;
    return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
function parseLayers(value, fallback) {
    return parseCsv(value, fallback).map((item) => item.toLowerCase());
}
function parseDeriveMode(value, fallback) {
    const normalized = value?.trim().toLowerCase();
    return normalized === "sync" || normalized === "async" ? normalized : fallback;
}
function normalizePreset(input) {
    if (!input)
        return null;
    const rootPath = String(input.rootPath ?? "").trim();
    const partitionKey = String(input.partitionKey ?? "").trim();
    const layer = String(input.layer ?? "").trim().toLowerCase();
    if (!rootPath || !partitionKey || !["l0", "l1", "l2"].includes(layer))
        return null;
    return {
        rootPath,
        partitionKey,
        layer,
        deriveLayers: parseLayers(input.deriveLayers?.join?.(",") ?? input.deriveLayers, []),
        deriveMode: parseDeriveMode(input.deriveMode, "async"),
        limit: input.limit == null ? undefined : Number(input.limit),
        tags: Array.isArray(input.tags) ? input.tags.map((item) => String(item)) : parseCsv(input.tags, []),
        recordType: input.recordType == null ? undefined : String(input.recordType).trim() || undefined,
        sourceKind: input.sourceKind == null ? undefined : String(input.sourceKind).trim() || undefined,
        relativePathPrefix: input.relativePathPrefix == null ? undefined : String(input.relativePathPrefix).trim() || undefined,
        promptPreset: input.promptPreset == null ? undefined : String(input.promptPreset).trim() || undefined,
        metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : undefined,
        includeGlobs: Array.isArray(input.includeGlobs) ? input.includeGlobs.map((item) => String(item)) : parseCsv(input.includeGlobs, []),
        excludeGlobs: Array.isArray(input.excludeGlobs) ? input.excludeGlobs.map((item) => String(item)) : parseCsv(input.excludeGlobs, []),
    };
}
function resolveImportPresets(raw) {
    const presets = {};
    for (const [name, value] of Object.entries(raw ?? {})) {
        const preset = normalizePreset(value);
        if (preset)
            presets[name] = preset;
    }
    return presets;
}
export function resolveConfig(raw) {
    const cfg = (raw ?? {});
    const recall = (cfg.recall ?? {});
    const preAnswer = (recall.preAnswer ?? {});
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
        importPresets: resolveImportPresets(cfg.importPresets),
    };
}
