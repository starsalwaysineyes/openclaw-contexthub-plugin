# openclaw-contexthub-plugin

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
- ContextHub HTTP client for `query`, `importResource`, `commitSession`, `getDerivationJob`
- config resolution from plugin config + env

Not implemented yet:

- explicit write commands
- file upload flow
- batch import preset command surface
- operator inspection commands
- automatic post-task session commit

## Config shape

```json
{
  "baseUrl": "http://127.0.0.1:4040",
  "tenantId": "tenant_xxx",
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
- `CONTEXT_HUB_RECALL_ENABLED`
- `CONTEXT_HUB_RECALL_PARTITIONS`
- `CONTEXT_HUB_RECALL_LAYERS`
- `CONTEXT_HUB_RECALL_LIMIT`
- `CONTEXT_HUB_RECALL_RERANK`

## Product rule that should stay

- backend stays layer-first and path-agnostic
- plugin presets may map local structures like `archive/` -> `L1`
- those presets must not become mandatory backend semantics
