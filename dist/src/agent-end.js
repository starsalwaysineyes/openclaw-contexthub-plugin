import { createHash } from "node:crypto";
function flattenText(value) {
    if (value == null)
        return [];
    if (typeof value === "string")
        return [value];
    if (Array.isArray(value))
        return value.flatMap((item) => flattenText(item));
    if (typeof value === "object") {
        const record = value;
        const prioritized = [record.text, record.content, record.input, record.output, record.message].flatMap((item) => flattenText(item));
        if (prioritized.length > 0)
            return prioritized;
        return Object.values(record).flatMap((item) => flattenText(item));
    }
    return [];
}
function extractRole(message) {
    if (!message || typeof message !== "object")
        return undefined;
    const record = message;
    const role = record.role;
    return typeof role === "string" ? role.toLowerCase() : undefined;
}
function extractText(message) {
    if (!message || typeof message !== "object")
        return "";
    const record = message;
    const role = extractRole(message);
    let text = flattenText(record.content ?? record.text ?? record.message).join("\n").trim();
    if (role === "assistant") {
        text = text
            .split(/\n+/)
            .filter((line) => !["thinking", "toolCall", "toolresult"].includes(line.trim()))
            .filter((line) => !line.includes('"encrypted_content"'))
            .filter((line) => !line.startsWith('{"id":"rs_'))
            .filter((line) => !line.startsWith('call_'))
            .join("\n")
            .trim();
    }
    return text.replace(/\n{3,}/g, "\n\n").trim();
}
function visibleTitleFromUserText(text) {
    const lines = text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith("## ContextHub recall"))
        .filter((line) => !line.startsWith("Use these recalled L0 memory pointers"))
        .filter((line) => !/^\d+\. \[l\d\]/.test(line))
        .filter((line) => !/^Conversation info/.test(line))
        .filter((line) => !/^Sender \(untrusted metadata\)/.test(line))
        .filter((line) => line.toLowerCase() !== "json");
    return lines[lines.length - 1] || null;
}
function summarizeTitle(messages) {
    const lastUser = [...messages].reverse().find((entry) => entry.role === "user");
    const visible = lastUser ? visibleTitleFromUserText(lastUser.content) : null;
    if (visible)
        return visible.slice(0, 80);
    return "OpenClaw session transcript";
}
function buildTranscript(params) {
    const header = [
        "# OpenClaw session transcript",
        `capturedAt: ${params.capturedAt}`,
        `success: ${params.success}`,
        `durationMs: ${params.durationMs ?? 0}`,
        `messageCount: ${params.messages.length}`,
    ];
    if (params.error)
        header.push(`error: ${params.error}`);
    const body = params.messages.flatMap((message, index) => [
        `\n## ${index + 1}. ${message.role}`,
        message.content,
    ]);
    return [...header, ...body].join("\n").trim();
}
export function captureLastSession(event) {
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const extracted = messages
        .map((message) => ({ role: extractRole(message), content: extractText(message) }))
        .filter((entry) => Boolean(entry.role && entry.content));
    if (extracted.length === 0)
        return null;
    const capturedAt = new Date().toISOString();
    const transcript = buildTranscript({
        capturedAt,
        success: Boolean(event.success),
        error: event.error,
        durationMs: event.durationMs,
        messages: extracted,
    });
    const idempotencyKey = `plugin-session:${createHash("sha1").update(transcript).digest("hex").slice(0, 16)}`;
    return {
        capturedAt,
        success: Boolean(event.success),
        error: event.error ?? null,
        durationMs: event.durationMs,
        messageCount: extracted.length,
        title: summarizeTitle(extracted),
        transcript,
        idempotencyKey,
    };
}
