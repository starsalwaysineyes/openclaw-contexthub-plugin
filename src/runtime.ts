import * as fs from "node:fs/promises";
import * as path from "node:path";

export type FsKind = "local" | "cloud";

type Logger = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

export interface CtxPluginConfig {
  baseUrl: string;
  token?: string;
  defaultUserId?: string;
  localRoot: string;
  timeoutMs: number;
}

interface ParsedCommand {
  op: string;
  fsHint: FsKind | null;
  json: boolean;
  positionals: string[];
  flags: Set<string>;
  options: Map<string, string[]>;
}

export interface CtxRunResult {
  output: unknown;
  text: string;
}

const BOOLEAN_FLAGS = new Set([
  "json",
  "local",
  "cloud",
  "default",
  "recursive",
  "all",
  "hidden",
  "dry-run",
  "case-sensitive",
  "overwrite",
  "no-overwrite",
  "parents",
  "no-parents",
  "create-parents",
  "no-create-parents",
]);

export const HELP_TEXT = [
  "ctx command help",
  "",
  "usage:",
  "  /ctx <op> [args] [--cloud|--local] [--json]",
  "",
  "ops:",
  "  register-workspace, mkdir, ls, tree, stat, read, write, edit, apply-patch",
  "  mv, cp, rm, search, glob, grep, rg, import-tree",
  "",
  "examples:",
  "  /ctx ls ctx://alice/defaultWorkspace --cloud",
  "  /ctx write ctx://alice/defaultWorkspace/a.md --text \"hello\" --cloud",
  "  /ctx ls ./memory --local",
  "  /ctx read ./memory/2026-03-17.md --local",
  "  /ctx import-tree ./memory ctx://alice/defaultWorkspace/memory --include '*.md' --cloud",
].join("\n");

export function resolveConfig(raw: Record<string, unknown> | undefined): CtxPluginConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const home = process.env.HOME || "/tmp";
  const localRootRaw = String(cfg.localRoot ?? `${home}/.openclaw/workspace`).trim();
  const timeoutMsRaw = Number(cfg.timeoutMs ?? 30_000);
  return {
    baseUrl: String(cfg.baseUrl ?? "http://127.0.0.1:4040").trim(),
    token: String(cfg.token ?? "").trim() || undefined,
    defaultUserId: String(cfg.defaultUserId ?? cfg.userId ?? "").trim() || undefined,
    localRoot: path.resolve(localRootRaw),
    timeoutMs: Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 30_000,
  };
}

export class CtxRuntime {
  constructor(
    private readonly config: CtxPluginConfig,
    private readonly logger: Logger,
  ) {}

  async run(commandLine: string, opts?: { forceJson?: boolean }): Promise<CtxRunResult> {
    const parsed = parseCommand(commandLine);
    if (parsed.op === "help") {
      return { output: { help: HELP_TEXT }, text: HELP_TEXT };
    }
    const output = await this.execute(parsed);
    const asJson = opts?.forceJson ?? parsed.json ?? parsed.op !== "read";
    if (!asJson && typeof output === "string") {
      return { output, text: output };
    }
    if (!asJson && isRecord(output) && typeof output.text === "string") {
      return { output, text: output.text };
    }
    return {
      output,
      text: JSON.stringify(output, null, 2),
    };
  }

  private async execute(parsed: ParsedCommand): Promise<unknown> {
    const fsKind = this.pickFsKind(parsed);
    switch (parsed.op) {
      case "register-workspace":
        return this.execRegisterWorkspace(parsed);
      case "mkdir":
        return fsKind === "cloud" ? this.execCloudMkdir(parsed) : this.execLocalMkdir(parsed);
      case "ls":
        return fsKind === "cloud" ? this.execCloudLs(parsed) : this.execLocalLs(parsed);
      case "tree":
        return fsKind === "cloud" ? this.execCloudTree(parsed) : this.execLocalTree(parsed);
      case "stat":
        return fsKind === "cloud" ? this.execCloudStat(parsed) : this.execLocalStat(parsed);
      case "read":
        return fsKind === "cloud" ? this.execCloudRead(parsed) : this.execLocalRead(parsed);
      case "write":
        return fsKind === "cloud" ? this.execCloudWrite(parsed) : this.execLocalWrite(parsed);
      case "edit":
        return fsKind === "cloud" ? this.execCloudEdit(parsed) : this.execLocalEdit(parsed);
      case "apply-patch":
        return fsKind === "cloud" ? this.execCloudApplyPatch(parsed) : this.execLocalApplyPatch(parsed);
      case "mv":
        return fsKind === "cloud" ? this.execCloudMove(parsed) : this.execLocalMove(parsed);
      case "cp":
        return fsKind === "cloud" ? this.execCloudCopy(parsed) : this.execLocalCopy(parsed);
      case "rm":
        return fsKind === "cloud" ? this.execCloudRemove(parsed) : this.execLocalRemove(parsed);
      case "search":
        return fsKind === "cloud" ? this.execCloudSearch(parsed) : this.execLocalSearch(parsed);
      case "glob":
        return fsKind === "cloud" ? this.execCloudGlob(parsed) : this.execLocalGlob(parsed);
      case "grep":
        return fsKind === "cloud" ? this.execCloudGrep(parsed) : this.execLocalGrep(parsed, false);
      case "rg":
        return fsKind === "cloud" ? this.execCloudRg(parsed) : this.execLocalGrep(parsed, true);
      case "import-tree":
        return this.execImportTree(parsed);
      default:
        throw new Error(`unsupported op: ${parsed.op}`);
    }
  }

