# openclaw-contexthub-memory-plugin

Companion `kind: "memory"` plugin for ContextHub.

Purpose:

- keep `openclaw-contexthub-plugin` as the `kind: "integration"` sidecar for `/ctx`, writes, imports, and operator flows
- provide a separate `kind: "memory"` plugin that owns `plugins.slots.memory`
- reuse the same ContextHub tenant/base URL/token defaults where practical

## Current live status

This package is no longer just a nested prototype on disk.

On the main machine it is currently:

- explicitly exposed in `plugins.load.paths`
- allowed and enabled in `plugins.entries`
- selected as `plugins.slots.memory`
- loaded by the live gateway as `openclaw-contexthub-memory-plugin`

At the same time, the original `openclaw-contexthub-plugin` remains loaded beside it for `/ctx` and explicit ContextHub operations.

Important nuance:

- runtime slot handoff is live
- `openclaw memory` CLI still behaves as the local memory-files surface rather than the live runtime slot surface

## Current behavior

- `memory_search` maps to `POST /v1/query`
- `memory_get` maps to `GET /v1/records/{recordId}/lines`
- search result paths use a stable synthetic form: `record:<recordId>`
- config accepts `search.*`, but also falls back to the sidecar-style `recall.preAnswer.*` keys so local experiments can reuse the current config shape
- optional bearer auth is supported through config `token` or `CONTEXT_HUB_TOKEN`

## Validation

Type-check from the repo root:

```bash
./node_modules/.bin/tsc -p companion-memory-plugin/tsconfig.json --noEmit
```

Live contract smoke without changing gateway state:

```bash
cd companion-memory-plugin
npm run smoke -- \
  --base-url http://38.55.39.92:24040 \
  --tenant-id tenant_... \
  --token "$CONTEXT_HUB_TOKEN" \
  --partitions memory,project-contexthub \
  --layers l0 \
  --limit 6 \
  --rerank true
```

What the smoke does:

- registers the plugin against a tiny fake OpenClaw memory-plugin API
- verifies both `memory_search` and `memory_get` are exposed
- runs a real `memory_search -> memory_get` loop against ContextHub
- checks that search hits use the synthetic `record:<recordId>` path form expected by the plugin

Current live result for the cutover/slot question:

- top hit: `record:record_3f808216a218471698e50287806f06e9`
- title: `ContextHub Task Board`
- follow-up read: lines `1-12 / 150`

## Why the synthetic `record:<recordId>` path still matters

The direct query path still does not guarantee a file-like `sourcePath` for top `L0` hits.

So even after the real slot handoff, the most reliable `memory_get` contract remains:

- search by ContextHub query
- return stable synthetic record paths
- resolve reads through `GET /v1/records/{recordId}/lines`

## Current limitations

This plugin is intentionally small.

It does not yet try to fully clone every aspect of the old local memory UX, and that is fine for now because the main remaining gap is not retrieval correctness but operator polish:

- `openclaw memory` CLI still surfaces local memory-files behavior
- citation/readout parity could be improved later if it proves useful
- long-term transport hardening belongs to the direct ContextHub backend path, not this plugin alone

## Related docs

- `/Users/shiuing/Desktop/funcode/openclaw-contexthub-plugin/docs/memory-slot-integration.md`
- `/Users/shiuing/Desktop/notes/contexthub/LOCAL-CUTOVER.md`
- `/Users/shiuing/Desktop/notes/contexthub/RETRIEVAL-EVIDENCE.md`
