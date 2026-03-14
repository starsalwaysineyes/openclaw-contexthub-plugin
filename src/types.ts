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
  source?: unknown;
}

export interface QueryResponse {
  items: QueryItem[];
  retrieval?: Record<string, unknown>;
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
