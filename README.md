# openclaw-contexthub-plugin

Official plugin maintained by MemTensor.

OpenClaw plugin skeleton for ContextHub.

Current focus:

- cfg-driven pre-answer recall
- default recall scope = `L0` only
- keep backend semantics generic (`L0` / `L1` / `L2` are explicit targets)
- treat local archive/daily-memory behavior as migration presets, not product rules

## What this plugin should eventually do

### Read

- query ContextHub before answering
- default to `L0` only for pre-answer recall
- allow config overrides for partitions / layers / limit / rerank
- inject recalled snippets through `prependContext`

### Write

- save explicit text to `L0` / `L1` / `L2`
- commit curated session summaries
- write durable records for decisions, lessons, gotchas

### Upload / Import

- upload a local file directly to `L0` / `L1` / `L2`
- import a local folder or batch with an optional preset
- trigger derivation into lower layers when useful

### Inspect

- check derivation job status
- inspect record links
- explain why a recall happened

## Current implementation status

Implemented in this repo now:

- minimal `before_agent_start` hook
- ContextHub HTTP client for `query`, `importResource`, `commitSession`, `getDerivationJob`, `listRecordLinks`
- config resolution from plugin config + env
- plugin commands:
  - `/contexthub-recall`
  - `/contexthub-save <layer> <partitionKey|-> <title> :: <text>`
  - `/contexthub-import-file <layer> <partitionKey|-> <filePath> [:: title]`
  - `/contexthub-job <jobId>`
  - `/contexthub-links <recordId>`

Not implemented yet:

- automatic post-task session commit
- batch import preset commands
- operator-friendly explain-recall output
- true file/blob upload once backend supports non-inline payloads

## Config shape

```json
{
  "baseUrl": "http://127.0.0.1:4040",
  "tenantId": "tenant_xxx",
  "defaultPartitionKey": "project-contexthub",
  "recall": {
    "preAnswer": {
      "enabled": true,
      "partitions": ["project-contexthub", "memory"],
      "layers": ["l0"],
      "limit": 5,
      "rerank": false
    }
  }
}
```

## Env fallback

```bash
cp .env.example .env
```

Key env vars:

- `CONTEXT_HUB_BASE_URL`
- `CONTEXT_HUB_TOKEN`
- `CONTEXT_HUB_TENANT_ID`
- `CONTEXT_HUB_DEFAULT_PARTITION_KEY`
- `CONTEXT_HUB_RECALL_ENABLED`
- `CONTEXT_HUB_RECALL_PARTITIONS`
- `CONTEXT_HUB_RECALL_LAYERS`
- `CONTEXT_HUB_RECALL_LIMIT`
- `CONTEXT_HUB_RECALL_RERANK`

## Agent workflow view

An agent needs four practical abilities:

1. recall short pointers before answering (`L0` by default)
2. save explicit conclusions/decisions to chosen layers
3. import local docs/files when a human points at them
4. inspect async jobs and links when something looks wrong

This skeleton now covers all four at a first-pass level.

## Product rule that should stay

- backend stays layer-first and path-agnostic
- plugin presets may map local structures like `archive/` -> `L1`
- those presets must not become mandatory backend semantics
