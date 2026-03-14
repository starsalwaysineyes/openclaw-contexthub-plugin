# openclaw-contexthub-plugin

Official plugin maintained by MemTensor.

OpenClaw plugin skeleton for ContextHub.

Current focus:

- cfg-driven pre-answer recall
- default recall scope = `L0` only
- no automatic memory writing
- explicit upload of cached full session transcript to `L2` for raw retrieval
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
- commit curated session summaries when a human explicitly wants it
- avoid low-quality automatic memory writing

### Upload / Import

- upload a local file directly to `L0` / `L1` / `L2`
- upload the cached full OpenClaw session transcript to `L2` for raw retrieval
- import a local folder or batch with an optional preset
- trigger derivation into lower layers only when explicitly useful

### Inspect

- check derivation job status
- inspect record links
- explain why a recall happened
- inspect the currently cached last session before uploading it

## Current implementation status

Implemented in this repo now:

- minimal `before_agent_start` hook
- `agent_end` cache of the last completed session transcript (no automatic write)
- ContextHub HTTP client for `query`, `grep`, `readRecordLines`, `importResource`, `commitSession`, `getDerivationJob`, `listRecordLinks`
- config resolution from plugin config + env
- agent-facing tools:
  - `ctx_query`
  - `ctx_read`
  - `ctx_grep`
  - `ctx_write_text` (optional)
  - `ctx_import_file` (optional)
- preferred short operator entrypoint:
  - `/ctx q ...`
  - `/ctx g ...`
  - `/ctx r ...`
  - `/ctx s ...`
  - `/ctx c ...`
  - `/ctx f ...`
  - `/ctx ip ...`
  - `/ctx j ...`
  - `/ctx l ...`
  - `/ctx last`
  - `/ctx up ...`
- long-form compatibility commands are still available:
  - `/contexthub-recall`
  - `/contexthub-query <query> [:: partitions] [:: layers] [:: limit] [:: rerank] [--json]`
  - `/contexthub-grep <pattern> [:: partitions] [:: layers] [:: limit] [:: regex] [:: caseSensitive] [--json]`
  - `/contexthub-presets`
  - `/contexthub-read <recordId> [:: fromLine] [:: limit] [--json]`
  - `/contexthub-last-session`
  - `/contexthub-upload-last-session <partitionKey|-> [:: title]`
  - `/contexthub-save <layer> <partitionKey|-> <title> :: <text>`
  - `/contexthub-commit <partitionKey|-> <summary> [:: memoryTitle :: memoryText]`
  - `/contexthub-import-file <layer> <partitionKey|-> <filePath> [:: title]`
  - `/contexthub-import-preset <presetName> [limit] [--dry-run]`
  - `/contexthub-job <jobId>`
  - `/contexthub-links <recordId>`
- GitHub Actions CI: `npm ci` + `npm run check`

Not implemented yet:

- operator-friendly explain-recall output beyond the current compact summary / `--json` split (record-level grouping now exists, but trace explanation is still thin)
- true file/blob upload once backend supports non-inline payloads
- richer preset lifecycle and validation UX
- smarter capture rules so `/contexthub-last-session` can optionally track non-chat command flows too

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
2. save explicit conclusions to chosen layers when explicitly asked
3. upload raw session/doc/file content when a human wants raw retrieval
4. inspect async jobs and links when something looks wrong

This repo now covers all four at a first-pass level, plus preset-based batch import flow, explicit last-session upload, the first line-oriented read/grep bridge to ContextHub, a shorter `/ctx` operator surface, and the first agent-facing `registerTool(...)` layer.

## Product rule that should stay

- backend stays layer-first and path-agnostic
- plugin presets may map local structures like `archive/` -> `L1`
- those presets must not become mandatory backend semantics
- raw session upload should stay explicit, not automatic
