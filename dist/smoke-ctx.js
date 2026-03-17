import plugin from "./index.js";
function parseArg(name) {
    const prefix = `--${name}=`;
    const exact = `--${name}`;
    const argv = process.argv.slice(2);
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value.startsWith(prefix))
            return value.slice(prefix.length);
        if (value === exact)
            return argv[index + 1];
    }
    return undefined;
}
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
function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function firstLines(text, count) {
    if (!text)
        return [];
    return text.split("\n").slice(0, count);
}
function expectText(reply, label) {
    const text = reply?.text;
    if (!text)
        throw new Error(`${label} returned no text`);
    if (reply?.isError)
        throw new Error(`${label} returned error: ${text}`);
    return text;
}
function parseJson(text, label) {
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new Error(`${label} returned non-JSON text: ${String(error)}`);
    }
}
function buildCommandContext(args, commandBody) {
    return {
        senderId: "ctx-smoke",
        channel: "cli-smoke",
        channelId: "cli-smoke",
        isAuthorizedSender: true,
        args,
        commandBody,
        config: {},
        from: "ctx-smoke",
        to: "ctx-smoke",
        accountId: "ctx-smoke",
    };
}
async function main() {
    const commands = new Map();
    const hooks = [];
    const pluginConfig = {
        baseUrl: parseArg("base-url") ?? process.env.CONTEXT_HUB_BASE_URL ?? "http://127.0.0.1:4040",
        token: parseArg("token") ?? process.env.CONTEXT_HUB_TOKEN,
        tenantId: parseArg("tenant-id") ?? process.env.CONTEXT_HUB_TENANT_ID ?? "",
        defaultPartitionKey: parseArg("default-partition") ?? process.env.CONTEXT_HUB_DEFAULT_PARTITION ?? "memory",
        recall: {
            preAnswer: {
                enabled: true,
                partitions: parseCsv(parseArg("partitions") ?? process.env.CONTEXT_HUB_PARTITIONS, ["memory"]),
                layers: parseCsv(parseArg("layers") ?? process.env.CONTEXT_HUB_RECALL_LAYERS, ["l0"]),
                limit: parseNumber(parseArg("limit") ?? process.env.CONTEXT_HUB_RECALL_LIMIT, 5),
                rerank: parseBool(parseArg("rerank") ?? process.env.CONTEXT_HUB_RECALL_RERANK, true),
            },
        },
        importPresets: {},
    };
    const api = {
        pluginConfig,
        logger: {
            info: (...args) => console.error("[info]", ...args),
            warn: (...args) => console.error("[warn]", ...args),
            error: (...args) => console.error("[error]", ...args),
        },
        on(hookName) {
            hooks.push(hookName);
        },
        registerCommand(command) {
            commands.set(command.name, command);
        },
        registerTool() {
            return undefined;
        },
    };
    plugin.register(api);
    const ctxCommand = commands.get("ctx");
    const directQueryCommand = commands.get("contexthub-query");
    const recallCommand = commands.get("contexthub-recall");
    const editCommand = commands.get("contexthub-edit");
    const applyPatchCommand = commands.get("contexthub-apply-patch");
    if (!ctxCommand || !directQueryCommand || !recallCommand || !editCommand || !applyPatchCommand) {
        throw new Error(`missing expected commands: ${Array.from(commands.keys()).sort().join(", ")}`);
    }
    const query = parseArg("query") ??
        "What is the current status of local OpenClaw -> cloud ContextHub cutover and plugins.slots.memory integration?";
    const readLines = parseNumber(parseArg("lines"), 12);
    const partitionsCsv = pluginConfig.recall.preAnswer.partitions.join(",");
    const layersCsv = pluginConfig.recall.preAnswer.layers.join(",");
    const limit = pluginConfig.recall.preAnswer.limit;
    const rerank = pluginConfig.recall.preAnswer.rerank ? "true" : "false";
    const helpText = expectText(await ctxCommand.handler(buildCommandContext(undefined, "/ctx")), "ctx help");
    const recallText = expectText(await recallCommand.handler(buildCommandContext(undefined, "/contexthub-recall")), "contexthub-recall");
    const sharedQueryArgs = `${query} :: ${partitionsCsv} :: ${layersCsv} :: :: ${limit} :: ${rerank} --json`;
    const ctxQueryText = expectText(await ctxCommand.handler(buildCommandContext(`q ${sharedQueryArgs}`, `/ctx q ${sharedQueryArgs}`)), "ctx query");
    const ctxMemorySearchText = expectText(await ctxCommand.handler(buildCommandContext(`ms ${sharedQueryArgs}`, `/ctx ms ${sharedQueryArgs}`)), "ctx memory search");
    const directQueryText = expectText(await directQueryCommand.handler(buildCommandContext(sharedQueryArgs, `/contexthub-query ${sharedQueryArgs}`)), "contexthub-query");
    const ctxQueryPayload = parseJson(ctxQueryText, "ctx query");
    const ctxMemorySearchPayload = parseJson(ctxMemorySearchText, "ctx memory search");
    const directQueryPayload = parseJson(directQueryText, "contexthub-query");
    const ctxFirstHit = (ctxQueryPayload.result?.items ?? [])[0] ?? {};
    const ctxMemoryFirstHit = (ctxMemorySearchPayload.memorySearch?.results ?? [])[0] ?? {};
    const directFirstHit = (directQueryPayload.result?.items ?? [])[0] ?? {};
    const recordId = String(ctxFirstHit.recordId ?? "");
    if (!recordId)
        throw new Error("ctx query returned no recordId in the first hit");
    const ctxReadArgs = `r ${recordId} :: 1 :: ${readLines} --json`;
    const ctxReadText = expectText(await ctxCommand.handler(buildCommandContext(ctxReadArgs, `/ctx ${ctxReadArgs}`)), "ctx read");
    const ctxReadPayload = parseJson(ctxReadText, "ctx read");
    const ctxMemoryGetArgs = `mg record:${recordId} :: 1 :: ${readLines} --json`;
    const ctxMemoryGetText = expectText(await ctxCommand.handler(buildCommandContext(ctxMemoryGetArgs, `/ctx ${ctxMemoryGetArgs}`)), "ctx memory get");
    const ctxMemoryGetPayload = parseJson(ctxMemoryGetText, "ctx memory get");
    const ctxMemoryGetResult = ctxMemoryGetPayload.result ?? {};
    const summary = {
        registeredCommands: Array.from(commands.keys()).sort(),
        observedHooks: hooks.sort(),
        config: {
            baseUrl: pluginConfig.baseUrl,
            tenantId: pluginConfig.tenantId,
            defaultPartitionKey: pluginConfig.defaultPartitionKey,
            partitions: pluginConfig.recall.preAnswer.partitions,
            layers: pluginConfig.recall.preAnswer.layers,
            limit,
            rerank: pluginConfig.recall.preAnswer.rerank,
        },
        query,
        helpPreview: firstLines(helpText, 12),
        helpIncludesRuntimeAliases: helpText.includes("/ctx ms") && helpText.includes("/ctx mg"),
        helpIncludesEditCommands: helpText.includes("/ctx e") && helpText.includes("/ctx ap"),
        recallConfig: parseJson(recallText, "contexthub-recall"),
        ctxQuery: {
            hitCount: ctxQueryPayload.result?.items?.length ?? 0,
            firstHit: {
                recordId: ctxFirstHit.recordId ?? null,
                title: ctxFirstHit.title ?? null,
                partitionKey: ctxFirstHit.partitionKey ?? null,
                layer: ctxFirstHit.layer ?? null,
                score: ctxFirstHit.score ?? null,
            },
            scope: ctxQueryPayload.result?.scope ?? null,
            retrieval: ctxQueryPayload.result?.retrieval ?? null,
        },
        ctxMemorySearch: {
            hitCount: ctxMemorySearchPayload.memorySearch?.results?.length ?? 0,
            firstHit: {
                path: ctxMemoryFirstHit.path ?? null,
                recordId: ctxMemoryFirstHit.recordId ?? null,
                title: ctxMemoryFirstHit.title ?? null,
                partitionKey: ctxMemoryFirstHit.partitionKey ?? null,
                layer: ctxMemoryFirstHit.layer ?? null,
                score: ctxMemoryFirstHit.score ?? null,
            },
            scope: ctxMemorySearchPayload.memorySearch?.scope ?? null,
            retrieval: ctxMemorySearchPayload.memorySearch?.retrieval ?? null,
        },
        directQuery: {
            hitCount: directQueryPayload.result?.items?.length ?? 0,
            firstHit: {
                recordId: directFirstHit.recordId ?? null,
                title: directFirstHit.title ?? null,
                partitionKey: directFirstHit.partitionKey ?? null,
                layer: directFirstHit.layer ?? null,
                score: directFirstHit.score ?? null,
            },
        },
        routerParity: {
            sameFirstRecordId: String(ctxFirstHit.recordId ?? "") === String(directFirstHit.recordId ?? ""),
            sameFirstTitle: String(ctxFirstHit.title ?? "") === String(directFirstHit.title ?? ""),
        },
        runtimeAliasParity: {
            sameFirstRecordIdAsCtxQuery: String(ctxMemoryFirstHit.recordId ?? "") === String(ctxFirstHit.recordId ?? ""),
            sameFirstRecordIdAsDirectQuery: String(ctxMemoryFirstHit.recordId ?? "") === String(directFirstHit.recordId ?? ""),
            sameSyntheticPathAsCtxQuery: String(ctxMemoryFirstHit.path ?? "") === `record:${recordId}`,
        },
        ctxRead: {
            recordId,
            fromLine: ctxReadPayload.fromLine ?? null,
            returnedLines: ctxReadPayload.returnedLines ?? null,
            totalLines: ctxReadPayload.totalLines ?? null,
            hasMore: ctxReadPayload.hasMore ?? null,
            preview: (ctxReadPayload.items ?? []).slice(0, 8).map((item) => ({
                lineNumber: item.lineNumber ?? null,
                text: item.text ?? "",
            })),
        },
        ctxMemoryGet: {
            path: ctxMemoryGetPayload.path ?? null,
            fromLine: ctxMemoryGetResult.fromLine ?? null,
            returnedLines: ctxMemoryGetResult.returnedLines ?? null,
            totalLines: ctxMemoryGetResult.totalLines ?? null,
            hasMore: ctxMemoryGetResult.hasMore ?? null,
            preview: (ctxMemoryGetResult.items ?? []).slice(0, 8).map((item) => ({
                lineNumber: item.lineNumber ?? null,
                text: item.text ?? "",
            })),
        },
    };
    console.log(JSON.stringify(summary, null, 2));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
