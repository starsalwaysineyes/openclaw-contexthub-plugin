export type RecallLayer = "l0" | "l1" | "l2";
export interface MemoryPluginConfig {
    baseUrl: string;
    token?: string;
    tenantId: string;
    search: {
        partitions: string[];
        layers: RecallLayer[];
        limit: number;
        rerank: boolean;
    };
    read: {
        defaultLines: number;
        maxLines: number;
    };
}
export interface QueryRequest {
    tenantId: string;
    query: string;
    partitions: string[];
    layers: RecallLayer[];
    limit: number;
    rerank: boolean;
}
export interface QueryItem {
    recordId: string;
    title: string;
    layer: RecallLayer;
    partitionKey: string;
    score: number;
    snippet: string;
    manualSummary?: string;
    tags?: string[];
    source?: Record<string, unknown> | null;
}
export interface QueryResponse {
    items: QueryItem[];
    retrieval?: Record<string, unknown>;
    scope?: Record<string, unknown>;
}
export interface RecordReadLine {
    lineNumber: number;
    text: string;
}
export interface RecordReadResponse {
    record: Record<string, unknown>;
    fromLine: number;
    limit: number;
    totalLines: number;
    returnedLines: number;
    hasMore: boolean;
    items: RecordReadLine[];
}
