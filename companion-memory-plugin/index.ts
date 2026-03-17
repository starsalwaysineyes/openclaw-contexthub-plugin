import type { OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";
import { ContextHubHttpClient } from "./src/contexthub.js";
import { resolveConfig } from "./src/config.js";
import type { QueryItem } from "./src/types.js";

const pluginConfigSchema = {
  type: "object" as const,
  additionalProperties: true,
  properties: {
    baseUrl: { type: "string" as const, description: "ContextHub base URL" },
    token: { type: "string" as const, description: "Optional bearer token" },
    tenantId: { type: "string" as const, description: "ContextHub tenant ID" },
    search: {
      type: "object" as const,
      properties: {
        partitions: { type: "array" as const, items: { type: "string" as const } },
        layers: { type: "array" as const, items: { type: "string" as const } },
        limit: { type: "number" as const },
        rerank: { type: "boolean" as const },
      },
    },
    read: {
      type: "object" as const,
      properties: {
        defaultLines: { type: "number" as const },
        maxLines: { type: "number" as const },
      },
    },
  },
};

function content(text: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function truncate(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}...`;
}

function toNumber(raw: unknown): number | undefined {
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function pickSourcePath(item: QueryItem): string | undefined {
  const source = item.source ?? {};
  for (const key of ["relativePath", "path"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function buildSyntheticPath(item: QueryItem): string {
  return `record:${item.recordId}`;
}

function parseRecordPath(path: string): { recordId: string; hashLine?: number } | null {
  const trimmed = path.trim();
  if (!trimmed) return null;

  const hashIndex = trimmed.indexOf("#L");
  const basePath = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const hashLine = hashIndex >= 0 ? toNumber(trimmed.slice(hashIndex + 2)) : undefined;

  if (basePath.startsWith("record:")) {
    const recordId = basePath.slice("record:".length).trim();
    return recordId ? { recordId, hashLine } : null;
  }

  return null;
}

const plugin = {
  id: "openclaw-contexthub-memory-plugin",
  name: "OpenClaw ContextHub Memory Plugin",
  description: "ContextHub-backed memory_search and memory_get for OpenClaw memory slot integration.",
  kind: "memory" as const,
  configSchema: pluginConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolveConfig((api.pluginConfig ?? {}) as Record<string, unknown>);
    const client = new ContextHubHttpClient({ baseUrl: config.baseUrl, token: config.token });

    api.logger.info(`contexthub-memory-plugin: registered for tenant=${config.tenantId || "<missing>"}`);

    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description:
          "Search ContextHub-backed long-term memory. Use before answering questions about prior work, decisions, dates, preferences, or todos.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", description: "Search query" },
            maxResults: { type: "number", description: "Optional max hits" },
            minScore: { type: "number", description: "Optional client-side score floor" },
          },
          required: ["query"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const query = String(params.query ?? "").trim();
          if (!query) throw new Error("query is required");
          if (!config.tenantId) {
            return content("memory_search is unavailable: tenantId is missing", { disabled: true, error: "tenantId is missing" });
          }

          const maxResults = toNumber(params.maxResults) ?? config.search.limit;
          const minScore = toNumber(params.minScore);
          const result = await client.query({
            tenantId: config.tenantId,
            query,
            partitions: config.search.partitions,
            layers: config.search.layers,
            limit: maxResults,
            rerank: config.search.rerank,
          });

          // Collapse chunk-level hits down to one entry per record so the memory slot sees stable paths.
          const deduped = new Map<string, QueryItem>();
          for (const item of result.items ?? []) {
            if (minScore != null && Number(item.score ?? 0) < minScore) continue;
            const existing = deduped.get(item.recordId);
            if (!existing || Number(item.score ?? 0) > Number(existing.score ?? 0)) {
              deduped.set(item.recordId, item);
            }
          }

          const normalized = Array.from(deduped.values()).map((item) => ({
            path: buildSyntheticPath(item),
            recordId: item.recordId,
            title: item.title,
            layer: item.layer,
            partitionKey: item.partitionKey,
            score: item.score,
            sourcePath: pickSourcePath(item),
            snippet: item.snippet,
            tags: item.tags ?? [],
          }));

          const lines = [`query: ${query}`, `hits: ${normalized.length}`];
          for (const [index, item] of normalized.entries()) {
            lines.push(`${index + 1}. ${item.path} score=${Number(item.score ?? 0).toFixed(3)} [${item.layer}] ${item.title} (${item.partitionKey})`);
            if (item.sourcePath) lines.push(`   source=${item.sourcePath}`);
            lines.push(`   ${truncate(item.snippet ?? "", 220)}`);
          }

          return content(lines.join("\n"), {
            provider: "contexthub",
            retrieval: result.retrieval,
            scope: result.scope,
            results: normalized,
          });
        },
      },
      { names: ["memory_search"] },
    );

    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get",
        description:
          "Read a small numbered snippet from a ContextHub record returned by memory_search. Paths use the synthetic form record:<recordId>.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Synthetic record path from memory_search, for example record:abc123" },
            from: { type: "number", description: "Optional 1-based start line" },
            lines: { type: "number", description: "Optional line count" },
          },
          required: ["path"],
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const path = String(params.path ?? "").trim();
          const parsed = parseRecordPath(path);
          if (!parsed) throw new Error("path must use the form record:<recordId>");

          const from = Math.max(1, Math.floor(toNumber(params.from) ?? parsed.hashLine ?? 1));
          const requestedLines = Math.max(1, Math.floor(toNumber(params.lines) ?? config.read.defaultLines));
          const limit = Math.min(requestedLines, config.read.maxLines);
          const result = await client.readRecordLines(parsed.recordId, from, limit);

          const record = (result.record ?? {}) as Record<string, unknown>;
          const source = (record.source ?? {}) as Record<string, unknown>;
          const sourcePath = [source.relativePath, source.path].find((value) => typeof value === "string" && value.trim()) as string | undefined;
          const title = String(record.title ?? parsed.recordId);
          const layer = String(record.layer ?? "?");
          const partitionKey = String(record.partitionKey ?? "-");
          const endLine = result.returnedLines > 0 ? result.fromLine + result.returnedLines - 1 : result.fromLine;

          const lines = [
            `record: [${layer}] ${title} (${partitionKey})`,
            `path: ${path}`,
            ...(sourcePath ? [`source: ${sourcePath}`] : []),
            `range: ${result.fromLine}-${endLine} / ${result.totalLines}`,
            `hasMore: ${Boolean(result.hasMore)}`,
            ...result.items.map((item) => `${item.lineNumber}: ${item.text}`),
          ];

          return content(lines.join("\n"), {
            provider: "contexthub",
            path,
            recordId: parsed.recordId,
            sourcePath,
            result,
          });
        },
      },
      { names: ["memory_get"] },
    );
  },
};

export default plugin;
