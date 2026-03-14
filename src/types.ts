export type RecallLayer = "l0" | "l1" | "l2";
export type DeriveMode = "sync" | "async";

export interface PreAnswerRecallConfig {
  enabled: boolean;
  partitions: string[];
  layers: RecallLayer[];
  limit: number;
  rerank: boolean;
}

export interface ImportPreset {
  rootPath: string;
  partitionKey: string;
  layer: RecallLayer;
  deriveLayers: RecallLayer[];
  deriveMode: DeriveMode;
  limit?: number;
  tags: string[];
  recordType?: string;
  sourceKind?: string;
  relativePathPrefix?: string;
  promptPreset?: string;
  metadata?: Record<string, unknown>;
}

export interface LastSessionCapture {
  capturedAt: string;
  success: boolean;
  error?: string | null;
  durationMs?: number;
  messageCount: number;
  title: string;
  transcript: string;
  idempotencyKey: string;
}

export interface ContextHubPluginConfig {
  baseUrl: string;
  token?: string;
  tenantId: string;
  defaultPartitionKey?: string;
  recall: {
    preAnswer: PreAnswerRecallConfig;
  };
  importPresets: Record<string, ImportPreset>;
}

export interface QueryRequest {
  tenantId: string;
  query: string;
  partitions: string[];
  layers: RecallLayer[];
  tags?: string[];
  limit: number;
  rerank: boolean;
}

export interface BrowseTreeRequest {
  tenantId: string;
  partitions: string[];
  types?: string[];
  layers: RecallLayer[];
  tags?: string[];
  sourceKind?: string;
  pathPrefix?: string;
  limit?: number;
}

export interface ListRecordsRequest {
  tenantId: string;
  partitions: string[];
  types?: string[];
  layers: RecallLayer[];
  tags?: string[];
  titleContains?: string;
  sourceKind?: string;
  sourcePathPrefix?: string;
  offset?: number;
  limit?: number;
}

export interface GrepRequest {
  tenantId: string;
  pattern: string;
  partitions: string[];
  layers: RecallLayer[];
  tags?: string[];
  limit: number;
  regex?: boolean;
  caseSensitive?: boolean;
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
  source?: unknown;
}

export interface ResponseScope {
  tenantId: string;
  authKind: string;
  authScoped: boolean;
  requestedPartitions: string[];
  effectivePartitions: string[];
  requestedTypes?: string[];
  requestedLayers?: string[];
  requestedTags?: string[];
  effectiveLayerRules?: Record<string, string[]> | null;
  sourceKind?: string;
  sourcePathPrefix?: string;
  pathPrefix?: string;
  titleContains?: string;
}

export interface QueryResponse {
  items: QueryItem[];
  retrieval?: Record<string, unknown>;
  scope?: ResponseScope;
}

export interface ListRecordItem {
  id: string;
  partitionKey: string;
  type: string;
  layer: RecallLayer;
  title: string;
  manualSummary?: string;
  tags?: string[];
  source?: Record<string, unknown> | null;
  lineCount: number;
  textPreview: string;
  importance: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListRecordsResponse {
  items: ListRecordItem[];
  page?: Record<string, unknown>;
  scope?: ResponseScope;
}

export interface BrowseTreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  recordCount: number;
  layers?: Record<string, number>;
  partitions?: Record<string, number>;
}

export interface BrowseTreeResponse {
  pathPrefix: string;
  items: BrowseTreeNode[];
  summary?: Record<string, unknown>;
  scope?: ResponseScope;
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

export interface GrepHit {
  recordId: string;
  title: string;
  layer: RecallLayer;
  partitionKey: string;
  lineNumber: number;
  text: string;
  matchCount: number;
  matchRanges: Array<{ start: number; end: number }>;
}

export interface GrepResponse {
  items: GrepHit[];
  search?: Record<string, unknown>;
  scope?: ResponseScope;
}

export interface DerivationJob {
  id: string;
  status: string;
  mode?: string;
  effectiveMode?: string;
  sourceRecordId?: string;
  requestedLayers?: string[];
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordLink {
  id: string;
  sourceRecordId: string;
  targetRecordId: string;
  relation: string;
  metadata?: Record<string, unknown>;
}