  private pickFsKind(parsed: ParsedCommand): FsKind {
    if (parsed.fsHint) return parsed.fsHint;
    if (parsed.op === "register-workspace" || parsed.op === "import-tree") return "cloud";

    const candidates = [
      ...parsed.positionals,
      ...this.optionValues(parsed, "uri"),
      ...this.optionValues(parsed, "scope-uri"),
      ...this.optionValues(parsed, "source-uri"),
      ...this.optionValues(parsed, "destination-uri"),
      ...this.optionValues(parsed, "destination"),
      ...this.optionValues(parsed, "source"),
      ...this.optionValues(parsed, "target"),
    ];

    if (candidates.some((value) => value.startsWith("ctx://"))) return "cloud";
    return "local";
  }

  private async execRegisterWorkspace(parsed: ParsedCommand): Promise<unknown> {
    const userId =
      this.optionValue(parsed, "user-id") ||
      this.position(parsed, 0) ||
      this.config.defaultUserId;
    if (!userId) throw new Error("register-workspace requires --user-id or a configured defaultUserId");
    const isDefault = parsed.flags.has("default");
    const agentId = this.optionValue(parsed, "agent-id") || undefined;
    const workspaceKind = isDefault ? "defaultWorkspace" : "agentWorkspace";
    if (!isDefault && !agentId) {
      throw new Error("register-workspace requires --default or --agent-id");
    }
    return this.cloudRequest("POST", "/v1/workspaces/register", {
      userId,
      workspaceKind,
      agentId: agentId ?? null,
    });
  }

  private async execCloudMkdir(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    const parents = this.booleanOption(parsed, "parents", "no-parents", true);
    return this.cloudRequest("POST", "/v1/fs/mkdir", { uri, parents });
  }

  private async execCloudLs(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    return this.cloudRequest("GET", "/v1/fs/ls", undefined, { uri });
  }

  private async execCloudTree(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    const depth = this.numberOption(parsed, "depth", 3);
    return this.cloudRequest("GET", "/v1/fs/tree", undefined, { uri, depth });
  }

  private async execCloudStat(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    return this.cloudRequest("GET", "/v1/fs/stat", undefined, { uri });
  }

  private async execCloudRead(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    return this.cloudRequest("GET", "/v1/fs/read", undefined, { uri });
  }

  private async execCloudWrite(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    const text = await this.resolveWriteText(parsed);
    const createParents = this.booleanOption(parsed, "create-parents", "no-create-parents", true);
    const overwrite = this.booleanOption(parsed, "overwrite", "no-overwrite", true);
    return this.cloudRequest("POST", "/v1/fs/write", {
      uri,
      text,
      createParents,
      overwrite,
    });
  }

  private async execCloudEdit(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    const matchText = this.requireOption(parsed, "match");
    const replaceText = this.requireOption(parsed, "replace");
    const replaceAll = parsed.flags.has("all");
    return this.cloudRequest("POST", "/v1/fs/edit", {
      uri,
      matchText,
      replaceText,
      replaceAll,
    });
  }

  private async execCloudApplyPatch(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    const patch = await this.resolvePatchText(parsed);
    return this.cloudRequest("POST", "/v1/fs/apply_patch", { uri, patch });
  }

  private async execCloudMove(parsed: ParsedCommand): Promise<unknown> {
    const sourceUri = this.requireSource(parsed);
    const destinationUri = this.requireDestination(parsed);
    const createParents = this.booleanOption(parsed, "create-parents", "no-create-parents", true);
    const overwrite = this.booleanOption(parsed, "overwrite", "no-overwrite", false);
    return this.cloudRequest("POST", "/v1/fs/mv", {
      sourceUri,
      destinationUri,
      createParents,
      overwrite,
    });
  }

  private async execCloudCopy(parsed: ParsedCommand): Promise<unknown> {
    const sourceUri = this.requireSource(parsed);
    const destinationUri = this.requireDestination(parsed);
    const createParents = this.booleanOption(parsed, "create-parents", "no-create-parents", true);
    const overwrite = this.booleanOption(parsed, "overwrite", "no-overwrite", false);
    return this.cloudRequest("POST", "/v1/fs/cp", {
      sourceUri,
      destinationUri,
      createParents,
      overwrite,
    });
  }

  private async execCloudRemove(parsed: ParsedCommand): Promise<unknown> {
    const uri = this.requireTarget(parsed);
    const recursive = parsed.flags.has("recursive");
    return this.cloudRequest("POST", "/v1/fs/rm", { uri, recursive });
  }

