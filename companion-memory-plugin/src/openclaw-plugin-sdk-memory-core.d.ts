declare module "openclaw/plugin-sdk/memory-core" {
  export type MemoryToolResult = {
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  };

  export type OpenClawPluginApi = {
    pluginConfig?: Record<string, unknown>;
    logger: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
    };
    registerTool: (
      tool: {
        name: string;
        label?: string;
        description: string;
        parameters: Record<string, unknown>;
        execute: (toolCallId: string, params: Record<string, unknown>) => Promise<MemoryToolResult> | MemoryToolResult;
      },
      opts?: { optional?: boolean; name?: string; names?: string[] },
    ) => void;
  };
}
