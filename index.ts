import type { OpenClawPluginApi, PluginCommandContext } from "openclaw/plugin-sdk";
import { CtxRuntime, HELP_TEXT, resolveConfig } from "./src/runtime.js";

const pluginConfigSchema = {
  type: "object" as const,
  additionalProperties: true,
  properties: {
    baseUrl: { type: "string" as const, description: "ContextHub phase-1 filesystem base URL" },
    token: { type: "string" as const, description: "Bearer token used for cloud ctx:// requests" },
    defaultUserId: { type: "string" as const, description: "Default ctx:// userId for cloud search/glob/grep/rg when scope is omitted" },
    localRoot: { type: "string" as const, description: "Base directory used for relative local filesystem paths" },
    timeoutMs: { type: "number" as const, description: "HTTP timeout for cloud requests in milliseconds" },
  },
};

function toolContent(text: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

async function runCommand(runtime: CtxRuntime, raw: string) {
  return runtime.run(raw, { forceJson: false });
}

function extractCommandInput(ctx: PluginCommandContext): string {
  const value = (ctx.args || ctx.commandBody || "").trim();
  return value;
}

const plugin = {
  id: "openclaw-contexthub-plugin",
  name: "OpenClaw Ctx Plugin",
  description: "One ctx command/tool for local filesystem and ContextHub ctx:// cloud filesystem operations.",
  kind: "integration" as const,
  configSchema: pluginConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolveConfig((api.pluginConfig ?? {}) as Record<string, unknown>);
    const runtime = new CtxRuntime(config, api.logger);

    api.registerCommand({
      name: "ctx",
      description: "Local/cloud filesystem operator surface. Use /ctx help for examples.",
      acceptsArgs: true,
      requireAuth: false,
      async handler(ctx: PluginCommandContext) {
        try {
          const input = extractCommandInput(ctx);
          if (!input) return { text: HELP_TEXT };
          const result = await runCommand(runtime, input);
          return { text: result.text };
        } catch (error) {
          return { text: `ctx error: ${String(error)}`, isError: true };
        }
      },
    });

    api.registerTool({
      name: "ctx",
      description: "CLI-like ctx filesystem tool. One tool for local paths and cloud ctx:// URIs.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          command: {
            type: "string",
            description: "CLI-like ctx command, for example: ls ctx://shiuing/defaultWorkspace --cloud or write ./notes/todo.md --text 'hello' --local",
          },
        },
        required: ["command"],
      },
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const command = String(params.command ?? "").trim();
        if (!command) {
          return toolContent(HELP_TEXT, { help: HELP_TEXT });
        }
        try {
          const result = await runtime.run(command, { forceJson: false });
          return toolContent(result.text, { output: result.output });
        } catch (error) {
          return toolContent(`ctx error: ${String(error)}`, { error: String(error) });
        }
      },
    });
  },
};

export default plugin;
