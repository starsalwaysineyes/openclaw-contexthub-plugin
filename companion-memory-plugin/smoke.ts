import plugin from "./index.js";

type ToolResult = {
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, unknown>;
};

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith(prefix)) return value.slice(prefix.length);
    if (value === exact) return argv[index + 1];
  }
  return undefined;
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function firstText(result: ToolResult): string {
  return (result.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

async function main() {
  const tools = new Map<string, RegisteredTool>();
  const pluginConfig = {
    baseUrl: parseArg("base-url") ?? process.env.CONTEXT_HUB_BASE_URL ?? "http://127.0.0.1:4040",
    token: parseArg("token") ?? process.env.CONTEXT_HUB_TOKEN,
    tenantId: parseArg("tenant-id") ?? process.env.CONTEXT_HUB_TENANT_ID ?? "",
    search: {
      partitions: parseCsv(parseArg("partitions") ?? process.env.CONTEXT_HUB_PARTITIONS, ["memory"]),
      layers: parseCsv(parseArg("layers") ?? process.env.CONTEXT_HUB_RECALL_LAYERS, ["l0"]),
      limit: parseNumber(parseArg("limit") ?? process.env.CONTEXT_HUB_RECALL_LIMIT, 5),
      rerank: parseBool(parseArg("rerank") ?? process.env.CONTEXT_HUB_RECALL_RERANK, true),
    },
    read: {
      defaultLines: parseNumber(parseArg("default-lines"), 12),
      maxLines: parseNumber(parseArg("max-lines"), 40),
    },
  };

  const api = {
    pluginConfig,
    logger: {
      info: (...args: unknown[]) => console.error("[info]", ...args),
      warn: (...args: unknown[]) => console.error("[warn]", ...args),
      error: (...args: unknown[]) => console.error("[error]", ...args),
    },
    registerTool(tool: RegisteredTool, opts?: { name?: string; names?: string[] }) {
      const aliases = new Set<string>([tool.name, ...(opts?.names ?? []), ...(opts?.name ? [opts.name] : [])]);
      for (const alias of aliases) tools.set(alias, tool);
    },
  };

  plugin.register(api as never);

  const memorySearch = tools.get("memory_search");
  const memoryGet = tools.get("memory_get");
  if (!memorySearch || !memoryGet) {
    throw new Error(`expected memory_search and memory_get, got: ${Array.from(tools.keys()).join(", ")}`);
  }

  const query =
    parseArg("query") ??
    "What is the current status of local OpenClaw -> cloud ContextHub cutover and plugins.slots.memory integration?";

  const searchResult = await memorySearch.execute("smoke-search", {
    query,
    maxResults: pluginConfig.search.limit,
  });
  const searchDetails = (searchResult.details ?? {}) as { results?: Array<Record<string, unknown>>; scope?: unknown; retrieval?: unknown };
  const results = searchDetails.results ?? [];
  if (results.length === 0) {
    throw new Error(`memory_search returned no hits for query: ${query}`);
  }

  const firstHit = results[0] ?? {};
  const path = String(firstHit.path ?? "");
  if (!path.startsWith("record:")) {
    throw new Error(`expected synthetic record path, got: ${path || "<empty>"}`);
  }

  const memoryGetResult = await memoryGet.execute("smoke-get", {
    path,
    lines: parseNumber(parseArg("lines"), pluginConfig.read.defaultLines),
  });
  const readDetails = (memoryGetResult.details ?? {}) as { result?: Record<string, unknown>; sourcePath?: string };

  const summary = {
    registeredTools: Array.from(tools.keys()).sort(),
    config: {
      baseUrl: pluginConfig.baseUrl,
      tenantId: pluginConfig.tenantId,
      partitions: pluginConfig.search.partitions,
      layers: pluginConfig.search.layers,
      limit: pluginConfig.search.limit,
      rerank: pluginConfig.search.rerank,
    },
    query,
    hitCount: results.length,
    firstHit: {
      path,
      title: firstHit.title,
      layer: firstHit.layer,
      partitionKey: firstHit.partitionKey,
      score: firstHit.score,
      sourcePath: firstHit.sourcePath ?? null,
    },
    searchScope: searchDetails.scope ?? null,
    searchRetrieval: searchDetails.retrieval ?? null,
    searchPreview: firstText(searchResult).split("\n").slice(0, 6),
    getPreview: firstText(memoryGetResult).split("\n").slice(0, 10),
    readMeta: {
      sourcePath: readDetails.sourcePath ?? null,
      fromLine: readDetails.result?.fromLine ?? null,
      returnedLines: readDetails.result?.returnedLines ?? null,
      totalLines: readDetails.result?.totalLines ?? null,
      hasMore: readDetails.result?.hasMore ?? null,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
