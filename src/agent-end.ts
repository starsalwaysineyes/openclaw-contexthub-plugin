import type { ContextHubPluginConfig } from "./types.js";
import { ContextHubHttpClient } from "./contexthub.js";

function flattenText(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => flattenText(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const prioritized = [record.text, record.content, record.input, record.output, record.message].flatMap((item) => flattenText(item));
    if (prioritized.length > 0) return prioritized;
    return Object.values(record).flatMap((item) => flattenText(item));
  }
  return [];
}

function extractRole(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const record = message as Record<string, unknown>;
  const role = record.role;
  return typeof role === "string" ? role.toLowerCase() : undefined;
}

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  const text = flattenText(record.content ?? record.text ?? record.message).join("\n").trim();
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function summarizeTitle(text: string): string {
  const firstLine = text.split(/\n+/)[0]?.trim() || "Session summary";
  return firstLine.slice(0, 80);
}

export async function commitAfterAgentEnd(params: {
  client: ContextHubHttpClient;
  config: ContextHubPluginConfig;
  event: { messages?: unknown[]; success?: boolean; error?: string; durationMs?: number };
  logger: { warn: (...args: unknown[]) => void };
}) {
  const cfg = params.config.commit.afterAgentEnd;
  if (!cfg.enabled || !params.event.success) return;
  const partitionKey = cfg.partitionKey ?? params.config.defaultPartitionKey;
  if (!partitionKey) {
    params.logger.warn("contexthub-plugin: no partition key configured for afterAgentEnd commit");
    return;
  }

  const messages = Array.isArray(params.event.messages) ? params.event.messages : [];
  const extracted = messages
    .map((message) => ({ role: extractRole(message), content: extractText(message) }))
    .filter((entry) => entry.role && entry.content);

  const lastAssistant = [...extracted].reverse().find((entry) => entry.role === "assistant");
  if (!lastAssistant) return;
  const lastUser = [...extracted].reverse().find((entry) => entry.role === "user");
  const summary = lastAssistant.content.slice(0, cfg.maxSummaryChars).trim();
  if (!summary) return;

  const payload: Record<string, unknown> = {
    tenantId: params.config.tenantId,
    partitionKey,
    summary,
    messages: [lastUser, { role: "assistant", content: summary }].filter(Boolean),
    memoryEntries: cfg.writeMemory ? [{
      title: summarizeTitle(summary),
      text: summary,
      layer: cfg.memoryLayer,
      importance: 3.0,
      tags: ["auto-commit", "agent-end"],
    }] : [],
    metadata: {
      adapter: "openclaw-contexthub-plugin",
      hook: "agent_end",
      success: Boolean(params.event.success),
      durationMs: params.event.durationMs,
      error: params.event.error ?? null,
    },
  };

  await params.client.commitSession(payload);
}