  private async execCloudSearch(parsed: ParsedCommand): Promise<unknown> {
    const query = this.optionValue(parsed, "query") || this.position(parsed, 0);
    if (!query) throw new Error("search requires --query or a positional query");
    const scopeUri = this.optionValue(parsed, "scope-uri") || this.position(parsed, 1) || null;
    const userId = this.resolveCloudUserId(parsed, scopeUri || undefined);
    const limit = this.numberOption(parsed, "limit", 20);
    return this.cloudRequest("POST", "/v1/fs/search", {
      userId,
      query,
      scopeUri,
      limit,
    });
  }

  private async execCloudGlob(parsed: ParsedCommand): Promise<unknown> {
    const pattern = this.optionValue(parsed, "pattern") || this.position(parsed, 0);
    if (!pattern) throw new Error("glob requires --pattern or a positional pattern");
    const scopeUri = this.optionValue(parsed, "scope-uri") || this.position(parsed, 1) || null;
    const userId = this.resolveCloudUserId(parsed, scopeUri || undefined);
    const limit = this.numberOption(parsed, "limit", 100);
    return this.cloudRequest("POST", "/v1/fs/glob", {
      userId,
      pattern,
      scopeUri,
      limit,
    });
  }

  private async execCloudGrep(parsed: ParsedCommand): Promise<unknown> {
    const pattern = this.optionValue(parsed, "pattern") || this.position(parsed, 0);
    if (!pattern) throw new Error("grep requires --pattern or a positional pattern");
    const scopeUri = this.optionValue(parsed, "scope-uri") || this.position(parsed, 1) || null;
    const userId = this.resolveCloudUserId(parsed, scopeUri || undefined);
    const limit = this.numberOption(parsed, "limit", 100);
    const glob = this.optionValue(parsed, "glob") || null;
    const caseSensitive = parsed.flags.has("case-sensitive");
    return this.cloudRequest("POST", "/v1/fs/grep", {
      userId,
      pattern,
      scopeUri,
      limit,
      caseSensitive,
      glob,
    });
  }

  private async execCloudRg(parsed: ParsedCommand): Promise<unknown> {
    const pattern = this.optionValue(parsed, "pattern") || this.position(parsed, 0);
    if (!pattern) throw new Error("rg requires --pattern or a positional pattern");
    const scopeUri = this.optionValue(parsed, "scope-uri") || this.position(parsed, 1) || null;
    const userId = this.resolveCloudUserId(parsed, scopeUri || undefined);
    const limit = this.numberOption(parsed, "limit", 100);
    const glob = this.optionValue(parsed, "glob") || null;
    const caseSensitive = parsed.flags.has("case-sensitive");
    return this.cloudRequest("POST", "/v1/fs/rg", {
      userId,
      pattern,
      scopeUri,
      limit,
      caseSensitive,
      glob,
    });
  }

  private async execImportTree(parsed: ParsedCommand): Promise<unknown> {
    const sourceRootRaw = this.optionValue(parsed, "source-root") || this.position(parsed, 0);
    const destinationUri = this.optionValue(parsed, "destination-uri") || this.position(parsed, 1);
    if (!sourceRootRaw || !destinationUri) {
      throw new Error("import-tree usage: import-tree <sourceRoot> <ctx://destination> [--include PATTERN] [--exclude PATTERN]");
    }
    if (!destinationUri.startsWith("ctx://")) {
      throw new Error("import-tree destination must be a ctx:// uri");
    }

    const sourceRoot = this.resolveLocalPath(sourceRootRaw);
    const sourceStat = await fs.stat(sourceRoot).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) {
      throw new Error(`source root must be an existing directory: ${sourceRootRaw}`);
    }

    const includes = this.optionValues(parsed, "include").flatMap(splitCsv);
    const excludes = this.optionValues(parsed, "exclude").flatMap(splitCsv);
    const limit = this.numberOption(parsed, "limit", Number.POSITIVE_INFINITY);
    const overwrite = this.booleanOption(parsed, "overwrite", "no-overwrite", true);
    const hidden = parsed.flags.has("hidden");
    const dryRun = parsed.flags.has("dry-run");

