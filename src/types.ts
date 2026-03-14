export type RecallLayer = "l0" | "l1" | "l2";

export interface PreAnswerRecallConfig {
  enabled: boolean;
  partitions: string[];
  layers: RecallLayer[];
  limit: number;
  rerank: boolean;
}

export interface ContextHubPluginConfig {
  baseUrl: string;
  token?: string;
  tenantId: string;
  recall: {
    preAnswer: PreAnswerRecallConfig;
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
  source?: unknown;
}

export interface QueryResponse {
  items: QueryItem[];
  retrieval?: Record<string, unknown>;
}
