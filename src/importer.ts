import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ContextHubHttpClient } from "./contexthub.js";
import type { ContextHubPluginConfig, ImportPreset } from "./types.js";

const HEADING_RE = /^#\s+(.+?)\s*$/m;

function discoverMarkdownFiles(rootPath: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const resolved = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      found.push(...discoverMarkdownFiles(resolved));
      continue;
    }
    if (entry.isFile() && resolved.endsWith('.md')) found.push(resolved);
  }
  return found.sort();
}

function extractTitle(content: string, fallback: string): string {
  return content.match(HEADING_RE)?.[1]?.trim() || fallback;
}

function buildEffectiveRelativePath(relativePath: string, prefix?: string): string {
  const normalizedPrefix = String(prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
  return normalizedPrefix ? `${normalizedPrefix}/${relativePath}` : relativePath;
}

function idempotencyKey(relativePath: string, layer: string): string {
  const digest = createHash('sha1').update(`${layer}:${relativePath}`).digest('hex').slice(0, 16);
  return `plugin-batch:${layer}:${digest}`;
}

export async function runImportPreset(params: {
  client: ContextHubHttpClient;
  config: ContextHubPluginConfig;
  presetName: string;
  overrideLimit?: number;
  dryRun?: boolean;
}) {
  const preset = params.config.importPresets[params.presetName];
  if (!preset) {
    throw new Error(`unknown import preset: ${params.presetName}`);
  }
  const rootPath = path.resolve(preset.rootPath);
  if (!fs.existsSync(rootPath)) {
    throw new Error(`preset root path not found: ${rootPath}`);
  }

  let files = discoverMarkdownFiles(rootPath);
  const limit = params.overrideLimit ?? preset.limit;
  if (limit != null) files = files.slice(0, limit);

  const results: Array<Record<string, unknown>> = [];
  for (const filePath of files) {
    const relativePath = path.relative(rootPath, filePath).split(path.sep).join('/');
    const effectiveRelativePath = buildEffectiveRelativePath(relativePath, preset.relativePathPrefix);
    const text = fs.readFileSync(filePath, 'utf-8');
    const metadata: Record<string, unknown> = {
      adapter: 'openclaw-contexthub-plugin',
      importPreset: params.presetName,
      relativePath: effectiveRelativePath,
      ...(preset.metadata ?? {}),
    };
    if (effectiveRelativePath !== relativePath) metadata.originalRelativePath = relativePath;
    const payload = {
      tenantId: params.config.tenantId,
      partitionKey: preset.partitionKey,
      type: preset.recordType ?? (preset.layer === 'l0' ? 'memory' : preset.layer === 'l1' ? 'summary' : 'resource'),
      targetLayer: preset.layer,
      title: extractTitle(text, path.parse(filePath).name),
      content: { kind: 'inline_text', text },
      source: {
        kind: preset.sourceKind ?? 'local_file',
        path: filePath,
        relativePath: effectiveRelativePath,
      },
      tags: preset.tags,
      metadata,
      idempotencyKey: idempotencyKey(effectiveRelativePath, preset.layer),
      derive: {
        enabled: preset.deriveLayers.length > 0,
        mode: preset.deriveMode,
        emitLayers: preset.deriveLayers,
        provider: 'litellm',
        promptPreset: preset.promptPreset ?? 'archive_and_memory',
      },
    };

    if (params.dryRun) {
      results.push({ path: filePath, payload });
      continue;
    }

    const response = await params.client.importResource(payload);
    results.push({
      path: filePath,
      recordId: (response as any).record?.id,
      layer: (response as any).record?.layer,
      derivationStatus: (response as any).derivation?.status,
    });
  }

  return {
    preset: params.presetName,
    rootPath,
    count: results.length,
    dryRun: Boolean(params.dryRun),
    results,
  };
}