    const directories = new Set<string>();
    const createdDirectories = new Set<string>();
    const files: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];

    if (!dryRun) {
      await this.cloudRequest("POST", "/v1/fs/mkdir", { uri: destinationUri, parents: true });
    }

    const nodes = await this.collectLocalNodes(sourceRoot);
    for (const node of nodes) {
      if (!shouldKeep(node.relativePosix, includes, excludes, hidden)) continue;
      if (node.isDir) {
        directories.add(joinCtxUri(destinationUri, node.relativePosix));
        continue;
      }
      if (files.length >= limit) break;

      let text: string;
      try {
        text = await fs.readFile(node.absolutePath, "utf8");
      } catch {
        skipped.push({ path: node.absolutePath, reason: "non-utf8" });
        continue;
      }

      const targetUri = joinCtxUri(destinationUri, node.relativePosix);
      for (const parentRel of parentPaths(node.relativePosix)) {
        directories.add(joinCtxUri(destinationUri, parentRel));
      }
      files.push(targetUri);

      if (!dryRun) {
        const sortedDirectories = [...directories].sort((a, b) => slashDepth(a) - slashDepth(b));
        for (const directoryUri of sortedDirectories) {
          if (createdDirectories.has(directoryUri)) continue;
          await this.cloudRequest("POST", "/v1/fs/mkdir", { uri: directoryUri, parents: true });
          createdDirectories.add(directoryUri);
        }
        await this.cloudRequest("POST", "/v1/fs/write", {
          uri: targetUri,
          text,
          overwrite,
          createParents: true,
        });
      }
    }

    const directoryList = [...directories].sort();
    return {
      sourceRoot,
      destinationUri,
      dryRun,
      directoriesCreated: directoryList.length,
      filesImported: files.length,
      skipped,
      sampleDirectories: directoryList.slice(0, 10),
      sampleFiles: files.slice(0, 10),
    };
  }

  private async execLocalMkdir(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const recursive = this.booleanOption(parsed, "parents", "no-parents", true);
    await fs.mkdir(target, { recursive });
    return { uri: target, created: true };
  }

  private async execLocalLs(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new Error(`path does not exist: ${target}`);
    if (!stat.isDirectory()) throw new Error(`path is not a directory: ${target}`);

    const children = await fs.readdir(target, { withFileTypes: true });
    const entries = children
      .sort((a, b) => {
        const typeCmp = Number(b.isDirectory()) - Number(a.isDirectory());
        if (typeCmp !== 0) return typeCmp;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => ({
        name: entry.name,
        uri: path.join(target, entry.name),
        kind: entry.isDirectory() ? "dir" : "file",
      }));

    return { uri: target, entries };
  }

  private async execLocalTree(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const depth = this.numberOption(parsed, "depth", 3);
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new Error(`path does not exist: ${target}`);
    return this.buildLocalTree(target, Math.max(depth, 0));
  }

  private async execLocalStat(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new Error(`path does not exist: ${target}`);

    if (stat.isDirectory()) {
      const childCount = (await fs.readdir(target)).length;
      return {
        uri: target,
        name: path.basename(target) || target,
        kind: "dir",
        sizeBytes: null,
        lineCount: null,
        childCount,
      };
    }

    const text = await fs.readFile(target, "utf8").catch(() => null);
    return {
      uri: target,
      name: path.basename(target),
      kind: "file",
      sizeBytes: stat.size,
      lineCount: text == null ? null : countLines(text),
      childCount: null,
    };
  }

  private async execLocalRead(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new Error(`path does not exist: ${target}`);
    if (!stat.isFile()) throw new Error(`path is not a file: ${target}`);
    const text = await fs.readFile(target, "utf8");
    return {
      uri: target,
      text,
      lineCount: countLines(text),
    };
  }

  private async execLocalWrite(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const text = await this.resolveWriteText(parsed);
    const overwrite = this.booleanOption(parsed, "overwrite", "no-overwrite", true);
    const createParents = this.booleanOption(parsed, "create-parents", "no-create-parents", true);

    const stat = await fs.stat(target).catch(() => null);
    if (stat?.isDirectory()) throw new Error(`path is a directory: ${target}`);
    if (stat && !overwrite) throw new Error(`file already exists: ${target}`);

    if (createParents) {
      await fs.mkdir(path.dirname(target), { recursive: true });
    } else {
      const parentStat = await fs.stat(path.dirname(target)).catch(() => null);
      if (!parentStat?.isDirectory()) {
        throw new Error(`parent directory does not exist: ${path.dirname(target)}`);
      }
    }

    await fs.writeFile(target, text, "utf8");
    return { uri: target, written: true };
  }

  private async execLocalEdit(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const matchText = this.requireOption(parsed, "match");
    const replaceText = this.requireOption(parsed, "replace");
    const replaceAll = parsed.flags.has("all");

    const text = await fs.readFile(target, "utf8");
    const matched = countSubstring(text, matchText);
    if (matched === 0) throw new Error("matchText not found");
    if (matched > 1 && !replaceAll) {
      throw new Error("matchText matched multiple locations; set --all");
    }

    const nextText = replaceAll
      ? text.split(matchText).join(replaceText)
      : text.replace(matchText, replaceText);

    await fs.writeFile(target, nextText, "utf8");
    return {
      uri: target,
      matched,
      replaced: replaceAll ? matched : 1,
    };
  }

  private async execLocalApplyPatch(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const patch = await this.resolvePatchText(parsed);
    const currentText = await fs.readFile(target, "utf8");
    let currentLines = currentText.split(/\r?\n/);

    const hunks = parsePatchHunks(patch);
    if (hunks.length === 0) throw new Error("no patch hunks found");

    const applied: Array<{ index: number; startLine: number; removedLines: number; addedLines: number }> = [];

    for (const [idx, hunk] of hunks.entries()) {
      const index = idx + 1;
      const preimage = hunk.filter((line) => line.startsWith(" ") || line.startsWith("-")).map((line) => line.slice(1));
      const postimage = hunk.filter((line) => line.startsWith(" ") || line.startsWith("+")).map((line) => line.slice(1));
      if (preimage.length === 0) {
        throw new Error("patch hunks must include context or removed lines");
      }
      const positions = findBlockPositions(currentLines, preimage);
      if (positions.length === 0) throw new Error(`patch hunk ${index} did not match current file`);
      if (positions.length > 1) throw new Error(`patch hunk ${index} matched multiple locations`);

      const start = positions[0];
      currentLines = [...currentLines.slice(0, start), ...postimage, ...currentLines.slice(start + preimage.length)];
      applied.push({
        index,
        startLine: start + 1,
        removedLines: hunk.filter((line) => line.startsWith("-")).length,
        addedLines: hunk.filter((line) => line.startsWith("+")).length,
      });
    }

    await fs.writeFile(target, currentLines.join("\n"), "utf8");
    return { uri: target, hunks: hunks.length, applied };
  }

  private async execLocalMove(parsed: ParsedCommand): Promise<unknown> {
    const source = this.resolveLocalPath(this.requireSource(parsed));
    const destination = this.resolveLocalPath(this.requireDestination(parsed));
    const createParents = this.booleanOption(parsed, "create-parents", "no-create-parents", true);
    const overwrite = this.booleanOption(parsed, "overwrite", "no-overwrite", false);

    const sourceStat = await fs.stat(source).catch(() => null);
    if (!sourceStat) throw new Error(`path does not exist: ${source}`);

    if (createParents) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
    }

    const destinationStat = await fs.stat(destination).catch(() => null);
    if (destinationStat && !overwrite) throw new Error(`destination already exists: ${destination}`);
    if (destinationStat) await removePath(destination, true);

    try {
      await fs.rename(source, destination);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EXDEV") throw error;
      await copyPath(source, destination);
      await removePath(source, true);
    }

    return { sourceUri: source, destinationUri: destination, moved: true };
  }

  private async execLocalCopy(parsed: ParsedCommand): Promise<unknown> {
    const source = this.resolveLocalPath(this.requireSource(parsed));
    const destination = this.resolveLocalPath(this.requireDestination(parsed));
    const createParents = this.booleanOption(parsed, "create-parents", "no-create-parents", true);
    const overwrite = this.booleanOption(parsed, "overwrite", "no-overwrite", false);

    const sourceStat = await fs.stat(source).catch(() => null);
    if (!sourceStat) throw new Error(`path does not exist: ${source}`);

    if (createParents) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
    }

    const destinationStat = await fs.stat(destination).catch(() => null);
    if (destinationStat && !overwrite) throw new Error(`destination already exists: ${destination}`);
    if (destinationStat) await removePath(destination, true);

    await copyPath(source, destination);
    return { sourceUri: source, destinationUri: destination, copied: true };
  }

  private async execLocalRemove(parsed: ParsedCommand): Promise<unknown> {
    const target = this.resolveLocalPath(this.requireTarget(parsed));
    const recursive = parsed.flags.has("recursive");
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new Error(`path does not exist: ${target}`);

    if (stat.isFile()) {
      await fs.unlink(target);
      return { uri: target, kind: "file", removed: true };
    }

    if (recursive) {
      await fs.rm(target, { recursive: true, force: false });
      return { uri: target, kind: "dir", removed: true };
    }

    try {
      await fs.rmdir(target);
    } catch {
      throw new Error(`directory is not empty: ${target}; set --recursive`);
    }

    return { uri: target, kind: "dir", removed: true };
  }

  private async execLocalSearch(parsed: ParsedCommand): Promise<unknown> {
    const query = this.optionValue(parsed, "query") || this.position(parsed, 0);
    if (!query) throw new Error("search requires --query or a positional query");
    const scopeRaw = this.optionValue(parsed, "scope-uri") || this.position(parsed, 1) || this.config.localRoot;
    const limit = this.numberOption(parsed, "limit", 20);
    const scope = this.resolveLocalPath(scopeRaw);

    const hits = await this.collectLineHits({
      scope,
      mode: "literal",
      pattern: query,
      limit,
      caseSensitive: false,
      globPattern: undefined,
    });

    return { query, scopeUri: scope, hits };
  }

  private async execLocalGlob(parsed: ParsedCommand): Promise<unknown> {
    const pattern = this.optionValue(parsed, "pattern") || this.position(parsed, 0);
    if (!pattern) throw new Error("glob requires --pattern or a positional pattern");
    const scopeRaw = this.optionValue(parsed, "scope-uri") || this.position(parsed, 1) || this.config.localRoot;
    const scope = this.resolveLocalPath(scopeRaw);
    const limit = this.numberOption(parsed, "limit", 100);

    const nodes = await this.collectLocalNodes(scope);
    const hits: Array<{ uri: string; kind: string }> = [];
    for (const node of nodes) {
      if (matchPattern(node.relativePosix, pattern) || matchPattern(path.posix.basename(node.relativePosix), pattern)) {
        hits.push({ uri: node.absolutePath, kind: node.isDir ? "dir" : "file" });
        if (hits.length >= limit) break;
      }
    }

    return { pattern, scopeUri: scope, hits };
  }

  private async execLocalGrep(parsed: ParsedCommand, regexMode: boolean): Promise<unknown> {
    const pattern = this.optionValue(parsed, "pattern") || this.position(parsed, 0);
    if (!pattern) throw new Error(`${regexMode ? "rg" : "grep"} requires --pattern or a positional pattern`);
    const scopeRaw = this.optionValue(parsed, "scope-uri") || this.position(parsed, 1) || this.config.localRoot;
    const scope = this.resolveLocalPath(scopeRaw);
    const limit = this.numberOption(parsed, "limit", 100);
    const caseSensitive = parsed.flags.has("case-sensitive");
    const globPattern = this.optionValue(parsed, "glob") || undefined;

    const hits = await this.collectLineHits({
      scope,
      mode: regexMode ? "regex" : "literal",
      pattern,
      limit,
      caseSensitive,
      globPattern,
    });

    return { pattern, scopeUri: scope, hits };
  }

  private async buildLocalTree(target: string, depth: number): Promise<Record<string, unknown>> {
    const stat = await fs.stat(target);
    const node: Record<string, unknown> = {
      name: path.basename(target) || target,
      uri: target,
      kind: stat.isDirectory() ? "dir" : "file",
      children: [] as unknown[],
    };

    if (!stat.isDirectory() || depth <= 0) return node;
    const children = await fs.readdir(target, { withFileTypes: true });
    const sorted = children.sort((a, b) => {
      const typeCmp = Number(b.isDirectory()) - Number(a.isDirectory());
      if (typeCmp !== 0) return typeCmp;
      return a.name.localeCompare(b.name);
    });

    const childNodes: unknown[] = [];
    for (const child of sorted) {
      childNodes.push(await this.buildLocalTree(path.join(target, child.name), depth - 1));
    }
    node.children = childNodes;
    return node;
  }

  private async collectLineHits(params: {
    scope: string;
    mode: "literal" | "regex";
    pattern: string;
    limit: number;
    caseSensitive: boolean;
    globPattern?: string;
  }): Promise<Array<{ uri: string; lineNumber: number; text: string }>> {
    const scopeStat = await fs.stat(params.scope).catch(() => null);
    if (!scopeStat) throw new Error(`path does not exist: ${params.scope}`);

    const files = scopeStat.isFile()
      ? [{ absolutePath: params.scope, relativePosix: path.posix.basename(params.scope), isDir: false }]
      : (await this.collectLocalNodes(params.scope)).filter((node) => !node.isDir);

    const literal = params.caseSensitive ? params.pattern : params.pattern.toLowerCase();
    const regex = params.mode === "regex"
      ? new RegExp(params.pattern, params.caseSensitive ? "" : "i")
      : null;

    const hits: Array<{ uri: string; lineNumber: number; text: string }> = [];

    for (const fileNode of files) {
      if (params.globPattern) {
        const rel = fileNode.relativePosix;
        if (!matchPattern(rel, params.globPattern) && !matchPattern(path.posix.basename(rel), params.globPattern)) {
          continue;
        }
      }

      let text: string;
      try {
        text = await fs.readFile(fileNode.absolutePath, "utf8");
      } catch {
        continue;
      }

      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const matched = regex
          ? Boolean(regex.exec(line))
          : (params.caseSensitive ? line.includes(literal) : line.toLowerCase().includes(literal));
        if (!matched) continue;
        hits.push({ uri: fileNode.absolutePath, lineNumber: i + 1, text: line });
        if (hits.length >= params.limit) return hits;
      }
    }

    return hits;
  }

  private async collectLocalNodes(rootPath: string): Promise<Array<{ absolutePath: string; relativePosix: string; isDir: boolean }>> {
    const rootStat = await fs.stat(rootPath);
    if (!rootStat.isDirectory()) {
      return [{ absolutePath: rootPath, relativePosix: path.posix.basename(rootPath), isDir: false }];
    }

    const results: Array<{ absolutePath: string; relativePosix: string; isDir: boolean }> = [
      { absolutePath: rootPath, relativePosix: ".", isDir: true },
    ];

    const stack: string[] = [rootPath];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      const children = await fs.readdir(current, { withFileTypes: true });
      const sorted = children.sort((a, b) => {
        const typeCmp = Number(b.isDirectory()) - Number(a.isDirectory());
        if (typeCmp !== 0) return typeCmp;
        return a.name.localeCompare(b.name);
      });

      for (const child of sorted) {
        const absolutePath = path.join(current, child.name);
        const relativePosix = toPosix(path.relative(rootPath, absolutePath));
        results.push({ absolutePath, relativePosix, isDir: child.isDirectory() });
        if (child.isDirectory()) stack.push(absolutePath);
      }
    }

    return results.sort((a, b) => {
      const depthCmp = slashDepth(a.relativePosix) - slashDepth(b.relativePosix);
      if (depthCmp !== 0) return depthCmp;
      return a.relativePosix.localeCompare(b.relativePosix);
    });
  }

  private resolveCloudUserId(parsed: ParsedCommand, scopeUri?: string): string {
    const explicit = this.optionValue(parsed, "user-id");
    if (explicit) return explicit;
    const fromScope = scopeUri ? parseCtxUser(scopeUri) : undefined;
    if (fromScope) return fromScope;
    if (this.config.defaultUserId) return this.config.defaultUserId;
    throw new Error("cloud search/glob/grep/rg requires --user-id or a configured defaultUserId");
  }

  private async cloudRequest(
    method: "GET" | "POST",
    endpoint: string,
    payload?: Record<string, unknown>,
    query?: Record<string, unknown>,
  ): Promise<unknown> {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const url = new URL(`${baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (payload) headers["Content-Type"] = "application/json";
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;

    const response = await fetch(url, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`ctx cloud request failed: ${response.status} ${response.statusText}${text ? ` :: ${text}` : ""}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private resolveLocalPath(input: string): string {
    let raw = input.trim();
    if (!raw) throw new Error("local path is required");
    if (raw.startsWith("ctx://")) throw new Error("expected local path but got ctx:// uri");
    if (raw.startsWith("file://")) {
      const url = new URL(raw);
      raw = decodeURIComponent(url.pathname);
    }
    if (raw === "~") {
      raw = process.env.HOME || raw;
    } else if (raw.startsWith("~/")) {
      raw = path.join(process.env.HOME || "", raw.slice(2));
    }
    return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(this.config.localRoot, raw);
  }

  private requireTarget(parsed: ParsedCommand): string {
    return (
      this.optionValue(parsed, "uri") ||
      this.optionValue(parsed, "target") ||
      this.position(parsed, 0) ||
      (() => {
        throw new Error(`${parsed.op} requires a target path/uri`);
      })()
    );
  }

  private requireSource(parsed: ParsedCommand): string {
    return (
      this.optionValue(parsed, "source-uri") ||
      this.optionValue(parsed, "source") ||
      this.position(parsed, 0) ||
      (() => {
        throw new Error(`${parsed.op} requires a source path/uri`);
      })()
    );
  }

  private requireDestination(parsed: ParsedCommand): string {
    return (
      this.optionValue(parsed, "destination-uri") ||
      this.optionValue(parsed, "destination") ||
      this.position(parsed, 1) ||
      (() => {
        throw new Error(`${parsed.op} requires a destination path/uri`);
      })()
    );
  }

  private async resolveWriteText(parsed: ParsedCommand): Promise<string> {
    const text = this.optionValue(parsed, "text");
    const fromFile = this.optionValue(parsed, "from-file");
    if (text && fromFile) throw new Error("use either --text or --from-file");
    if (!text && !fromFile) throw new Error("write requires --text or --from-file");
    if (text) return text;
    const filePath = this.resolveLocalPath(fromFile || "");
    return fs.readFile(filePath, "utf8");
  }

  private async resolvePatchText(parsed: ParsedCommand): Promise<string> {
    const patchText = this.optionValue(parsed, "patch-text") || this.optionValue(parsed, "patch");
    const patchFile = this.optionValue(parsed, "patch-file");
    if (patchText && patchFile) throw new Error("use either --patch-text/--patch or --patch-file");
    if (!patchText && !patchFile) throw new Error("apply-patch requires --patch-text/--patch or --patch-file");
    if (patchText) return patchText;
    const filePath = this.resolveLocalPath(patchFile || "");
    return fs.readFile(filePath, "utf8");
  }

  private booleanOption(parsed: ParsedCommand, positive: string, negative: string, fallback: boolean): boolean {
    if (parsed.flags.has(positive)) return true;
    if (parsed.flags.has(negative)) return false;
    return fallback;
  }

  private numberOption(parsed: ParsedCommand, key: string, fallback: number): number {
    const raw = this.optionValue(parsed, key);
    if (!raw) return fallback;
    const parsedNumber = Number(raw);
    if (!Number.isFinite(parsedNumber)) return fallback;
    return Math.max(0, Math.floor(parsedNumber));
  }

  private requireOption(parsed: ParsedCommand, key: string): string {
    const value = this.optionValue(parsed, key);
    if (!value) throw new Error(`missing option --${key}`);
    return value;
  }

  private optionValue(parsed: ParsedCommand, key: string): string | undefined {
    const values = parsed.options.get(key);
    return values && values.length > 0 ? values[values.length - 1] : undefined;
  }

  private optionValues(parsed: ParsedCommand, key: string): string[] {
    return parsed.options.get(key) ?? [];
  }

  private position(parsed: ParsedCommand, index: number): string | undefined {
    return parsed.positionals[index];
  }
}

function parseCommand(raw: string): ParsedCommand {
  const tokens = tokenize(raw.trim());
  if (tokens.length === 0) {
    return {
      op: "help",
      fsHint: null,
      json: false,
      positionals: [],
      flags: new Set(),
      options: new Map(),
    };
  }

  const op = normalizeOp(tokens.shift() || "");
  const flags = new Set<string>();
  const options = new Map<string, string[]>();
  const positionals: string[] = [];
  let fsHint: FsKind | null = null;
  let json = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    const keyRaw = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
    const key = keyRaw.trim().toLowerCase();
    const hasInlineValue = eqIndex >= 0;
    const inlineValue = hasInlineValue ? token.slice(eqIndex + 1) : undefined;

    if (key === "cloud") {
      fsHint = "cloud";
      continue;
    }
    if (key === "local") {
      fsHint = "local";
      continue;
    }
    if (key === "json") {
      json = true;
      continue;
    }

    if (BOOLEAN_FLAGS.has(key)) {
      flags.add(key);
      continue;
    }

    let value = inlineValue;
    if (!hasInlineValue) {
      if (i + 1 >= tokens.length || tokens[i + 1].startsWith("--")) {
        throw new Error(`missing value for --${key}`);
      }
      value = tokens[i + 1];
      i += 1;
    }

    const existing = options.get(key) ?? [];
    existing.push(value || "");
    options.set(key, existing);
  }

  return {
    op,
    fsHint,
    json,
    positionals,
    flags,
    options,
  };
}

