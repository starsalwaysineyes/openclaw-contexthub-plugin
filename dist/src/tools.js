import { runImportPreset } from "./importer.js";
import { buildImportFilePayload, buildSaveTextPayload } from "./payloads.js";
function truncate(value, limit = 220) {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}...`;
}
function content(text, details) {
    return {
        content: [{ type: "text", text }],
        details,
    };
}
function normalizeLayers(raw, fallback) {
    if (!Array.isArray(raw) || raw.length === 0)
        return fallback;
    return raw.map((item) => String(item).toLowerCase()).filter((item) => ["l0", "l1", "l2"].includes(item));
}
function normalizePartitions(raw, fallback) {
    if (!Array.isArray(raw) || raw.length === 0)
        return fallback;
    return raw.map((item) => String(item).trim()).filter(Boolean);
}
function normalizeLimit(raw, fallback) {
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
function normalizeStringArray(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.map((item) => String(item).trim()).filter(Boolean);
}
function summarizeScope(scope) {
    if (!scope)
        return [];
    const requestedPartitions = (scope.requestedPartitions ?? []).join(",") || "-";
    const effectivePartitions = (scope.effectivePartitions ?? []).join(",") || "-";
    const requestedLayers = (scope.requestedLayers ?? []).join(",") || "-";
    const requestedTags = (scope.requestedTags ?? []).join(",") || "-";
    return [
        `scope: auth=${scope.authKind ?? "?"} requestedPartitions=${requestedPartitions} effectivePartitions=${effectivePartitions}`,
        `filters: layers=${requestedLayers} tags=${requestedTags}`,
    ];
}
export function registerPluginTools(params) {
    const { api, config, client } = params;
    api.registerTool({
        name: "ctx_query",
        description: "Semantic query against ContextHub. Default scope comes from plugin recall config and typically targets L0 memory pointers.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                query: { type: "string", description: "Semantic search query" },
                partitions: { type: "array", items: { type: "string" }, description: "Optional partition override" },
                layers: { type: "array", items: { type: "string", enum: ["l0", "l1", "l2"] }, description: "Optional layer override" },
                tags: { type: "array", items: { type: "string" }, description: "Optional collaboration tag filter" },
                limit: { type: "number", description: "Optional max hits" },
                rerank: { type: "boolean", description: "Enable rerank" },
            },
            required: ["query"],
        },
        async execute(_toolCallId, params) {
            const query = String(params.query ?? "").trim();
            if (!query)
                throw new Error("query is required");
            const result = await client.query({
                tenantId: config.tenantId,
                query,
                partitions: normalizePartitions(params.partitions, config.recall.preAnswer.partitions),
                layers: normalizeLayers(params.layers, config.recall.preAnswer.layers),
                tags: normalizeStringArray(params.tags),
                limit: normalizeLimit(params.limit, config.recall.preAnswer.limit),
                rerank: typeof params.rerank === "boolean" ? params.rerank : config.recall.preAnswer.rerank,
            });
            const items = result.items ?? [];
            const lines = [`query: ${query}`, ...summarizeScope(result.scope), `hits: ${items.length}`];
            for (const [index, item] of items.slice(0, 5).entries()) {
                lines.push(`${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey})`);
                lines.push(`   ${truncate(item.snippet ?? "", 180)}`);
            }
            return content(lines.join("\n"), { result });
        },
    });
    api.registerTool({
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
        async execute(_toolCallId, params) {
            const recordId = String(params.recordId ?? "").trim();
            if (!recordId)
                throw new Error("recordId is required");
            const result = await client.readRecordLines(recordId, normalizeLimit(params.fromLine, 1), normalizeLimit(params.limit, 80));
            const lines = [
                `record: [${result.record.layer}] ${result.record.title}`,
                `range: ${result.fromLine}-${result.fromLine + result.returnedLines - 1} / ${result.totalLines}`,
                `hasMore: ${Boolean(result.hasMore)}`,
                ...result.items.map((item) => `${item.lineNumber}: ${item.text}`),
            ];
            return content(lines.join("\n"), { result });
        },
    });
    api.registerTool({
        name: "ctx_tree",
        description: "Browse one source-path tree level in ContextHub, similar to listing a directory in a remote file system.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                partitions: { type: "array", items: { type: "string" }, description: "Optional partition override" },
                layers: { type: "array", items: { type: "string", enum: ["l0", "l1", "l2"] }, description: "Optional layer override" },
                tags: { type: "array", items: { type: "string" }, description: "Optional collaboration tag filter" },
                pathPrefix: { type: "string", description: "Optional path prefix such as archive or memory/2026" },
                limit: { type: "number", description: "Optional max nodes" },
            },
        },
        async execute(_toolCallId, params) {
            const result = await client.browseRecordTree({
                tenantId: config.tenantId,
                partitions: normalizePartitions(params.partitions, config.recall.preAnswer.partitions),
                layers: normalizeLayers(params.layers, ["l0", "l1", "l2"]),
                tags: normalizeStringArray(params.tags),
                pathPrefix: typeof params.pathPrefix === "string" ? params.pathPrefix : undefined,
                limit: normalizeLimit(params.limit, 50),
            });
            const lines = [
                `path: ${result.pathPrefix || "/"}`,
                ...summarizeScope(result.scope),
                `nodes: ${result.items.length}`,
                `matchedRecords: ${result.summary?.totalMatchedRecords ?? 0}`,
            ];
            for (const [index, item] of result.items.slice(0, 12).entries()) {
                lines.push(`${index + 1}. ${item.kind === "dir" ? "[dir]" : "[file]"} ${item.path} records=${item.recordCount}`);
            }
            return content(lines.join("\n"), { result });
        },
    });
    api.registerTool({
        name: "ctx_list",
        description: "Browse ContextHub records with structural filters when the agent does not yet know a recordId.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                partitions: { type: "array", items: { type: "string" }, description: "Optional partition override" },
                layers: { type: "array", items: { type: "string", enum: ["l0", "l1", "l2"] }, description: "Optional layer override" },
                tags: { type: "array", items: { type: "string" }, description: "Optional tag filter" },
                titleContains: { type: "string", description: "Optional title substring" },
                sourcePathPrefix: { type: "string", description: "Optional source relative/path prefix" },
                limit: { type: "number", description: "Optional max records" },
                offset: { type: "number", description: "Optional offset" },
            },
        },
        async execute(_toolCallId, params) {
            const result = await client.listRecords({
                tenantId: config.tenantId,
                partitions: normalizePartitions(params.partitions, config.recall.preAnswer.partitions),
                layers: normalizeLayers(params.layers, ["l0", "l1", "l2"]),
                tags: normalizeStringArray(params.tags),
                titleContains: typeof params.titleContains === "string" ? params.titleContains : undefined,
                sourcePathPrefix: typeof params.sourcePathPrefix === "string" ? params.sourcePathPrefix : undefined,
                offset: params.offset == null ? 0 : normalizeLimit(params.offset, 0),
                limit: normalizeLimit(params.limit, 20),
            });
            const items = result.items ?? [];
            const lines = [
                ...summarizeScope(result.scope),
                `records: ${items.length}`,
                `hasMore: ${Boolean(result.page?.hasMore)}`,
            ];
            for (const [index, item] of items.slice(0, 8).entries()) {
                const sourcePath = String(item.source?.relativePath ?? item.source?.path ?? "-");
                lines.push(`${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey})`);
                lines.push(`   id=${item.id} lines=${item.lineCount} source=${sourcePath}`);
                lines.push(`   ${truncate(item.textPreview ?? "", 160)}`);
            }
            return content(lines.join("\n"), { result });
        },
    });
    api.registerTool({
        name: "ctx_grep",
        description: "Line-oriented grep/rg style search over ContextHub records with line numbers and match ranges.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                pattern: { type: "string", description: "Text or regex pattern" },
                partitions: { type: "array", items: { type: "string" }, description: "Optional partition override" },
                layers: { type: "array", items: { type: "string", enum: ["l0", "l1", "l2"] }, description: "Optional layer override" },
                tags: { type: "array", items: { type: "string" }, description: "Optional collaboration tag filter" },
                limit: { type: "number", description: "Optional max matches" },
                regex: { type: "boolean", description: "Interpret pattern as regex" },
                caseSensitive: { type: "boolean", description: "Case-sensitive search" },
            },
            required: ["pattern"],
        },
        async execute(_toolCallId, params) {
            const pattern = String(params.pattern ?? "").trim();
            if (!pattern)
                throw new Error("pattern is required");
            const result = await client.grep({
                tenantId: config.tenantId,
                pattern,
                partitions: normalizePartitions(params.partitions, config.recall.preAnswer.partitions),
                layers: normalizeLayers(params.layers, ["l0", "l1", "l2"]),
                tags: normalizeStringArray(params.tags),
                limit: normalizeLimit(params.limit, 20),
                regex: Boolean(params.regex),
                caseSensitive: Boolean(params.caseSensitive),
            });
            const lines = [
                `pattern: ${pattern}`,
                ...summarizeScope(result.scope),
                `matches: ${result.items?.length ?? 0}`,
                ...(result.items ?? []).slice(0, 8).flatMap((item, index) => [
                    `${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey}) line ${item.lineNumber}`,
                    `   ${truncate(item.text, 180)}`,
                ]),
            ];
            return content(lines.join("\n"), { result });
        },
    });
    api.registerTool({
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
        async execute(_toolCallId, params) {
            const layer = String(params.layer ?? "").toLowerCase();
            const title = String(params.title ?? "").trim();
            const text = String(params.text ?? "").trim();
            const partitionKey = String(params.partitionKey ?? config.defaultPartitionKey ?? "").trim();
            if (!partitionKey)
                throw new Error("partitionKey is required");
            if (!title || !text)
                throw new Error("title and text are required");
            const result = await client.importResource(buildSaveTextPayload({
                config,
                partitionKey,
                layer,
                title,
                text,
                tags: Array.isArray(params.tags) ? params.tags.map((item) => String(item)) : [],
            }));
            return content(`saved [${result.record.layer}] ${result.record.title} (${result.record.id})`, { result });
        },
    }, { optional: true });
    api.registerTool({
        name: "ctx_edit_text",
        description: "Edit one existing ContextHub record by replacing text. Fails if match is ambiguous unless replaceAll=true.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                recordId: { type: "string", description: "Target record ID" },
                matchText: { type: "string", description: "Exact text to find" },
                replaceText: { type: "string", description: "Replacement text" },
                replaceAll: { type: "boolean", description: "Replace all matches" },
            },
            required: ["recordId", "matchText", "replaceText"],
        },
        async execute(_toolCallId, params) {
            const recordId = String(params.recordId ?? "").trim();
            const matchText = String(params.matchText ?? "");
            const replaceText = String(params.replaceText ?? "");
            if (!recordId || !matchText)
                throw new Error("recordId and matchText are required");
            const result = await client.editRecordText(recordId, {
                matchText,
                replaceText,
                replaceAll: Boolean(params.replaceAll),
            });
            const lines = [
                `edited [${result.record.layer}] ${result.record.title} (${result.record.id})`,
                `matched=${result.edit.matched} replaced=${result.edit.replaced} replaceAll=${Boolean(result.edit.replaceAll)}`,
            ];
            return content(lines.join("\n"), { result });
        },
    }, { optional: true });
    api.registerTool({
        name: "ctx_apply_patch",
        description: "Apply a unified patch text block to one ContextHub record.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                recordId: { type: "string", description: "Target record ID" },
                patch: { type: "string", description: "Unified patch content" },
            },
            required: ["recordId", "patch"],
        },
        async execute(_toolCallId, params) {
            const recordId = String(params.recordId ?? "").trim();
            const patch = String(params.patch ?? "");
            if (!recordId || !patch.trim())
                throw new Error("recordId and patch are required");
            const result = await client.applyRecordPatch(recordId, { patch });
            const lines = [
                `patched [${result.record.layer}] ${result.record.title} (${result.record.id})`,
                `hunks=${result.patch.hunks}`,
                ...(result.patch.applied ?? []).slice(0, 8).map((item) => `- hunk#${item.index} startLine=${item.startLine} -${item.removedLines} +${item.addedLines}`),
            ];
            return content(lines.join("\n"), { result });
        },
    }, { optional: true });
    api.registerTool({
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
        async execute(_toolCallId, params) {
            const layer = String(params.layer ?? "").toLowerCase();
            const filePath = String(params.filePath ?? "").trim();
            const partitionKey = String(params.partitionKey ?? config.defaultPartitionKey ?? "").trim();
            if (!partitionKey)
                throw new Error("partitionKey is required");
            if (!filePath)
                throw new Error("filePath is required");
            const result = await client.importResource(buildImportFilePayload({
                config,
                partitionKey,
                layer,
                filePath,
                titleOverride: String(params.title ?? "").trim() || undefined,
            }));
            return content(`imported [${result.record.layer}] ${result.record.title} (${result.record.id})`, { result });
        },
    }, { optional: true });
    api.registerTool({
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
        async execute(_toolCallId, params) {
            const presetName = String(params.presetName ?? "").trim();
            if (!presetName)
                throw new Error("presetName is required");
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
                lines.push(`${index + 1}. ${item.path} -> ${item.layer ?? "?"} (${item.derivationStatus ?? (result.dryRun ? "dry-run" : "unknown")})`);
            }
            return content(lines.join("\n"), { result });
        },
    }, { optional: true });
    api.registerTool({
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
        async execute(_toolCallId, params) {
            const jobId = String(params.jobId ?? "").trim();
            if (!jobId)
                throw new Error("jobId is required");
            const result = await client.getDerivationJob(jobId);
            const lines = [
                `job: ${result.id}`,
                `status: ${result.status}`,
                `mode: ${result.mode ?? "-"}${result.effectiveMode ? ` -> ${result.effectiveMode}` : ""}`,
                `sourceRecordId: ${result.sourceRecordId ?? "-"}`,
                `sourceRecordTitle: ${result.sourceRecordTitle ?? "-"}`,
                `error: ${result.errorMessage ?? "-"}`,
            ];
            return content(lines.join("\n"), { result });
        },
    });
    api.registerTool({
        name: "ctx_jobs",
        description: "List derivation jobs with queue/status filters for operator inspection.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                partitions: { type: "array", items: { type: "string" }, description: "Optional partition override" },
                statuses: { type: "array", items: { type: "string", enum: ["queued", "running", "completed", "failed"] }, description: "Optional status filter" },
                sourceRecordId: { type: "string", description: "Optional source record filter" },
                offset: { type: "number", description: "Optional offset" },
                limit: { type: "number", description: "Optional max jobs" },
            },
        },
        async execute(_toolCallId, params) {
            const result = await client.listDerivationJobs({
                tenantId: config.tenantId,
                partitions: normalizePartitions(params.partitions, config.recall.preAnswer.partitions),
                statuses: normalizeStringArray(params.statuses),
                sourceRecordId: typeof params.sourceRecordId === "string" ? params.sourceRecordId : undefined,
                offset: params.offset == null ? 0 : normalizeLimit(params.offset, 0),
                limit: normalizeLimit(params.limit, 20),
            });
            const lines = [
                ...summarizeScope(result.scope),
                `jobs: ${(result.items ?? []).length}`,
                `statusCounts: ${JSON.stringify(result.statusCounts ?? {})}`,
            ];
            for (const [index, item] of (result.items ?? []).slice(0, 8).entries()) {
                lines.push(`${index + 1}. ${item.id} ${item.status} (${item.partitionKey ?? "-"})`);
                lines.push(`   source=${item.sourceRecordTitle ?? item.sourceRecordId ?? "-"}`);
            }
            return content(lines.join("\n"), { result });
        },
    });
    api.registerTool({
        name: "ctx_redrive",
        description: "Redrive derivation jobs for retries with optional dry-run.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                partitions: { type: "array", items: { type: "string" }, description: "Optional partition override" },
                statuses: { type: "array", items: { type: "string", enum: ["queued", "running", "completed", "failed"] }, description: "Optional status filter" },
                jobIds: { type: "array", items: { type: "string" }, description: "Optional explicit job IDs" },
                dryRun: { type: "boolean", description: "Only preview selected jobs" },
                limit: { type: "number", description: "Max jobs to redrive" },
                reason: { type: "string", description: "Operator reason label" },
            },
        },
        async execute(_toolCallId, params) {
            const result = await client.redriveDerivationJobs({
                tenantId: config.tenantId,
                partitions: normalizePartitions(params.partitions, config.recall.preAnswer.partitions),
                statuses: normalizeStringArray(params.statuses),
                jobIds: normalizeStringArray(params.jobIds),
                dryRun: Boolean(params.dryRun),
                limit: normalizeLimit(params.limit, 20),
                reason: typeof params.reason === "string" ? params.reason : "agent_redrive",
            });
            const lines = [
                ...summarizeScope(result.scope),
                `redrive: ${JSON.stringify(result.redrive ?? {})}`,
                `jobs: ${(result.items ?? []).length}`,
            ];
            for (const [index, item] of (result.items ?? []).slice(0, 6).entries()) {
                lines.push(`${index + 1}. ${item.id} ${item.status}`);
            }
            return content(lines.join("\n"), { result });
        },
    });
    api.registerTool({
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
        async execute(_toolCallId, params) {
            const recordId = String(params.recordId ?? "").trim();
            if (!recordId)
                throw new Error("recordId is required");
            const result = await client.listRecordLinks(recordId);
            const lines = [`links: ${result.items.length}`];
            for (const [index, item] of result.items.slice(0, 8).entries()) {
                lines.push(`${index + 1}. ${item.relation} ${item.sourceRecordId} -> ${item.targetRecordId}`);
            }
            return content(lines.join("\n"), { result });
        },
    });
}
