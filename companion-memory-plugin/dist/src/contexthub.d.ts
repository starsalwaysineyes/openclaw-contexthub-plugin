import type { QueryRequest, QueryResponse, RecordReadResponse } from "./types.js";
export interface ContextHubHttpClientOptions {
    baseUrl: string;
    token?: string;
}
export declare class ContextHubHttpClient {
    private readonly options;
    constructor(options: ContextHubHttpClientOptions);
    query(payload: QueryRequest): Promise<QueryResponse>;
    readRecordLines(recordId: string, fromLine?: number, limit?: number): Promise<RecordReadResponse>;
    private request;
}
