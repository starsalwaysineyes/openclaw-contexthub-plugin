import * as fs from "node:fs";
import type { PluginCommandContext } from "openclaw/plugin-sdk";
import { ContextHubHttpClient } from "./contexthub.js";
import { runImportPreset } from "./importer.js";
import { buildImportFilePayload, buildSaveTextPayload, buildUploadLastSessionPayload } from "./payloads.js";
import type { ContextHubPluginConfig, LastSessionCapture, RecallLayer } from "./types.js";

function parseLayer(raw: string): RecallLayer {
  const normalized = raw.trim().toLowerCase();
  if (normalized !== "l0" && normalized !== "l1" && normalized !== "l2") {
    throw new Error(`invalid layer: ${raw}`);
  }
  return normalized;
}

function splitHead(input: string): { head: string; rest: string } {
  const trimmed = input.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex < 0) return { head: trimmed, rest: "" };
  return {
    head: trimmed.slice(0, spaceIndex),
    rest: trimmed.slice(spaceIndex + 1).trim(),
  };
}

function parseSaveArgs(args: string | undefined, defaultPartitionKey?: string): {
  layer: RecallLayer;
  partitionKey: string;
  title: string;
  text: string;
} {
  const input = args?.trim() || "";
  const first = splitHead(input);
  const second = splitHead(first.rest);
  if (!first.head || !second.head || !second.rest) {
    throw new Error("usage: /contexthub-save <layer> <partitionKey|-> <title> :: <text>");
  }
  const layer = parseLayer(first.head);
  const partitionToken = second.head;
  const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
  if (!partitionKey) throw new Error("partitionKey is required (or configure defaultPartitionKey)");
  const marker = second.rest.indexOf("::");
  if (marker < 0) throw new Error("usage: /contexthub-save <layer> <partitionKey|-> <title> :: <text>");
  const title = second.rest.slice(0, marker).trim();
  const text = second.rest.slice(marker + 2).trim();
  if (!title || !text) throw new Error("title and text are required");
  return { layer, partitionKey, title, text };
}

function parseCommitArgs(args: string | undefined, defaultPartitionKey?: string): {
  partitionKey: string;
  summary: string;
  memoryTitle?: string;
  memoryText?: string;
} {
  const input = args?.trim() || "";
  const first = splitHead(input);
  if (!first.head || !first.rest) {
    throw new Error("usage: /contexthub-commit <partitionKey|-> <summary> [:: memoryTitle :: memoryText]");
  }
  const partitionToken = first.head;
  const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
  if (!partitionKey) throw new Error("partitionKey is required (or configure defaultPartitionKey)");
  const segments = first.rest.split("::").map((item) => item.trim()).filter(Boolean);
  if (segments.length === 0) throw new Error("summary is required");
  return {
    partitionKey,
    summary: segments[0],
    memoryTitle: segments[1],
    memoryText: segments[2],
  };
}

function parseImportFileArgs(args: string | undefined, defaultPartitionKey?: string): {
  layer: RecallLayer;
  partitionKey: string;
  filePath: string;
  titleOverride?: string;
} {
  const input = args?.trim() || "";
  const first = splitHead(input);
  const second = splitHead(first.rest);
  if (!first.head || !second.head || !second.rest) {
    throw new Error("usage: /contexthub-import-file <layer> <partitionKey|-> <filePath> [:: title]");
  }
  const layer = parseLayer(first.head);
  const partitionToken = second.head;
  const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
  if (!partitionKey) throw new Error("partitionKey is required (or configure defaultPartitionKey)");
  const fileAndTitle = second.rest;
  const marker = fileAndTitle.indexOf("::");
  const filePath = (marker >= 0 ? fileAndTitle.slice(0, marker) : fileAndTitle).trim();
  const titleOverride = marker >= 0 ? fileAndTitle.slice(marker + 2).trim() : undefined;
  if (!filePath) throw new Error("filePath is required");
  if (!fs.existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  return { layer, partitionKey, filePath, titleOverride: titleOverride || undefined };
}

function parseImportPresetArgs(args: string | undefined): { presetName: string; limit?: number; dryRun: boolean } {
  const input = args?.trim() || "";
  if (!input) throw new Error("usage: /contexthub-import-preset <presetName> [limit] [--dry-run]");
  const parts = input.split(/\s+/).filter(Boolean);
  const presetName = parts[0];
  const dryRun = parts.includes("--dry-run");
  const numeric = parts.find((item) => /^\d+$/.test(item));
  return {
    presetName,
    limit: numeric ? Number(numeric) : undefined,
    dryRun,
  };
}

function parseQueryArgs(
  args: string | undefined,
  defaults: {
    partitions: string[];
    layers: RecallLayer[];
    limit: number;
    rerank: boolean;
  },
): {
  query: string;
  partitions: string[];
  layers: RecallLayer[];
  limit: number;
  rerank: boolean;
  json: boolean;
} {
  const rawInput = args?.trim() || "";
  if (!rawInput) throw new Error("usage: /contexthub-query <query> [:: partitions] [:: layers] [:: limit] [:: rerank] [--json]");
  const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
  const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
  const parts = input.split("::").map((item) => item.trim());
  const query = parts[0];
  if (!query) throw new Error("query is required");

  const partitions = parts[1]
    ? parts[1].split(",").map((item) => item.trim()).filter(Boolean)
    : defaults.partitions;
  const layers = parts[2]
    ? parts[2].split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) as RecallLayer[]
    : defaults.layers;
  const limit = parts[3] ? Number(parts[3]) : defaults.limit;
  const rerank = parts[4]
    ? ["1", "true", "yes", "on", "rerank"].includes(parts[4].toLowerCase())
    : defaults.rerank;

  return { query, partitions, layers, limit, rerank, json };
}

