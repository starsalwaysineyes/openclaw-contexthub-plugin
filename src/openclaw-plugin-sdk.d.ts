declare module "openclaw/plugin-sdk" {
  export type PluginCommandContext = {
    senderId?: string;
    channel: string;
    channelId?: string;
    isAuthorizedSender: boolean;
    args?: string;
    commandBody: string;
    config: unknown;
    from?: string;
    to?: string;
    accountId?: string;
    messageThreadId?: number;
  };

  export type OpenClawPluginApi = {
    pluginConfig?: Record<string, unknown>;
    logger: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
    };
    on: (hookName: string, handler: any, opts?: { priority?: number }) => void;
    registerCommand: (command: {
      name: string;
      description: string;
      acceptsArgs?: boolean;
      requireAuth?: boolean;
      handler: (ctx: PluginCommandContext) => Promise<{ text?: string; isError?: boolean } | void> | { text?: string; isError?: boolean } | void;
    }) => void;
    registerTool: (
      tool: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }>;
      },
      opts?: { optional?: boolean; name?: string; names?: string[] },
    ) => void;
  };
}
