import type { BrowseTreeRequest, BrowseTreeResponse, DerivationJob, DerivationJobListRequest, DerivationJobListResponse, DerivationJobRedriveRequest, DerivationJobRedriveResponse, GrepRequest, GrepResponse, ListRecordsRequest, ListRecordsResponse, QueryRequest, QueryResponse, ContextHubRecord, RecordApplyPatchResponse, RecordEditResponse, RecordLink, RecordReadResponse } from "./types.js";
export interface ContextHubHttpClientOptions {
    baseUrl: string;
    token?: string;
}
export declare class ContextHubHttpClient {
    private readonly options;
    constructor(options: ContextHubHttpClientOptions);
    query(payload: QueryRequest): Promise<QueryResponse>;
    grep(payload: GrepRequest): Promise<GrepResponse>;
    listRecords(payload: ListRecordsRequest): Promise<ListRecordsResponse>;
    browseRecordTree(payload: BrowseTreeRequest): Promise<BrowseTreeResponse>;
    getRecord(recordId: string): Promise<ContextHubRecord>;
    updateRecord(recordId: string, payload: Record<string, unknown>): Promise<ContextHubRecord>;
    editRecordText(recordId: string, payload: {
        matchText: string;
        replaceText: string;
        replaceAll?: boolean;
    }): Promise<RecordEditResponse>;
    applyRecordPatch(recordId: string, payload: {
        patch: string;
    }): Promise<RecordApplyPatchResponse>;
    readRecordLines(recordId: string, fromLine?: number, limit?: number): Promise<RecordReadResponse>;
    importResource(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
    commitSession(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
    getDerivationJob(jobId: string): Promise<DerivationJob>;
    listDerivationJobs(payload: DerivationJobListRequest): Promise<DerivationJobListResponse>;
    redriveDerivationJobs(payload: DerivationJobRedriveRequest): Promise<DerivationJobRedriveResponse>;
    listRecordLinks(recordId: string): Promise<{
        items: RecordLink[];
    }>;
    private request;
}