function parseUploadLastSessionArgs(args: string | undefined, defaultPartitionKey?: string): {
  partitionKey: string;
  titleOverride?: string;
} {
  const input = args?.trim() || "";
  if (!input) {
    if (!defaultPartitionKey) throw new Error("usage: /contexthub-upload-last-session <partitionKey|-> [:: title]");
    return { partitionKey: defaultPartitionKey };
  }
  const parts = input.split("::").map((item) => item.trim());
  const partitionToken = parts[0];
  const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
  if (!partitionKey) throw new Error("partitionKey is required (or configure defaultPartitionKey)");
  return {
    partitionKey,
    titleOverride: parts[1] || undefined,
  };
}

function truncate(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}...`;
}

function textReply(text: string, isError = false) {
  return { text, isError };
}

function formatQuerySummary(payload: {
  query: { query: string; partitions: string[]; layers: RecallLayer[]; limit: number; rerank: boolean };
  result: { items?: Array<Record<string, any>>; retrieval?: Record<string, any> };
}): string {
  const items = payload.result.items ?? [];
  const retrieval = payload.result.retrieval ?? {};
  const grouped = new Map<string, { top: Record<string, any>; hits: number }>();
  for (const item of items) {
    const key = String(item.recordId ?? item.chunkId ?? Math.random());
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { top: item, hits: 1 });
      continue;
    }
    existing.hits += 1;
    if (Number(item.score ?? 0) > Number(existing.top.score ?? 0)) {
      existing.top = item;
    }
  }
  const unique = [...grouped.values()]
    .sort((a, b) => Number(b.top.score ?? 0) - Number(a.top.score ?? 0))
    .slice(0, 5);

  const lines = [
    `query: ${payload.query.query}`,
    `scope: partitions=${payload.query.partitions.join(",") || "(all readable)"} layers=${payload.query.layers.join(",")}`,
    `retrieval: uniqueRecords=${grouped.size} rawHits=${items.length} embeddings=${Boolean(retrieval.usedEmbeddings)} rerank=${Boolean(retrieval.usedRerank)} candidates=${retrieval.candidateCount ?? "?"}`,
  ];
  for (const [index, entry] of unique.entries()) {
    const item = entry.top;
    lines.push(`${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey}) score=${Number(item.score ?? 0).toFixed(3)} hits=${entry.hits}`);
    lines.push(`   ${truncate(String(item.snippet ?? ""), 180)}`);
  }
  return lines.join("\n");
}

function formatSaveSummary(result: any): string {
  return [
    `saved: [${result.record.layer}] ${result.record.title}`,
    `recordId: ${result.record.id}`,
    `partition: ${result.record.partitionKey}`,
    `derivation: ${result.derivation.status}`,
  ].join("\n");
}

function formatCommitSummary(result: any): string {
  const created = Array.isArray(result.createdMemories) ? result.createdMemories.length : 0;
  return [
    `committed session: ${result.session.id}`,
    `partition: ${result.session.partitionKey}`,
    `summary: ${truncate(String(result.session.summary ?? ""), 120)}`,
    `createdMemories: ${created}`,
  ].join("\n");
}

function formatImportFileSummary(result: any): string {
  return [
    `imported file: [${result.record.layer}] ${result.record.title}`,
    `recordId: ${result.record.id}`,
    `partition: ${result.record.partitionKey}`,
    `derivation: ${result.derivation.status}`,
  ].join("\n");
}

function formatImportPresetSummary(result: any): string {
  const rows = (result.results ?? []).slice(0, 5).map((item: any, index: number) => `${index + 1}. ${item.path} -> ${item.layer ?? "?"} (${item.derivationStatus ?? (result.dryRun ? "dry-run" : "unknown")})`);
  return [
    `preset: ${result.preset}`,
    `rootPath: ${result.rootPath}`,
    `count: ${result.count}`,
    `dryRun: ${Boolean(result.dryRun)}`,
    ...rows,
  ].join("\n");
}

function formatJobSummary(job: any): string {
  return [
    `job: ${job.id}`,
    `status: ${job.status}`,
    `mode: ${job.mode}${job.effectiveMode ? ` -> ${job.effectiveMode}` : ""}`,
    `sourceRecordId: ${job.sourceRecordId ?? "-"}`,
    `error: ${job.errorMessage ?? "-"}`,
  ].join("\n");
}

function formatLinksSummary(payload: { items?: Array<Record<string, any>> }): string {
  const items = payload.items ?? [];
  const lines = [`links: ${items.length}`];
  for (const [index, item] of items.slice(0, 8).entries()) {
    lines.push(`${index + 1}. ${item.relation} ${item.sourceRecordId} -> ${item.targetRecordId}`);
  }
  return lines.join("\n");
}

export function registerPluginCommands(params: {
  api: { registerCommand: Function };
  config: ContextHubPluginConfig;
  client: ContextHubHttpClient;
  state: { lastSessionCapture: LastSessionCapture | null };
}) {
  const { api, config, client, state } = params;

  api.registerCommand({
    name: "contexthub-recall",
    description: "Show effective ContextHub pre-answer recall config",
    acceptsArgs: false,
    requireAuth: true,
    handler: async () => textReply(JSON.stringify({
      enabled: config.recall.preAnswer.enabled,
      tenantId: config.tenantId,
      partitions: config.recall.preAnswer.partitions,
      layers: config.recall.preAnswer.layers,
      limit: config.recall.preAnswer.limit,
      rerank: config.recall.preAnswer.rerank,
    }, null, 2)),
  });

  api.registerCommand({
    name: "contexthub-query",
    description: "Query ContextHub explicitly: /contexthub-query <query> [:: partitions] [:: layers] [:: limit] [:: rerank]",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      try {
        const parsed = parseQueryArgs(ctx.args, {
          partitions: config.recall.preAnswer.partitions,
          layers: config.recall.preAnswer.layers,
          limit: config.recall.preAnswer.limit,
          rerank: config.recall.preAnswer.rerank,
        });
        const result = await client.query({
          tenantId: config.tenantId,
          query: parsed.query,
          partitions: parsed.partitions,
          layers: parsed.layers,
          limit: parsed.limit,
          rerank: parsed.rerank,
        });
        if (parsed.json) {
          return textReply(JSON.stringify({ query: parsed, result }, null, 2));
        }
        return textReply(formatQuerySummary({ query: parsed, result }));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });

  api.registerCommand({
    name: "contexthub-presets",
    description: "List configured ContextHub import presets",
    acceptsArgs: false,
    requireAuth: true,
    handler: async () => {
      const presetNames = Object.keys(config.importPresets);
      if (presetNames.length === 0) return textReply("importPresets: none configured");
      const lines = ["importPresets:"];
      for (const name of presetNames) {
        const preset = config.importPresets[name];
        lines.push(`- ${name}: ${preset.rootPath} -> ${preset.partitionKey}/${preset.layer}`);
      }
      return textReply(lines.join("\n"));
    },
  });

  api.registerCommand({
    name: "contexthub-last-session",
    description: "Show cached last completed OpenClaw session capture",
    acceptsArgs: false,
    requireAuth: true,
    handler: async () => {
      if (!state.lastSessionCapture) return textReply("no cached session available", true);
      const capture = state.lastSessionCapture;
      return textReply([
        `capturedAt: ${capture.capturedAt}`,
        `success: ${capture.success}`,
        `durationMs: ${capture.durationMs ?? 0}`,
        `messageCount: ${capture.messageCount}`,
        `title: ${capture.title}`,
        `idempotencyKey: ${capture.idempotencyKey}`,
      ].join("\n"));
    },
  });

  api.registerCommand({
    name: "contexthub-upload-last-session",
    description: "Upload cached full session transcript to L2: /contexthub-upload-last-session <partitionKey|-> [:: title]",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      try {
        const capture = state.lastSessionCapture;
        if (!capture) throw new Error("no cached session available; wait until a session completes first");
        const parsed = parseUploadLastSessionArgs(ctx.args, config.defaultPartitionKey);
        const result = await client.importResource(buildUploadLastSessionPayload({
          config,
          partitionKey: parsed.partitionKey,
          capture,
          titleOverride: parsed.titleOverride,
        }));
        return textReply(formatImportFileSummary({ record: (result as any).record, derivation: (result as any).derivation }));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });

  api.registerCommand({
    name: "contexthub-save",
    description: "Save text directly to ContextHub: /contexthub-save <layer> <partitionKey|-> <title> :: <text>",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      try {
        const parsed = parseSaveArgs(ctx.args, config.defaultPartitionKey);
        const result = await client.importResource(buildSaveTextPayload({
          config,
          partitionKey: parsed.partitionKey,
          layer: parsed.layer,
          title: parsed.title,
          text: parsed.text,
        }));
        return textReply(formatSaveSummary({ record: (result as any).record, derivation: (result as any).derivation }));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });

  api.registerCommand({
    name: "contexthub-commit",
    description: "Commit a curated session summary: /contexthub-commit <partitionKey|-> <summary> [:: memoryTitle :: memoryText]",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      try {
        const parsed = parseCommitArgs(ctx.args, config.defaultPartitionKey);
        const payload: Record<string, unknown> = {
          tenantId: config.tenantId,
          partitionKey: parsed.partitionKey,
          summary: parsed.summary,
          messages: [],
          memoryEntries: parsed.memoryTitle && parsed.memoryText ? [{
            title: parsed.memoryTitle,
            text: parsed.memoryText,
            layer: "l0",
            importance: 3.0,
            tags: ["plugin-commit"],
          }] : [],
          metadata: {
            adapter: "openclaw-contexthub-plugin",
            command: "contexthub-commit",
          },
        };
        const result = await client.commitSession(payload);
        return textReply(formatCommitSummary(result));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });

  api.registerCommand({
    name: "contexthub-import-file",
    description: "Import one local file: /contexthub-import-file <layer> <partitionKey|-> <filePath> [:: title]",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      try {
        const parsed = parseImportFileArgs(ctx.args, config.defaultPartitionKey);
        const result = await client.importResource(buildImportFilePayload({
          config,
          partitionKey: parsed.partitionKey,
          layer: parsed.layer,
          filePath: parsed.filePath,
          titleOverride: parsed.titleOverride,
        }));
        return textReply(formatImportFileSummary({ record: (result as any).record, derivation: (result as any).derivation }));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });

  api.registerCommand({
    name: "contexthub-import-preset",
    description: "Import a configured local batch: /contexthub-import-preset <presetName> [limit] [--dry-run]",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      try {
        const parsed = parseImportPresetArgs(ctx.args);
        const result = await runImportPreset({
          client,
          config,
          presetName: parsed.presetName,
          overrideLimit: parsed.limit,
          dryRun: parsed.dryRun,
        });
        return textReply(formatImportPresetSummary(result));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });

  api.registerCommand({
    name: "contexthub-job",
    description: "Inspect one derivation job: /contexthub-job <jobId>",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      try {
        const jobId = ctx.args?.trim();
        if (!jobId) throw new Error("usage: /contexthub-job <jobId>");
        const job = await client.getDerivationJob(jobId);
        return textReply(formatJobSummary(job));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });

  api.registerCommand({
    name: "contexthub-links",
    description: "Inspect record links: /contexthub-links <recordId>",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      try {
        const recordId = ctx.args?.trim();
        if (!recordId) throw new Error("usage: /contexthub-links <recordId>");
        const links = await client.listRecordLinks(recordId);
        return textReply(formatLinksSummary(links));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });
}
