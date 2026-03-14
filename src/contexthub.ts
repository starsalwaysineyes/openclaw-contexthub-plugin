import type { DerivationJob, QueryRequest, QueryResponse, RecordLink } from "./types.js";

export interface ContextHubHttpClientOptions {
  baseUrl: string;
  token?: string;
}

export class ContextHubHttpClient {
  constructor(private readonly options: ContextHubHttpClientOptions) {}

  async query(payload: QueryRequest): Promise<QueryResponse> {
    return this.request<QueryResponse>("POST", "/v1/query", payload);
  }

  async importResource(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/v1/resources/import", payload);
  }

  async commitSession(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/v1/sessions/commit", payload);
  }

  async getDerivationJob(jobId: string): Promise<DerivationJob> {
    return this.request<DerivationJob>("GET", `/v1/derivation-jobs/${jobId}`);
  }

  async listRecordLinks(recordId: string): Promise<{ items: RecordLink[] }> {
    return this.request<{ items: RecordLink[] }>("GET", `/v1/records/${recordId}/links`);
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
