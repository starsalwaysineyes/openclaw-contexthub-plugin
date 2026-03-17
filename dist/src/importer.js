import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
const HEADING_RE = /^#\s+(.+?)\s*$/m;
function matchesAnyGlob(relativePath, patterns) {
    return patterns.some((pattern) => {
        const normalized = pattern.trim();
        if (!normalized)
            return false;
        if (path.posix.matchesGlob(relativePath, normalized))
            return true;
        if (normalized.endsWith('/**')) {
            const prefix = normalized.slice(0, -3).replace(/\/+$/, '');
            return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
        }
        return false;
    });
}
function discoverMarkdownFiles(rootPath, includeGlobs = [], excludeGlobs = []) {
    const found = [];
    function walk(currentPath) {
        for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
            const resolved = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                walk(resolved);
                continue;
            }
            if (!entry.isFile() || !resolved.endsWith('.md'))
                continue;
            const relativePath = path.relative(rootPath, resolved).split(path.sep).join('/');
            if (includeGlobs.length > 0 && !matchesAnyGlob(relativePath, includeGlobs))
                continue;
            if (excludeGlobs.length > 0 && matchesAnyGlob(relativePath, excludeGlobs))
                continue;
            found.push(resolved);
        }
    }
    walk(rootPath);
    return found.sort();
}
function extractTitle(content, fallback) {
    return content.match(HEADING_RE)?.[1]?.trim() || fallback;
}
function buildEffectiveRelativePath(relativePath, prefix) {
    const normalizedPrefix = String(prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
    return normalizedPrefix ? `${normalizedPrefix}/${relativePath}` : relativePath;
}
function idempotencyKey(relativePath, layer) {
    const digest = createHash('sha1').update(`${layer}:${relativePath}`).digest('hex').slice(0, 16);
    return `plugin-batch:${layer}:${digest}`;
}
export async function runImportPreset(params) {
    const preset = params.config.importPresets[params.presetName];
    if (!preset) {
        throw new Error(`unknown import preset: ${params.presetName}`);
    }
    const rootPath = path.resolve(preset.rootPath);
    if (!fs.existsSync(rootPath)) {
        throw new Error(`preset root path not found: ${rootPath}`);
    }
    let files = discoverMarkdownFiles(rootPath, preset.includeGlobs ?? [], preset.excludeGlobs ?? []);
    const limit = params.overrideLimit ?? preset.limit;
    if (limit != null)
        files = files.slice(0, limit);
    const results = [];
    for (const filePath of files) {
        const relativePath = path.relative(rootPath, filePath).split(path.sep).join('/');
        const effectiveRelativePath = buildEffectiveRelativePath(relativePath, preset.relativePathPrefix);
        const text = fs.readFileSync(filePath, 'utf-8');
        const metadata = {
            adapter: 'openclaw-contexthub-plugin',
            importPreset: params.presetName,
            relativePath: effectiveRelativePath,
            ...(preset.metadata ?? {}),
        };
        if (effectiveRelativePath !== relativePath)
            metadata.originalRelativePath = relativePath;
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
            recordId: response.record?.id,
            layer: response.record?.layer,
            derivationStatus: response.derivation?.status,
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
