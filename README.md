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
  - `/contexthub-query <query> [:: partitions] [:: layers] [:: limit] [:: rerank]`
  - `/contexthub-presets`
  - `/contexthub-save <layer> <partitionKey|-> <title> :: <text>`
  - `/contexthub-commit <partitionKey|-> <summary> [:: memoryTitle :: memoryText]`
  - `/contexthub-import-file <layer> <partitionKey|-> <filePath> [:: title]`
  - `/contexthub-import-preset <presetName> [limit] [--dry-run]`
  - `/contexthub-job <jobId>`
  - `/contexthub-links <recordId>`
- GitHub Actions CI: `npm ci` + `npm run check`

Not implemented yet:

- automatic post-task session commit
- operator-friendly explain-recall output
- true file/blob upload once backend supports non-inline payloads
- richer preset lifecycle and validation UX

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
  },
  "importPresets": {
    "archive-to-l1": {
      "rootPath": "/Users/me/archive",
      "partitionKey": "project-contexthub",
      "layer": "l1",
      "deriveLayers": ["l0"],
      "deriveMode": "async",
      "tags": ["archive", "migration"]
    }
  }
}
```

## Env fallback

```bash
cp .env.example .env
npm ci
npm run check
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

This repo now covers all four at a first-pass level, plus a first-pass preset-based batch import flow and an explicit operator-facing query command.

## Product rule that should stay

- backend stays layer-first and path-agnostic
- plugin presets may map local structures like `archive/` -> `L1`
- those presets must not become mandatory backend semantics
