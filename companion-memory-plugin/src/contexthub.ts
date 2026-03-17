import type { QueryRequest, QueryResponse, RecordReadResponse } from "./types.js";

export interface ContextHubHttpClientOptions {
  baseUrl: string;
  token?: string;
}

export class ContextHubHttpClient {
  constructor(private readonly options: ContextHubHttpClientOptions) {}

  async query(payload: QueryRequest): Promise<QueryResponse> {
    return this.request<QueryResponse>("POST", "/v1/query", payload);
  }

  async readRecordLines(recordId: string, fromLine = 1, limit = 80): Promise<RecordReadResponse> {
    return this.request<RecordReadResponse>("GET", `/v1/records/${recordId}/lines?from_line=${fromLine}&limit=${limit}`);
  }

  private async request<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;

    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ContextHub request failed: ${response.status} ${response.statusText}${text ? ` :: ${text}` : ""}`);
    }

    return (await response.json()) as T;
  }
}
