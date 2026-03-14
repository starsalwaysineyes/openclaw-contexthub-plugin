import type { BrowseTreeRequest, BrowseTreeResponse, DerivationJob, GrepRequest, GrepResponse, ListRecordsRequest, ListRecordsResponse, QueryRequest, QueryResponse, RecordLink, RecordReadResponse } from "./types.js";

export interface ContextHubHttpClientOptions {
  baseUrl: string;
  token?: string;
}

export class ContextHubHttpClient {
  constructor(private readonly options: ContextHubHttpClientOptions) {}

  async query(payload: QueryRequest): Promise<QueryResponse> {
    return this.request<QueryResponse>("POST", "/v1/query", payload);
  }

  async grep(payload: GrepRequest): Promise<GrepResponse> {
    return this.request<GrepResponse>("POST", "/v1/records/grep", payload);
  }

  async listRecords(payload: ListRecordsRequest): Promise<ListRecordsResponse> {
    return this.request<ListRecordsResponse>("POST", "/v1/records/list", payload);
  }

  async browseRecordTree(payload: BrowseTreeRequest): Promise<BrowseTreeResponse> {
    return this.request<BrowseTreeResponse>("POST", "/v1/records/tree", payload);
  }

  async readRecordLines(recordId: string, fromLine = 1, limit = 80): Promise<RecordReadResponse> {
    return this.request<RecordReadResponse>("GET", `/v1/records/${recordId}/lines?from_line=${fromLine}&limit=${limit}`);
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
