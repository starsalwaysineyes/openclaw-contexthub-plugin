function parseCsv(value, fallback) {
    if (typeof value !== "string")
        return fallback;
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
function parseArray(raw, fallback) {
    if (Array.isArray(raw)) {
        return raw.map((item) => String(item).trim()).filter(Boolean);
    }
    return parseCsv(raw, fallback);
}
function parseBool(value, fallback) {
    if (typeof value === "boolean")
        return value;
    if (typeof value !== "string" || value.trim() === "")
        return fallback;
    return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
function parseNumber(value, fallback) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function parseLayers(raw, fallback) {
    return parseArray(raw, fallback).map((item) => item.toLowerCase()).filter((item) => ["l0", "l1", "l2"].includes(item));
}
export function resolveConfig(raw) {
    const cfg = (raw ?? {});
    const search = (cfg.search ?? {});
    const recall = (cfg.recall ?? {});
    const preAnswer = (recall.preAnswer ?? {});
    const read = (cfg.read ?? {});
    return {
        baseUrl: String(cfg.baseUrl ?? process.env.CONTEXT_HUB_BASE_URL ?? "http://127.0.0.1:4040"),
        token: String(cfg.token ?? process.env.CONTEXT_HUB_TOKEN ?? "") || undefined,
        tenantId: String(cfg.tenantId ?? process.env.CONTEXT_HUB_TENANT_ID ?? ""),
        search: {
            partitions: parseArray(search.partitions ?? preAnswer.partitions ?? process.env.CONTEXT_HUB_RECALL_PARTITIONS ?? process.env.CONTEXT_HUB_PARTITIONS, []),
            layers: parseLayers(search.layers ?? preAnswer.layers ?? process.env.CONTEXT_HUB_RECALL_LAYERS, ["l0"]),
            limit: parseNumber(search.limit ?? preAnswer.limit ?? process.env.CONTEXT_HUB_RECALL_LIMIT, 5),
            rerank: parseBool(search.rerank ?? preAnswer.rerank ?? process.env.CONTEXT_HUB_RECALL_RERANK, false),
        },
        read: {
            defaultLines: parseNumber(read.defaultLines, 40),
            maxLines: parseNumber(read.maxLines, 200),
        },
    };
}
