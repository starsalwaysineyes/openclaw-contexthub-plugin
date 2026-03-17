import * as fs from "node:fs";
import { runImportPreset } from "./importer.js";
import { buildImportFilePayload, buildSaveTextPayload, buildUploadLastSessionPayload } from "./payloads.js";
function parseLayer(raw) {
    const normalized = raw.trim().toLowerCase();
    if (normalized !== "l0" && normalized !== "l1" && normalized !== "l2") {
        throw new Error(`invalid layer: ${raw}`);
    }
    return normalized;
}
function splitHead(input) {
    const trimmed = input.trim();
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex < 0)
        return { head: trimmed, rest: "" };
    return {
        head: trimmed.slice(0, spaceIndex),
        rest: trimmed.slice(spaceIndex + 1).trim(),
    };
}
function buildSyntheticRecordPath(recordId) {
    return `record:${recordId}`;
}
function pickSourcePath(item) {
    const source = item.source ?? {};
    for (const key of ["relativePath", "path"]) {
        const value = source[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return undefined;
}
function parseRecordLocator(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        throw new Error("record path is required");
    const hashIndex = trimmed.indexOf("#L");
    const basePath = hashIndex >= 0 ? trimmed.slice(0, hashIndex).trim() : trimmed;
    const hashLineRaw = hashIndex >= 0 ? Number(trimmed.slice(hashIndex + 2).trim()) : undefined;
    const hashLine = Number.isFinite(hashLineRaw) ? Math.max(1, Math.floor(Number(hashLineRaw))) : undefined;
    const recordId = basePath.startsWith("record:")
        ? basePath.slice("record:".length).trim()
        : basePath;
    if (!recordId)
        throw new Error("recordId is required");
    return {
        path: buildSyntheticRecordPath(recordId),
        recordId,
        hashLine,
    };
}
function parseSaveArgs(args, defaultPartitionKey) {
    const input = args?.trim() || "";
    const first = splitHead(input);
    const second = splitHead(first.rest);
    if (!first.head || !second.head || !second.rest) {
        throw new Error("usage: /contexthub-save <layer> <partitionKey|-> <title> :: <text>");
    }
    const layer = parseLayer(first.head);
    const partitionToken = second.head;
    const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
    if (!partitionKey)
        throw new Error("partitionKey is required (or configure defaultPartitionKey)");
    const marker = second.rest.indexOf("::");
    if (marker < 0)
        throw new Error("usage: /contexthub-save <layer> <partitionKey|-> <title> :: <text>");
    const title = second.rest.slice(0, marker).trim();
    const text = second.rest.slice(marker + 2).trim();
    if (!title || !text)
        throw new Error("title and text are required");
    return { layer, partitionKey, title, text };
}
function parseCommitArgs(args, defaultPartitionKey) {
    const input = args?.trim() || "";
    const first = splitHead(input);
    if (!first.head || !first.rest) {
        throw new Error("usage: /contexthub-commit <partitionKey|-> <summary> [:: memoryTitle :: memoryText]");
    }
    const partitionToken = first.head;
    const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
    if (!partitionKey)
        throw new Error("partitionKey is required (or configure defaultPartitionKey)");
    const segments = first.rest.split("::").map((item) => item.trim()).filter(Boolean);
    if (segments.length === 0)
        throw new Error("summary is required");
    return {
        partitionKey,
        summary: segments[0],
        memoryTitle: segments[1],
        memoryText: segments[2],
    };
}
function parseImportFileArgs(args, defaultPartitionKey) {
    const input = args?.trim() || "";
    const first = splitHead(input);
    const second = splitHead(first.rest);
    if (!first.head || !second.head || !second.rest) {
        throw new Error("usage: /contexthub-import-file <layer> <partitionKey|-> <filePath> [:: title]");
    }
    const layer = parseLayer(first.head);
    const partitionToken = second.head;
    const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
    if (!partitionKey)
        throw new Error("partitionKey is required (or configure defaultPartitionKey)");
    const fileAndTitle = second.rest;
    const marker = fileAndTitle.indexOf("::");
    const filePath = (marker >= 0 ? fileAndTitle.slice(0, marker) : fileAndTitle).trim();
    const titleOverride = marker >= 0 ? fileAndTitle.slice(marker + 2).trim() : undefined;
    if (!filePath)
        throw new Error("filePath is required");
    if (!fs.existsSync(filePath))
        throw new Error(`file not found: ${filePath}`);
    return { layer, partitionKey, filePath, titleOverride: titleOverride || undefined };
}
function parseImportPresetArgs(args) {
    const input = args?.trim() || "";
    if (!input)
        throw new Error("usage: /contexthub-import-preset <presetName> [limit] [--dry-run]");
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
function parseQueryArgs(args, defaults) {
    const rawInput = args?.trim() || "";
    if (!rawInput)
        throw new Error("usage: /contexthub-query <query> [:: partitions] [:: layers] [:: tags] [:: limit] [:: rerank] [--json]");
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input.split("::").map((item) => item.trim());
    const query = parts[0];
    if (!query)
        throw new Error("query is required");
    const partitions = parts[1]
        ? parts[1].split(",").map((item) => item.trim()).filter(Boolean)
        : defaults.partitions;
    const layers = parts[2]
        ? parts[2].split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)
        : defaults.layers;
    const tags = parts[3]
        ? parts[3].split(",").map((item) => item.trim()).filter(Boolean)
        : [];
    const limit = parts[4] ? Number(parts[4]) : defaults.limit;
    const rerank = parts[5]
        ? ["1", "true", "yes", "on", "rerank"].includes(parts[5].toLowerCase())
        : defaults.rerank;
    return { query, partitions, layers, tags, limit, rerank, json };
}
function parseUploadLastSessionArgs(args, defaultPartitionKey) {
    const input = args?.trim() || "";
    if (!input) {
        if (!defaultPartitionKey)
            throw new Error("usage: /contexthub-upload-last-session <partitionKey|-> [:: title]");
        return { partitionKey: defaultPartitionKey };
    }
    const parts = input.split("::").map((item) => item.trim());
    const partitionToken = parts[0];
    const partitionKey = partitionToken === "-" ? defaultPartitionKey : partitionToken;
    if (!partitionKey)
        throw new Error("partitionKey is required (or configure defaultPartitionKey)");
    return {
        partitionKey,
        titleOverride: parts[1] || undefined,
    };
}
function parseReadArgs(args) {
    const rawInput = args?.trim() || "";
    if (!rawInput)
        throw new Error("usage: /contexthub-read <recordId> [:: fromLine] [:: limit] [--json]");
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input.split("::").map((item) => item.trim());
    const recordId = parts[0];
    if (!recordId)
        throw new Error("recordId is required");
    return {
        recordId,
        fromLine: parts[1] ? Number(parts[1]) : 1,
        limit: parts[2] ? Number(parts[2]) : 80,
        json,
    };
}
function parseRuntimeReadArgs(args) {
    const rawInput = args?.trim() || "";
    if (!rawInput) {
        throw new Error("usage: /ctx mg <record:<recordId>|recordId[#LfromLine]> [:: fromLine] [:: limit] [--json]");
    }
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input.split("::").map((item) => item.trim());
    const locator = parseRecordLocator(parts[0] || "");
    return {
        path: locator.path,
        recordId: locator.recordId,
        fromLine: parts[1] ? Number(parts[1]) : (locator.hashLine ?? 1),
        limit: parts[2] ? Number(parts[2]) : 80,
        json,
    };
}
function parseEditArgs(args) {
    const rawInput = args?.trim() || "";
    if (!rawInput)
        throw new Error("usage: /contexthub-edit <recordId> :: <matchText> :: <replaceText> [:: replaceAll] [--json]");
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input.split("::").map((item) => item.trim());
    if (parts.length < 3) {
        throw new Error("usage: /contexthub-edit <recordId> :: <matchText> :: <replaceText> [:: replaceAll] [--json]");
    }
    const recordId = parts[0];
    const matchText = parts[1];
    const replaceText = parts[2];
    if (!recordId || !matchText)
        throw new Error("recordId and matchText are required");
    const replaceAll = parts[3]
        ? ["1", "true", "yes", "on", "all", "replace-all"].includes(parts[3].toLowerCase())
        : false;
    return { recordId, matchText, replaceText, replaceAll, json };
}
function parseApplyPatchArgs(args) {
    const rawInput = args?.trim() || "";
    if (!rawInput)
        throw new Error("usage: /contexthub-apply-patch <recordId> :: <patch> [--json]");
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const marker = input.indexOf("::");
    if (marker < 0)
        throw new Error("usage: /contexthub-apply-patch <recordId> :: <patch> [--json]");
    const recordId = input.slice(0, marker).trim();
    const patch = input.slice(marker + 2).trim();
    if (!recordId || !patch)
        throw new Error("recordId and patch are required");
    return { recordId, patch, json };
}
function parseTreeArgs(args, defaults) {
    const rawInput = args?.trim() || "";
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input ? input.split("::").map((item) => item.trim()) : [];
    return {
        partitions: parts[0] ? parts[0].split(",").map((item) => item.trim()).filter(Boolean) : defaults.partitions,
        layers: parts[1] ? parts[1].split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : defaults.layers,
        tags: parts[2] ? parts[2].split(",").map((item) => item.trim()).filter(Boolean) : [],
        pathPrefix: parts[3] || undefined,
        limit: parts[4] ? Number(parts[4]) : defaults.limit,
        json,
    };
}
function parseListArgs(args, defaults) {
    const rawInput = args?.trim() || "";
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input ? input.split("::").map((item) => item.trim()) : [];
    return {
        partitions: parts[0] ? parts[0].split(",").map((item) => item.trim()).filter(Boolean) : defaults.partitions,
        layers: parts[1] ? parts[1].split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : defaults.layers,
        tags: parts[2] ? parts[2].split(",").map((item) => item.trim()).filter(Boolean) : [],
        titleContains: parts[3] || undefined,
        sourcePathPrefix: parts[4] || undefined,
        limit: parts[5] ? Number(parts[5]) : defaults.limit,
        json,
    };
}
function parseJobListArgs(args, defaults) {
    const rawInput = args?.trim() || "";
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input ? input.split("::").map((item) => item.trim()) : [];
    return {
        partitions: parts[0] ? parts[0].split(",").map((item) => item.trim()).filter(Boolean) : defaults.partitions,
        statuses: parts[1] ? parts[1].split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : [],
        sourceRecordId: parts[2] || undefined,
        limit: parts[3] ? Number(parts[3]) : defaults.limit,
        offset: parts[4] ? Number(parts[4]) : 0,
        json,
    };
}
function parseJobRedriveArgs(args, defaults) {
    const rawInput = args?.trim() || "";
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input ? input.split("::").map((item) => item.trim()) : [];
    const dryRunToken = (parts[3] ?? "true").toLowerCase();
    const dryRun = ["1", "true", "yes", "on", "dry", "dry-run"].includes(dryRunToken);
    return {
        partitions: parts[0] ? parts[0].split(",").map((item) => item.trim()).filter(Boolean) : defaults.partitions,
        statuses: parts[1] ? parts[1].split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : ["failed"],
        jobIds: parts[2] ? parts[2].split(",").map((item) => item.trim()).filter(Boolean) : [],
        dryRun,
        limit: parts[4] ? Number(parts[4]) : defaults.limit,
        reason: parts[5] || "ctx_redrive",
        json,
    };
}
function parseGrepArgs(args, defaults) {
    const rawInput = args?.trim() || "";
    if (!rawInput)
        throw new Error("usage: /contexthub-grep <pattern> [:: partitions] [:: layers] [:: tags] [:: limit] [:: regex] [:: caseSensitive] [--json]");
    const json = /(?:^|\s)--json(?:\s|$)/.test(rawInput);
    const input = rawInput.replace(/(?:^|\s)--json(?:\s|$)/g, " ").trim();
    const parts = input.split("::").map((item) => item.trim());
    const pattern = parts[0];
    if (!pattern)
        throw new Error("pattern is required");
    return {
        pattern,
        partitions: parts[1] ? parts[1].split(",").map((item) => item.trim()).filter(Boolean) : defaults.partitions,
        layers: parts[2] ? parts[2].split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : defaults.layers,
        tags: parts[3] ? parts[3].split(",").map((item) => item.trim()).filter(Boolean) : [],
        limit: parts[4] ? Number(parts[4]) : defaults.limit,
        regex: parts[5] ? ["1", "true", "yes", "on", "regex"].includes(parts[5].toLowerCase()) : false,
        caseSensitive: parts[6] ? ["1", "true", "yes", "on", "case", "sensitive"].includes(parts[6].toLowerCase()) : false,
        json,
    };
}
function truncate(value, limit = 220) {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}...`;
}
function textReply(text, isError = false) {
    return { text, isError };
}
function formatScopeSummary(scope) {
    if (!scope)
        return null;
    const requestedPartitions = (scope.requestedPartitions ?? []).join(",") || "-";
    const effectivePartitions = (scope.effectivePartitions ?? []).join(",") || "-";
    const requestedLayers = (scope.requestedLayers ?? []).join(",") || "-";
    const requestedTags = (scope.requestedTags ?? []).join(",") || "-";
    const layerRules = scope.effectiveLayerRules
        ? Object.entries(scope.effectiveLayerRules)
            .map(([partition, layers]) => `${partition}:${layers.join(",")}`)
            .join(" ")
        : "-";
    return [
        `scope: auth=${scope.authKind ?? "?"} requestedPartitions=${requestedPartitions} effectivePartitions=${effectivePartitions}`,
        `filters: layers=${requestedLayers} tags=${requestedTags} layerRules=${layerRules}`,
    ].join("\n");
}
function formatQuerySummary(payload) {
    const items = payload.result.items ?? [];
    const retrieval = payload.result.retrieval ?? {};
    const grouped = new Map();
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
        formatScopeSummary(payload.result.scope) ?? `scope: partitions=${payload.query.partitions.join(",") || "(all readable)"} layers=${payload.query.layers.join(",")} tags=${payload.query.tags?.join(",") || "-"}`,
        `retrieval: uniqueRecords=${grouped.size} rawHits=${items.length} embeddings=${Boolean(retrieval.usedEmbeddings)} rerank=${Boolean(retrieval.usedRerank)} candidates=${retrieval.candidateCount ?? "?"}`,
    ];
    for (const [index, entry] of unique.entries()) {
        const item = entry.top;
        lines.push(`${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey}) score=${Number(item.score ?? 0).toFixed(3)} hits=${entry.hits}`);
        lines.push(`   ${truncate(String(item.snippet ?? ""), 180)}`);
    }
    return lines.join("\n");
}
function normalizeRuntimeSearchItems(items) {
    const deduped = new Map();
    for (const item of items) {
        const recordId = String(item.recordId ?? "");
        if (!recordId)
            continue;
        const existing = deduped.get(recordId);
        if (!existing || Number(item.score ?? 0) > Number(existing.score ?? 0)) {
            deduped.set(recordId, item);
        }
    }
    return [...deduped.values()]
        .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
        .map((item) => ({
        path: buildSyntheticRecordPath(String(item.recordId)),
        recordId: item.recordId,
        title: item.title,
        layer: item.layer,
        partitionKey: item.partitionKey,
        score: item.score,
        sourcePath: pickSourcePath(item),
        snippet: item.snippet,
        tags: item.tags ?? [],
    }));
}
function formatRuntimeSearchSummary(query, items) {
    const lines = [`query: ${query}`, `hits: ${items.length}`];
    for (const [index, item] of items.entries()) {
        lines.push(`${index + 1}. ${item.path} score=${Number(item.score ?? 0).toFixed(3)} [${item.layer}] ${item.title} (${item.partitionKey})`);
        if (item.sourcePath)
            lines.push(`   source=${item.sourcePath}`);
        lines.push(`   ${truncate(String(item.snippet ?? ""), 220)}`);
    }
    return lines.join("\n");
}
function formatRuntimeReadSummary(path, result) {
    const sourcePath = String(result.record?.source?.relativePath ?? result.record?.source?.path ?? "").trim();
    const endLine = result.returnedLines > 0 ? result.fromLine + result.returnedLines - 1 : result.fromLine;
    const lines = [
        `record: [${result.record.layer}] ${result.record.title} (${result.record.partitionKey})`,
        `path: ${path}`,
        ...(sourcePath ? [`source: ${sourcePath}`] : []),
        `range: ${result.fromLine}-${endLine} / ${result.totalLines}`,
        `hasMore: ${Boolean(result.hasMore)}`,
    ];
    for (const item of result.items ?? []) {
        lines.push(`${item.lineNumber}: ${item.text}`);
    }
    return lines.join("\n");
}
function formatSaveSummary(result) {
    return [
        `saved: [${result.record.layer}] ${result.record.title}`,
        `recordId: ${result.record.id}`,
        `partition: ${result.record.partitionKey}`,
        `derivation: ${result.derivation.status}`,
    ].join("\n");
}
function formatCommitSummary(result) {
    const created = Array.isArray(result.createdMemories) ? result.createdMemories.length : 0;
    return [
        `committed session: ${result.session.id}`,
        `partition: ${result.session.partitionKey}`,
        `summary: ${truncate(String(result.session.summary ?? ""), 120)}`,
        `createdMemories: ${created}`,
    ].join("\n");
}
function formatImportFileSummary(result) {
    return [
        `imported file: [${result.record.layer}] ${result.record.title}`,
        `recordId: ${result.record.id}`,
        `partition: ${result.record.partitionKey}`,
        `derivation: ${result.derivation.status}`,
    ].join("\n");
}
function formatTreeSummary(result) {
    const items = result.items ?? [];
    const summary = result.summary ?? {};
    const lines = [`path: ${result.pathPrefix || "/"}`];
    const scopeSummary = formatScopeSummary(result.scope);
    if (scopeSummary)
        lines.push(scopeSummary);
    lines.push(`nodes: ${items.length}`, `matchedRecords: ${summary.totalMatchedRecords ?? 0}`);
    for (const [index, item] of items.slice(0, 10).entries()) {
        lines.push(`${index + 1}. ${item.kind === "dir" ? "[dir]" : "[file]"} ${item.path} records=${item.recordCount}`);
    }
    return lines.join("\n");
}
function formatListSummary(result) {
    const items = result.items ?? [];
    const page = result.page ?? {};
    const lines = [];
    const scopeSummary = formatScopeSummary(result.scope);
    if (scopeSummary)
        lines.push(scopeSummary);
    lines.push(`records: ${items.length}`, `hasMore: ${Boolean(page.hasMore)}`, `totalMatched: ${page.totalMatched ?? items.length}`);
    for (const [index, item] of items.slice(0, 8).entries()) {
        const sourcePath = String(item.source?.relativePath ?? item.source?.path ?? "-");
        lines.push(`${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey})`);
        lines.push(`   id=${item.id} lines=${item.lineCount} source=${sourcePath}`);
    }
    return lines.join("\n");
}
function formatReadSummary(result) {
    const lines = [
        `read: [${result.record.layer}] ${result.record.title}`,
        `recordId: ${result.record.id}`,
        `range: ${result.fromLine}-${result.fromLine + result.returnedLines - 1} / ${result.totalLines}`,
        `hasMore: ${Boolean(result.hasMore)}`,
    ];
    for (const item of result.items ?? []) {
        lines.push(`${item.lineNumber}: ${item.text}`);
    }
    return lines.join("\n");
}
function formatEditSummary(result) {
    return [
        `edited: [${result.record.layer}] ${result.record.title}`,
        `recordId: ${result.record.id}`,
        `partition: ${result.record.partitionKey}`,
        `matched: ${result.edit?.matched ?? 0}`,
        `replaced: ${result.edit?.replaced ?? 0}`,
        `replaceAll: ${Boolean(result.edit?.replaceAll)}`,
    ].join("\n");
}
function formatApplyPatchSummary(result) {
    const applied = Array.isArray(result.patch?.applied) ? result.patch.applied : [];
    const lines = [
        `patched: [${result.record.layer}] ${result.record.title}`,
        `recordId: ${result.record.id}`,
        `partition: ${result.record.partitionKey}`,
        `hunks: ${result.patch?.hunks ?? applied.length}`,
    ];
    for (const item of applied.slice(0, 8)) {
        lines.push(`- hunk#${item.index} startLine=${item.startLine} -${item.removedLines} +${item.addedLines}`);
    }
    return lines.join("\n");
}
function formatGrepSummary(result) {
    const search = result.search ?? {};
    const lines = [
        `grep: pattern=${search.pattern ?? ""} regex=${Boolean(search.regex)} caseSensitive=${Boolean(search.caseSensitive)}`,
    ];
    const scopeSummary = formatScopeSummary(result.scope);
    if (scopeSummary)
        lines.push(scopeSummary);
    lines.push(`scope: scannedRecords=${search.scannedRecords ?? 0} matchedRecords=${search.matchedRecords ?? 0} returnedMatches=${search.returnedMatches ?? 0}`);
    for (const [index, item] of (result.items ?? []).slice(0, 8).entries()) {
        lines.push(`${index + 1}. [${item.layer}] ${item.title} (${item.partitionKey}) line ${item.lineNumber}`);
        lines.push(`   ${truncate(String(item.text ?? ""), 180)}`);
    }
    return lines.join("\n");
}
function formatImportPresetSummary(result) {
    const rows = (result.results ?? []).slice(0, 5).map((item, index) => `${index + 1}. ${item.path} -> ${item.layer ?? "?"} (${item.derivationStatus ?? (result.dryRun ? "dry-run" : "unknown")})`);
    return [
        `preset: ${result.preset}`,
        `rootPath: ${result.rootPath}`,
        `count: ${result.count}`,
        `dryRun: ${Boolean(result.dryRun)}`,
        ...rows,
    ].join("\n");
}
function formatJobSummary(job) {
    return [
        `job: ${job.id}`,
        `status: ${job.status}`,
        `mode: ${job.mode}${job.effectiveMode ? ` -> ${job.effectiveMode}` : ""}`,
        `sourceRecordId: ${job.sourceRecordId ?? "-"}`,
        `sourceRecordTitle: ${job.sourceRecordTitle ?? "-"}`,
        `error: ${job.errorMessage ?? "-"}`,
    ].join("\n");
}
function formatJobListSummary(result) {
    const items = result.items ?? [];
    const lines = [
        formatScopeSummary(result.scope) ?? "scope: -",
        `jobs: ${items.length}`,
        `page: offset=${result.page?.offset ?? 0} limit=${result.page?.limit ?? "?"} total=${result.page?.totalMatched ?? "?"}`,
        `statusCounts: ${JSON.stringify(result.statusCounts ?? {})}`,
    ];
    for (const [index, item] of items.slice(0, 8).entries()) {
        lines.push(`${index + 1}. ${item.id} ${item.status} (${item.partitionKey ?? "-"})`);
        lines.push(`   source=${item.sourceRecordTitle ?? item.sourceRecordId ?? "-"}`);
    }
    return lines.join("\n");
}
function formatRedriveSummary(result) {
    const items = result.items ?? [];
    const lines = [
        formatScopeSummary(result.scope) ?? "scope: -",
        `redrive: ${JSON.stringify(result.redrive ?? {})}`,
        `jobs: ${items.length}`,
    ];
    for (const [index, item] of items.slice(0, 6).entries()) {
        lines.push(`${index + 1}. ${item.id} ${item.status}`);
    }
    return lines.join("\n");
}
function formatLinksSummary(payload) {
    const items = payload.items ?? [];
    const lines = [`links: ${items.length}`];
    for (const [index, item] of items.slice(0, 8).entries()) {
        lines.push(`${index + 1}. ${item.relation} ${item.sourceRecordId} -> ${item.targetRecordId}`);
    }
    return lines.join("\n");
}
function formatCtxHelp() {
    return [
        "ctx commands:",
        "- /ctx q <query> [:: partitions] [:: layers] [:: tags] [:: limit] [:: rerank] [--json]",
        "- /ctx ms <query> [:: partitions] [:: layers] [:: tags] [:: limit] [:: rerank] [--json]",
        "- /ctx g <pattern> [:: partitions] [:: layers] [:: tags] [:: limit] [:: regex] [:: caseSensitive] [--json]",
        "- /ctx t [:: partitions] [:: layers] [:: tags] [:: pathPrefix] [:: limit] [--json]",
        "- /ctx ls [:: partitions] [:: layers] [:: tags] [:: titleContains] [:: sourcePathPrefix] [:: limit] [--json]",
        "- /ctx r <recordId> [:: fromLine] [:: limit] [--json]",
        "- /ctx mg <record:<recordId>|recordId[#LfromLine]> [:: fromLine] [:: limit] [--json]",
        "- /ctx e <recordId> :: <matchText> :: <replaceText> [:: replaceAll] [--json]",
        "- /ctx ap <recordId> :: <patch> [--json]",
        "- /ctx p",
        "- /ctx s <layer> <partitionKey|-> <title> :: <text>",
        "- /ctx c <partitionKey|-> <summary> [:: memoryTitle :: memoryText]",
        "- /ctx f <layer> <partitionKey|-> <filePath> [:: title]",
        "- /ctx ip <presetName> [limit] [--dry-run]",
        "- /ctx j <jobId>",
        "- /ctx jl [:: partitions] [:: statuses] [:: sourceRecordId] [:: limit] [:: offset] [--json]",
        "- /ctx jr [:: partitions] [:: statuses] [:: jobIds] [:: dryRun] [:: limit] [:: reason] [--json]",
        "- /ctx l <recordId>",
        "- /ctx last",
        "- /ctx up <partitionKey|-> [:: title]",
    ].join("\n");
}
export function registerPluginCommands(params) {
    const { api, config, client, state } = params;
    api.registerCommand({
        name: "ctx",
        description: "Short ContextHub command router",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const raw = ctx.args?.trim() || "";
                if (!raw)
                    return textReply(formatCtxHelp());
                const { head: subcommand, rest } = splitHead(raw);
                switch (subcommand.toLowerCase()) {
                    case "q": {
                        const parsed = parseQueryArgs(rest, {
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
                            tags: parsed.tags,
                            limit: parsed.limit,
                            rerank: parsed.rerank,
                        });
                        return textReply(parsed.json ? JSON.stringify({ query: parsed, result }, null, 2) : formatQuerySummary({ query: parsed, result }));
                    }
                    case "ms": {
                        const parsed = parseQueryArgs(rest, {
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
                            tags: parsed.tags,
                            limit: parsed.limit,
                            rerank: parsed.rerank,
                        });
                        const memorySearch = {
                            results: normalizeRuntimeSearchItems(result.items ?? []),
                            scope: result.scope,
                            retrieval: result.retrieval,
                        };
                        return textReply(parsed.json
                            ? JSON.stringify({ query: parsed, result, memorySearch }, null, 2)
                            : formatRuntimeSearchSummary(parsed.query, memorySearch.results));
                    }
                    case "g": {
                        const parsed = parseGrepArgs(rest, {
                            partitions: config.recall.preAnswer.partitions,
                            layers: ["l0", "l1", "l2"],
                            limit: 20,
                        });
                        const result = await client.grep({
                            tenantId: config.tenantId,
                            pattern: parsed.pattern,
                            partitions: parsed.partitions,
                            layers: parsed.layers,
                            tags: parsed.tags,
                            limit: parsed.limit,
                            regex: parsed.regex,
                            caseSensitive: parsed.caseSensitive,
                        });
                        return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatGrepSummary(result));
                    }
                    case "t": {
                        const parsed = parseTreeArgs(rest, {
                            partitions: config.recall.preAnswer.partitions,
                            layers: ["l0", "l1", "l2"],
                            limit: 50,
                        });
                        const result = await client.browseRecordTree({
                            tenantId: config.tenantId,
                            partitions: parsed.partitions,
                            layers: parsed.layers,
                            tags: parsed.tags,
                            pathPrefix: parsed.pathPrefix,
                            limit: parsed.limit,
                        });
                        return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatTreeSummary(result));
                    }
                    case "ls": {
                        const parsed = parseListArgs(rest, {
                            partitions: config.recall.preAnswer.partitions,
                            layers: ["l0", "l1", "l2"],
                            limit: 20,
                        });
                        const result = await client.listRecords({
                            tenantId: config.tenantId,
                            partitions: parsed.partitions,
                            layers: parsed.layers,
                            tags: parsed.tags,
                            titleContains: parsed.titleContains,
                            sourcePathPrefix: parsed.sourcePathPrefix,
                            limit: parsed.limit,
                            offset: 0,
                        });
                        return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatListSummary(result));
                    }
                    case "r": {
                        const parsed = parseReadArgs(rest);
                        const result = await client.readRecordLines(parsed.recordId, parsed.fromLine, parsed.limit);
                        return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatReadSummary(result));
                    }
                    case "mg": {
                        const parsed = parseRuntimeReadArgs(rest);
                        const result = await client.readRecordLines(parsed.recordId, parsed.fromLine, parsed.limit);
                        return textReply(parsed.json ? JSON.stringify({ path: parsed.path, result }, null, 2) : formatRuntimeReadSummary(parsed.path, result));
                    }
                    case "e": {
                        const parsed = parseEditArgs(rest);
                        const result = await client.editRecordText(parsed.recordId, {
                            matchText: parsed.matchText,
                            replaceText: parsed.replaceText,
                            replaceAll: parsed.replaceAll,
                        });
                        return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatEditSummary(result));
                    }
                    case "ap": {
                        const parsed = parseApplyPatchArgs(rest);
                        const result = await client.applyRecordPatch(parsed.recordId, { patch: parsed.patch });
                        return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatApplyPatchSummary(result));
                    }
                    case "p":
                        return textReply((() => {
                            const presetNames = Object.keys(config.importPresets);
                            if (presetNames.length === 0)
                                return "importPresets: none configured";
                            const lines = ["importPresets:"];
                            for (const name of presetNames) {
                                const preset = config.importPresets[name];
                                const pathPrefix = preset.relativePathPrefix ? ` path=${preset.relativePathPrefix}` : "";
                                lines.push(`- ${name}: ${preset.rootPath} -> ${preset.partitionKey}/${preset.layer}${pathPrefix}`);
                            }
                            return lines.join("\n");
                        })());
                    case "s": {
                        const parsed = parseSaveArgs(rest, config.defaultPartitionKey);
                        const result = await client.importResource(buildSaveTextPayload({
                            config,
                            partitionKey: parsed.partitionKey,
                            layer: parsed.layer,
                            title: parsed.title,
                            text: parsed.text,
                        }));
                        return textReply(formatSaveSummary({ record: result.record, derivation: result.derivation }));
                    }
                    case "c": {
                        const parsed = parseCommitArgs(rest, config.defaultPartitionKey);
                        const payload = {
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
                            metadata: { adapter: "openclaw-contexthub-plugin", command: "ctx.c" },
                        };
                        const result = await client.commitSession(payload);
                        return textReply(formatCommitSummary(result));
                    }
                    case "f": {
                        const parsed = parseImportFileArgs(rest, config.defaultPartitionKey);
                        const result = await client.importResource(buildImportFilePayload({
                            config,
                            partitionKey: parsed.partitionKey,
                            layer: parsed.layer,
                            filePath: parsed.filePath,
                            titleOverride: parsed.titleOverride,
                        }));
                        return textReply(formatImportFileSummary({ record: result.record, derivation: result.derivation }));
                    }
                    case "ip": {
                        const parsed = parseImportPresetArgs(rest);
                        const result = await runImportPreset({
                            client,
                            config,
                            presetName: parsed.presetName,
                            overrideLimit: parsed.limit,
                            dryRun: parsed.dryRun,
                        });
                        return textReply(formatImportPresetSummary(result));
                    }
                    case "j": {
                        const jobId = rest.trim();
                        if (!jobId)
                            throw new Error("usage: /ctx j <jobId>");
                        const job = await client.getDerivationJob(jobId);
                        return textReply(formatJobSummary(job));
                    }
                    case "jl": {
                        const parsed = parseJobListArgs(rest, {
                            partitions: config.recall.preAnswer.partitions,
                            limit: 20,
                        });
                        const result = await client.listDerivationJobs({
                            tenantId: config.tenantId,
                            partitions: parsed.partitions,
                            statuses: parsed.statuses,
                            sourceRecordId: parsed.sourceRecordId,
                            limit: parsed.limit,
                            offset: parsed.offset,
                        });
                        return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatJobListSummary(result));
                    }
                    case "jr": {
                        const parsed = parseJobRedriveArgs(rest, {
                            partitions: config.recall.preAnswer.partitions,
                            limit: 20,
                        });
                        const result = await client.redriveDerivationJobs({
                            tenantId: config.tenantId,
                            partitions: parsed.partitions,
                            statuses: parsed.statuses,
                            jobIds: parsed.jobIds,
                            dryRun: parsed.dryRun,
                            limit: parsed.limit,
                            reason: parsed.reason,
                        });
                        return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatRedriveSummary(result));
                    }
                    case "l": {
                        const recordId = rest.trim();
                        if (!recordId)
                            throw new Error("usage: /ctx l <recordId>");
                        const links = await client.listRecordLinks(recordId);
                        return textReply(formatLinksSummary(links));
                    }
                    case "last": {
                        if (!state.lastSessionCapture)
                            return textReply("no cached session available", true);
                        const capture = state.lastSessionCapture;
                        return textReply([
                            `capturedAt: ${capture.capturedAt}`,
                            `success: ${capture.success}`,
                            `durationMs: ${capture.durationMs ?? 0}`,
                            `messageCount: ${capture.messageCount}`,
                            `title: ${capture.title}`,
                            `idempotencyKey: ${capture.idempotencyKey}`,
                        ].join("\n"));
                    }
                    case "up": {
                        const capture = state.lastSessionCapture;
                        if (!capture)
                            throw new Error("no cached session available; wait until a session completes first");
                        const parsed = parseUploadLastSessionArgs(rest, config.defaultPartitionKey);
                        const result = await client.importResource(buildUploadLastSessionPayload({
                            config,
                            partitionKey: parsed.partitionKey,
                            capture,
                            titleOverride: parsed.titleOverride,
                        }));
                        return textReply(formatImportFileSummary({ record: result.record, derivation: result.derivation }));
                    }
                    case "help":
                    default:
                        return textReply(formatCtxHelp(), subcommand.toLowerCase() !== "help");
                }
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
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
        description: "Query ContextHub explicitly: /contexthub-query <query> [:: partitions] [:: layers] [:: tags] [:: limit] [:: rerank]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
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
                    tags: parsed.tags,
                    limit: parsed.limit,
                    rerank: parsed.rerank,
                });
                if (parsed.json) {
                    return textReply(JSON.stringify({ query: parsed, result }, null, 2));
                }
                return textReply(formatQuerySummary({ query: parsed, result }));
            }
            catch (error) {
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
            if (presetNames.length === 0)
                return textReply("importPresets: none configured");
            const lines = ["importPresets:"];
            for (const name of presetNames) {
                const preset = config.importPresets[name];
                const pathPrefix = preset.relativePathPrefix ? ` path=${preset.relativePathPrefix}` : "";
                lines.push(`- ${name}: ${preset.rootPath} -> ${preset.partitionKey}/${preset.layer}${pathPrefix}`);
            }
            return textReply(lines.join("\n"));
        },
    });
    api.registerCommand({
        name: "contexthub-read",
        description: "Read one record as numbered lines: /contexthub-read <recordId> [:: fromLine] [:: limit] [--json]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseReadArgs(ctx.args);
                const result = await client.readRecordLines(parsed.recordId, parsed.fromLine, parsed.limit);
                if (parsed.json)
                    return textReply(JSON.stringify(result, null, 2));
                return textReply(formatReadSummary(result));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-edit",
        description: "Replace text in one record: /contexthub-edit <recordId> :: <matchText> :: <replaceText> [:: replaceAll] [--json]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseEditArgs(ctx.args);
                const result = await client.editRecordText(parsed.recordId, {
                    matchText: parsed.matchText,
                    replaceText: parsed.replaceText,
                    replaceAll: parsed.replaceAll,
                });
                if (parsed.json)
                    return textReply(JSON.stringify(result, null, 2));
                return textReply(formatEditSummary(result));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-apply-patch",
        description: "Apply unified patch text to one record: /contexthub-apply-patch <recordId> :: <patch> [--json]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseApplyPatchArgs(ctx.args);
                const result = await client.applyRecordPatch(parsed.recordId, { patch: parsed.patch });
                if (parsed.json)
                    return textReply(JSON.stringify(result, null, 2));
                return textReply(formatApplyPatchSummary(result));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-grep",
        description: "Search record text with line numbers: /contexthub-grep <pattern> [:: partitions] [:: layers] [:: tags] [:: limit] [:: regex] [:: caseSensitive] [--json]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseGrepArgs(ctx.args, {
                    partitions: config.recall.preAnswer.partitions,
                    layers: ["l0", "l1", "l2"],
                    limit: 20,
                });
                const result = await client.grep({
                    tenantId: config.tenantId,
                    pattern: parsed.pattern,
                    partitions: parsed.partitions,
                    layers: parsed.layers,
                    tags: parsed.tags,
                    limit: parsed.limit,
                    regex: parsed.regex,
                    caseSensitive: parsed.caseSensitive,
                });
                if (parsed.json)
                    return textReply(JSON.stringify(result, null, 2));
                return textReply(formatGrepSummary(result));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-last-session",
        description: "Show cached last completed OpenClaw session capture",
        acceptsArgs: false,
        requireAuth: true,
        handler: async () => {
            if (!state.lastSessionCapture)
                return textReply("no cached session available", true);
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
        handler: async (ctx) => {
            try {
                const capture = state.lastSessionCapture;
                if (!capture)
                    throw new Error("no cached session available; wait until a session completes first");
                const parsed = parseUploadLastSessionArgs(ctx.args, config.defaultPartitionKey);
                const result = await client.importResource(buildUploadLastSessionPayload({
                    config,
                    partitionKey: parsed.partitionKey,
                    capture,
                    titleOverride: parsed.titleOverride,
                }));
                return textReply(formatImportFileSummary({ record: result.record, derivation: result.derivation }));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-save",
        description: "Save text directly to ContextHub: /contexthub-save <layer> <partitionKey|-> <title> :: <text>",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseSaveArgs(ctx.args, config.defaultPartitionKey);
                const result = await client.importResource(buildSaveTextPayload({
                    config,
                    partitionKey: parsed.partitionKey,
                    layer: parsed.layer,
                    title: parsed.title,
                    text: parsed.text,
                }));
                return textReply(formatSaveSummary({ record: result.record, derivation: result.derivation }));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-commit",
        description: "Commit a curated session summary: /contexthub-commit <partitionKey|-> <summary> [:: memoryTitle :: memoryText]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseCommitArgs(ctx.args, config.defaultPartitionKey);
                const payload = {
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
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-import-file",
        description: "Import one local file: /contexthub-import-file <layer> <partitionKey|-> <filePath> [:: title]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseImportFileArgs(ctx.args, config.defaultPartitionKey);
                const result = await client.importResource(buildImportFilePayload({
                    config,
                    partitionKey: parsed.partitionKey,
                    layer: parsed.layer,
                    filePath: parsed.filePath,
                    titleOverride: parsed.titleOverride,
                }));
                return textReply(formatImportFileSummary({ record: result.record, derivation: result.derivation }));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-import-preset",
        description: "Import a configured local batch: /contexthub-import-preset <presetName> [limit] [--dry-run]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
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
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-job",
        description: "Inspect one derivation job: /contexthub-job <jobId>",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const jobId = ctx.args?.trim();
                if (!jobId)
                    throw new Error("usage: /contexthub-job <jobId>");
                const job = await client.getDerivationJob(jobId);
                return textReply(formatJobSummary(job));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-jobs",
        description: "List derivation jobs: /contexthub-jobs [:: partitions] [:: statuses] [:: sourceRecordId] [:: limit] [:: offset] [--json]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseJobListArgs(ctx.args, {
                    partitions: config.recall.preAnswer.partitions,
                    limit: 20,
                });
                const result = await client.listDerivationJobs({
                    tenantId: config.tenantId,
                    partitions: parsed.partitions,
                    statuses: parsed.statuses,
                    sourceRecordId: parsed.sourceRecordId,
                    limit: parsed.limit,
                    offset: parsed.offset,
                });
                return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatJobListSummary(result));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-redrive",
        description: "Redrive derivation jobs: /contexthub-redrive [:: partitions] [:: statuses] [:: jobIds] [:: dryRun] [:: limit] [:: reason] [--json]",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const parsed = parseJobRedriveArgs(ctx.args, {
                    partitions: config.recall.preAnswer.partitions,
                    limit: 20,
                });
                const result = await client.redriveDerivationJobs({
                    tenantId: config.tenantId,
                    partitions: parsed.partitions,
                    statuses: parsed.statuses,
                    jobIds: parsed.jobIds,
                    dryRun: parsed.dryRun,
                    limit: parsed.limit,
                    reason: parsed.reason,
                });
                return textReply(parsed.json ? JSON.stringify(result, null, 2) : formatRedriveSummary(result));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
    api.registerCommand({
        name: "contexthub-links",
        description: "Inspect record links: /contexthub-links <recordId>",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
            try {
                const recordId = ctx.args?.trim();
                if (!recordId)
                    throw new Error("usage: /contexthub-links <recordId>");
                const links = await client.listRecordLinks(recordId);
                return textReply(formatLinksSummary(links));
            }
            catch (error) {
                return textReply(String(error), true);
            }
        },
    });
}
