import { ContextHubHttpClient } from "./contexthub.js";
import { runImportPreset } from "./importer.js";
import { buildImportFilePayload, buildSaveTextPayload } from "./payloads.js";
import type { ContextHubPluginConfig, RecallLayer } from "./types.js";

function truncate(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}...`;
}

function content(text: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function normalizeLayers(raw: unknown, fallback: RecallLayer[]): RecallLayer[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  return raw.map((item) => String(item).toLowerCase() as RecallLayer).filter((item) => ["l0", "l1", "l2"].includes(item));
}

function normalizePartitions(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeLimit(raw: unknown, fallback: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function registerPluginTools(params: {
  api: { registerTool: Function };
  config: ContextHubPluginConfig;
  client: ContextHubHttpClient;
}) {
  const { api, config, client } = params;

  api.registerTool(
    {
      name: "ctx_query",
      description: "Semantic query against ContextHub. Default scope comes from plugin recall config and typically targets L0 memory pointers.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Semantic search query" },
          partitions: { type: "array", items: { type: "string" }, description: "Optional partition override" },
          layers: { type: "array", items: { type: "string", enum: ["l0", "l1", "l2"] }, description: "Optional layer override" },
          limit: { type: "number", description: "Optional max hits" },
          rerank: { type: "boolean", description: "Enable rerank" },
        },
        required: ["query"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const query = String(params.query ?? "").trim();
        if (!query) throw new Error("query is required");
        const result = await client.query({
          tenantId: config.tenantId,
          query,
          partitions: normalizePartitions(params.partitions, config.recall.preAnswer.partitions),
          layers: normalizeLayers(params.layers, config.recall.preAnswer.layers),
          limit: normalizeLimit(params.limit, config.recall.preAnswer.limit),
          rerank: typeof params.rerank === "boolean" ? params.rerank : config.recall.preAnswer.rerank,
        });
        const items = result.items ?? [];
        const lines = [`query: ${query}`, `hits: ${items.length}`];
        for (const [index, item] of items.slice(0, 5).entries()) {
          lines.push(`${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey})`);
          lines.push(`   ${truncate(item.snippet ?? "", 180)}`);
        }
        return content(lines.join("\n"), { result });
      },
    },
  );

  api.registerTool(
    {
      name: "ctx_read",
      description: "Read a ContextHub record as numbered lines with explicit line-range limits.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          recordId: { type: "string", description: "Target record ID" },
          fromLine: { type: "number", description: "1-based start line" },
          limit: { type: "number", description: "How many lines to read" },
        },
        required: ["recordId"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const recordId = String(params.recordId ?? "").trim();
        if (!recordId) throw new Error("recordId is required");
        const result = await client.readRecordLines(recordId, normalizeLimit(params.fromLine, 1), normalizeLimit(params.limit, 80));
        const lines = [
          `record: [${result.record.layer}] ${result.record.title}`,
          `range: ${result.fromLine}-${result.fromLine + result.returnedLines - 1} / ${result.totalLines}`,
          `hasMore: ${Boolean(result.hasMore)}`,
          ...result.items.map((item) => `${item.lineNumber}: ${item.text}`),
        ];
        return content(lines.join("\n"), { result });
      },
    },
  );

  api.registerTool(
    {
      name: "ctx_grep",
      description: "Line-oriented grep/rg style search over ContextHub records with line numbers and match ranges.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          pattern: { type: "string", description: "Text or regex pattern" },
          partitions: { type: "array", items: { type: "string" }, description: "Optional partition override" },
          layers: { type: "array", items: { type: "string", enum: ["l0", "l1", "l2"] }, description: "Optional layer override" },
          limit: { type: "number", description: "Optional max matches" },
          regex: { type: "boolean", description: "Interpret pattern as regex" },
          caseSensitive: { type: "boolean", description: "Case-sensitive search" },
        },
        required: ["pattern"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const pattern = String(params.pattern ?? "").trim();
        if (!pattern) throw new Error("pattern is required");
        const result = await client.grep({
          tenantId: config.tenantId,
          pattern,
          partitions: normalizePartitions(params.partitions, config.recall.preAnswer.partitions),
          layers: normalizeLayers(params.layers, ["l0", "l1", "l2"]),
          limit: normalizeLimit(params.limit, 20),
          regex: Boolean(params.regex),
          caseSensitive: Boolean(params.caseSensitive),
        });
        const lines = [
          `pattern: ${pattern}`,
          `matches: ${result.items?.length ?? 0}`,
          ...(result.items ?? []).slice(0, 8).flatMap((item, index) => [
            `${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey}) line ${item.lineNumber}`,
            `   ${truncate(item.text, 180)}`,
          ]),
        ];
        return content(lines.join("\n"), { result });
      },
    },
  );

  api.registerTool(
    {
      name: "ctx_write_text",
      description: "Explicitly write text into ContextHub at a chosen layer. Use for deliberate saves, not implicit memory writing.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          layer: { type: "string", enum: ["l0", "l1", "l2"], description: "Target layer" },
          title: { type: "string", description: "Record title" },
          text: { type: "string", description: "Record text" },
          partitionKey: { type: "string", description: "Optional partition override" },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
        },
        required: ["layer", "title", "text"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const layer = String(params.layer ?? "").toLowerCase() as RecallLayer;
        const title = String(params.title ?? "").trim();
        const text = String(params.text ?? "").trim();
        const partitionKey = String(params.partitionKey ?? config.defaultPartitionKey ?? "").trim();
        if (!partitionKey) throw new Error("partitionKey is required");
        if (!title || !text) throw new Error("title and text are required");
        const result: any = await client.importResource(
          buildSaveTextPayload({
            config,
            partitionKey,
            layer,
            title,
            text,
            tags: Array.isArray(params.tags) ? params.tags.map((item) => String(item)) : [],
          }),
        );
        return content(`saved [${result.record.layer}] ${result.record.title} (${result.record.id})`, { result });
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "ctx_import_file",
      description: "Explicitly import one local file into ContextHub at a chosen layer. Use when an agent intentionally wants to upload a file path.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          layer: { type: "string", enum: ["l0", "l1", "l2"], description: "Target layer" },
          filePath: { type: "string", description: "Local file path" },
          partitionKey: { type: "string", description: "Optional partition override" },
          title: { type: "string", description: "Optional title override" },
        },
        required: ["layer", "filePath"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const layer = String(params.layer ?? "").toLowerCase() as RecallLayer;
        const filePath = String(params.filePath ?? "").trim();
        const partitionKey = String(params.partitionKey ?? config.defaultPartitionKey ?? "").trim();
        if (!partitionKey) throw new Error("partitionKey is required");
        if (!filePath) throw new Error("filePath is required");
        const result: any = await client.importResource(
          buildImportFilePayload({
            config,
            partitionKey,
            layer,
            filePath,
            titleOverride: String(params.title ?? "").trim() || undefined,
          }),
        );
        return content(`imported [${result.record.layer}] ${result.record.title} (${result.record.id})`, { result });
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "ctx_import_preset",
      description: "Run one configured local import preset against ContextHub. Useful for migration batches that should follow a known preset.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          presetName: { type: "string", description: "Configured preset name" },
          limit: { type: "number", description: "Optional override for max files" },
          dryRun: { type: "boolean", description: "When true, only preview payloads" },
        },
        required: ["presetName"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const presetName = String(params.presetName ?? "").trim();
        if (!presetName) throw new Error("presetName is required");
        const result = await runImportPreset({
          client,
          config,
          presetName,
          overrideLimit: params.limit == null ? undefined : normalizeLimit(params.limit, 1),
          dryRun: Boolean(params.dryRun),
        });
        const lines = [
          `preset: ${result.preset}`,
          `count: ${result.count}`,
          `dryRun: ${Boolean(result.dryRun)}`,
        ];
        for (const [index, item] of result.results.slice(0, 5).entries()) {
          lines.push(`${index + 1}. ${(item as any).path} -> ${(item as any).layer ?? "?"} (${(item as any).derivationStatus ?? (result.dryRun ? "dry-run" : "unknown")})`);
        }
        return content(lines.join("\n"), { result });
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "ctx_job",
      description: "Inspect one ContextHub derivation job by ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          jobId: { type: "string", description: "Derivation job ID" },
        },
        required: ["jobId"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const jobId = String(params.jobId ?? "").trim();
        if (!jobId) throw new Error("jobId is required");
        const result = await client.getDerivationJob(jobId);
        const lines = [
          `job: ${result.id}`,
          `status: ${result.status}`,
          `mode: ${result.mode ?? "-"}${result.effectiveMode ? ` -> ${result.effectiveMode}` : ""}`,
          `sourceRecordId: ${result.sourceRecordId ?? "-"}`,
          `error: ${result.errorMessage ?? "-"}`,
        ];
        return content(lines.join("\n"), { result });
      },
    },
  );

  api.registerTool(
    {
      name: "ctx_links",
      description: "Inspect record links emitted by derivation or import lineage.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          recordId: { type: "string", description: "Record ID" },
        },
        required: ["recordId"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const recordId = String(params.recordId ?? "").trim();
        if (!recordId) throw new Error("recordId is required");
        const result = await client.listRecordLinks(recordId);
        const lines = [`links: ${result.items.length}`];
        for (const [index, item] of result.items.slice(0, 8).entries()) {
          lines.push(`${index + 1}. ${item.relation} ${item.sourceRecordId} -> ${item.targetRecordId}`);
        }
        return content(lines.join("\n"), { result });
      },
    },
  );
}