function normalizeOp(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/_/g, "-");
  switch (value) {
    case "register":
    case "registerworkspace":
      return "register-workspace";
    case "applypatch":
    case "patch":
      return "apply-patch";
    case "remove":
    case "delete":
      return "rm";
    default:
      return value;
  }
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const matcher = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(input)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    tokens.push(value.replace(/\\(["'\\])/g, "$1"));
  }
  return tokens;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function countSubstring(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index < text.length) {
    const hit = text.indexOf(needle, index);
    if (hit < 0) break;
    count += 1;
    index = hit + needle.length;
  }
  return count;
}

function parsePatchHunks(patchText: string): string[][] {
  const hunks: string[][] = [];
  let current: string[] = [];
  let sawPatchMarker = false;

  for (const rawLine of patchText.split(/\r?\n/)) {
    if (rawLine.startsWith("*** Begin Patch")) {
      sawPatchMarker = true;
      continue;
    }
    if (rawLine.startsWith("*** End Patch")) break;
    if (
      rawLine.startsWith("*** Update File:") ||
      rawLine.startsWith("*** Delete File:") ||
      rawLine.startsWith("*** Add File:") ||
      rawLine.startsWith("--- ") ||
      rawLine.startsWith("+++ ")
    ) {
      sawPatchMarker = true;
      continue;
    }
    if (rawLine.startsWith("@@")) {
      sawPatchMarker = true;
      if (current.length > 0) {
        hunks.push(current);
        current = [];
      }
      continue;
    }
    if (rawLine.startsWith("\\")) continue;
    if (rawLine.startsWith(" ") || rawLine.startsWith("+") || rawLine.startsWith("-")) {
      sawPatchMarker = true;
      current.push(rawLine);
      continue;
    }
    if (rawLine.trim() === "") {
      if (current.length > 0) {
        throw new Error("blank lines inside hunks must keep a diff prefix");
      }
      continue;
    }
    if (sawPatchMarker) {
      throw new Error(`invalid patch line: ${rawLine}`);
    }
  }

  if (current.length > 0) hunks.push(current);
  return hunks;
}

function findBlockPositions(lines: string[], needle: string[]): number[] {
  const positions: number[] = [];
  if (needle.length === 0) return positions;
  const maxStart = lines.length - needle.length;
  for (let start = 0; start <= maxStart; start += 1) {
    let matched = true;
    for (let i = 0; i < needle.length; i += 1) {
      if (lines[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) positions.push(start);
  }
  return positions;
}

async function removePath(target: string, recursive: boolean): Promise<void> {
  const stat = await fs.stat(target);
  if (stat.isFile()) {
    await fs.unlink(target);
    return;
  }
  if (recursive) {
    await fs.rm(target, { recursive: true, force: false });
    return;
  }
  await fs.rmdir(target);
}

async function copyPath(source: string, destination: string): Promise<void> {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.cp(source, destination, { recursive: true, force: true });
    return;
  }
  await fs.copyFile(source, destination);
}

function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep) || ".";
}

function slashDepth(value: string): number {
  return value.split("/").filter(Boolean).length;
}

function parseCtxUser(uri: string): string | undefined {
  if (!uri.startsWith("ctx://")) return undefined;
  const withoutScheme = uri.slice("ctx://".length);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex < 0) return withoutScheme || undefined;
  return withoutScheme.slice(0, slashIndex) || undefined;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCtxUri(baseUri: string, relativePosix: string): string {
  if (!relativePosix || relativePosix === ".") return baseUri.replace(/\/$/, "");
  return `${baseUri.replace(/\/$/, "")}/${relativePosix}`;
}

function shouldKeep(relativePosix: string, includes: string[], excludes: string[], hidden: boolean): boolean {
  const parts = relativePosix.split("/").filter(Boolean);
  if (!hidden && parts.some((part) => part.startsWith("."))) return false;
  const name = parts.length > 0 ? parts[parts.length - 1] : relativePosix;
  if (includes.length > 0 && !includes.some((pattern) => matchPattern(relativePosix, pattern) || matchPattern(name, pattern))) {
    return false;
  }
  if (excludes.length > 0 && excludes.some((pattern) => matchPattern(relativePosix, pattern) || matchPattern(name, pattern))) {
    return false;
  }
  return true;
}

function parentPaths(relativePosix: string): string[] {
  const parts = relativePosix.split("/").filter(Boolean);
  if (parts.length <= 1) return [];
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    parents.push(parts.slice(0, i).join("/"));
  }
  return parents;
}

function matchPattern(input: string, pattern: string): boolean {
  if (!pattern) return false;
  const regex = globToRegex(pattern);
  return regex.test(input);
}

function globToRegex(pattern: string): RegExp {
  let regex = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === "*" && next === "*") {
      regex += ".*";
      i += 1;
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    if (/[\\^$+.|(){}\[\]]/.test(char)) {
      regex += `\\${char}`;
      continue;
    }
    regex += char;
  }
  regex += "$";
  return new RegExp(regex);
}
