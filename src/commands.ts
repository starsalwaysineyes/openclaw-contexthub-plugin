import * as fs from "node:fs";
import type { PluginCommandContext } from "openclaw/plugin-sdk";
import { ContextHubHttpClient } from "./contexthub.js";
import { runImportPreset } from "./importer.js";
import { buildImportFilePayload, buildSaveTextPayload } from "./payloads.js";
import type { ContextHubPluginConfig, RecallLayer } from "./types.js";

function parseLayer(raw: string): RecallLayer {
  const normalized = raw.trim().toLowerCase();
  if (normalized !== "l0" && normalized !== "l1" && normalized !== "l2") {
    throw new Error(`invalid layer: ${raw}`);
  }
  return normalized;
}

function parseSaveArgs(args: string | undefined, defaultPartitionKey?: string): {
  layer: RecallLayer;
  partitionKey: string;
  title: string;
  text: string;
} {
  const input = args?.trim() || "";
  const parts = input.split(/\s+/, 3);
  if (parts.length < 2) {
    throw new Error("usage: /contexthub-save <layer> <partitionKey|-> <title> :: <text>");
  }
  const layer = parseLayer(parts[0]);
  const partitionToken = parts[1];
  const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
  if (!partitionKey) throw new Error("partitionKey is required (or configure defaultPartitionKey)");
  const rest = input.split(/\s+/, 3)[2] || "";
  const marker = rest.indexOf("::");
  if (marker < 0) throw new Error("usage: /contexthub-save <layer> <partitionKey|-> <title> :: <text>");
  const title = rest.slice(0, marker).trim();
  const text = rest.slice(marker + 2).trim();
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
  const parts = input.split(/\s+/, 2);
  if (parts.length < 2) {
    throw new Error("usage: /contexthub-commit <partitionKey|-> <summary> [:: memoryTitle :: memoryText]");
  }
  const partitionToken = parts[0];
  const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
  if (!partitionKey) throw new Error("partitionKey is required (or configure defaultPartitionKey)");
  const rest = parts[1];
  const segments = rest.split("::").map((item) => item.trim()).filter(Boolean);
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
  const parts = input.split(/\s+/, 3);
  if (parts.length < 3) {
    throw new Error("usage: /contexthub-import-file <layer> <partitionKey|-> <filePath> [:: title]");
  }
  const layer = parseLayer(parts[0]);
  const partitionToken = parts[1];
  const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
  if (!partitionKey) throw new Error("partitionKey is required (or configure defaultPartitionKey)");
  const fileAndTitle = parts[2];
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

function textReply(text: string, isError = false) {
  return { text, isError };
}

export function registerPluginCommands(params: {
  api: { registerCommand: Function };
  config: ContextHubPluginConfig;
  client: ContextHubHttpClient;
}) {
  const { api, config, client } = params;

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
        return textReply(JSON.stringify({ action: "save", record: (result as any).record, derivation: (result as any).derivation }, null, 2));
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
        return textReply(JSON.stringify({ action: "commit", result }, null, 2));
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
        return textReply(JSON.stringify({ action: "import-file", record: (result as any).record, derivation: (result as any).derivation }, null, 2));
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
        return textReply(JSON.stringify({ action: "import-preset", result }, null, 2));
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
        return textReply(JSON.stringify(job, null, 2));
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
        return textReply(JSON.stringify(links, null, 2));
      } catch (error) {
        return textReply(String(error), true);
      }
    },
  });
}
