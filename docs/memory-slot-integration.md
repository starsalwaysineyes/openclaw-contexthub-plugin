# ContextHub Memory Slot Integration Path

Last updated: 2026-03-15

## Current runtime facts

- Local OpenClaw is no longer in sidecar-only mode.
- `~/.openclaw/openclaw.json` now sets `plugins.slots.memory = openclaw-contexthub-memory-plugin`.
- Live runtime now loads both ContextHub plugins together:
  - `openclaw-contexthub-plugin` as the `kind: "integration"` sidecar for `/ctx`, import/write flows, and operator tooling
  - `openclaw-contexthub-memory-plugin` as the active `kind: "memory"` slot owner
- `memory-core` is no longer the active slot on this machine; `openclaw plugins list --json` currently shows it as disabled.
- Both plugins now point at the token-protected direct-IP backend `http://38.55.39.92:24040` for tenant `tenant_908faf21972a433e9ab8f3a0b2ddb2cd`.
- Important nuance: the runtime slot handoff is real, but the `openclaw memory` CLI still behaves as the local memory-files surface rather than a proxy for the active runtime memory slot.

## Current evidence snapshot

### Runtime status

Current live checks on this machine show:

- `openclaw status --json` -> `memoryPlugin.slot = openclaw-contexthub-memory-plugin`
- `openclaw plugins list --json` ->
  - `openclaw-contexthub-plugin`: `loaded`, `kind=integration`
  - `openclaw-contexthub-memory-plugin`: `loaded`, `kind=memory`
  - `memory-core`: `disabled`
- `GET /health` on the direct backend currently reports `records=225` and `derivation_jobs=239`

One practical operator detail also surfaced during this pass:

- `openclaw status --json` can prepend plugin log lines before the JSON payload (for example `[plugins] contexthub-memory-plugin: registered ...`), so helper scripts now need to extract the first JSON object from mixed stdout instead of assuming perfectly clean JSON-only output.

### Direct cloud ContextHub query

For the prompt:

`What is the current status of local OpenClaw -> cloud ContextHub cutover and plugins.slots.memory integration?`

A fresh direct `POST /v1/query` against `http://38.55.39.92:24040` with bearer auth and scope `memory + project-contexthub`, `L0`, `limit=6`, `rerank=true` returns:

- top path: `record:record_3f808216a218471698e50287806f06e9`
- top title: `ContextHub Task Board`
- top partition: `project-contexthub`
- top layer: `l0`
- current top score: about `0.78354`

This remains the desired project-aware result for implementation-heavy questions.

### Runtime-compatible companion memory plugin smoke

The no-reload companion smoke still matches that same record:

- `hitCount = 1`
- top path: `record:record_3f808216a218471698e50287806f06e9`
- top title: `ContextHub Task Board`
- `memory_get` follow-up reads lines `1-12 / 150`

This confirms the slot-compatible `memory_search -> memory_get` contract remains aligned with live backend behavior after the real cutover.

### `/ctx` command smoke

The local `/ctx` contract smoke also remains aligned with the backend and the short command router:

- `/ctx q ...`, `/ctx ms ...`, and `/contexthub-query ...` still agree on the same first record id
- `/ctx mg record:<recordId>` now exposes the same synthetic-path read contract as the live memory slot
- `/ctx r <recordId>` and `/ctx mg record:<recordId>` both read the expected lines from `ContextHub Task Board`
- current parity checks report `sameFirstRecordId = true` and runtime-alias parity `true`

### `openclaw memory` CLI behavior

The important remaining divergence is unchanged:

- `openclaw memory search --query ... --json` still returns local `memory/*.md` results first
- current top hit for the same cutover question is still `memory/2026-03-15.md`
- this means the CLI is still best understood as the local memory-files surface, not proof of which runtime memory plugin owns `plugins.slots.memory`

## What is now settled

- Moving ContextHub into `plugins.slots.memory` was not a config-only thought experiment; it is now live on the main machine.
- The safest architecture choice was the one we suspected earlier:
  - keep the existing integration plugin for `/ctx`, writes/imports, and richer operator flows
  - keep the companion memory plugin separate for canonical `memory_search` / `memory_get`
- The earlier discovery blocker is resolved in practice because the companion package is now exposed explicitly as its own load path and plugin entry.
- The earlier restart gate is also resolved in practice because the approved restart already happened and the slot handoff is now validated live.

## Current operator helpers

The no-restart helpers are still the main validation path, but they are now updated for current reality:

- `~/Desktop/notes/contexthub/scripts/check-memory-slot-rehearsal-readiness.sh`
  - now validates the live slot state rather than only a pre-handoff rehearsal
  - now reads bearer token from config
  - now tolerates mixed stdout from `openclaw status --json` / `openclaw plugins list --json`
- `~/Desktop/notes/contexthub/scripts/compare-cutover-retrieval-paths.sh`
  - now compares against the direct-IP backend instead of the older local tunnel assumption
  - now passes bearer auth to direct query and smoke runs
  - now makes the CLI-vs-runtime split explicit in output

## Remaining work

The remaining integration work is no longer about whether the slot can work. It is about polish and long-term shape:

1. Decide whether the current `openclaw memory` CLI vs runtime-slot split should remain documented as operator nuance or become an upstream/plugin follow-up.
2. Harden the direct `38.55.39.92:24040` path with `TLS` / reverse proxy or equivalent.
3. Continue improving the sidecar plugin UX (`/ctx` short-path defaults, explain-recall quality, richer read/grep context, write/import ergonomics).
4. Optionally improve citation/readout parity between the companion plugin and the old local memory UX where it materially helps operator workflow.

## Relevant files

- `~/.openclaw/openclaw.json`
- `/Users/shiuing/Desktop/funcode/openclaw-contexthub-plugin/index.ts`
- `/Users/shiuing/Desktop/funcode/openclaw-contexthub-plugin/openclaw.plugin.json`
- `/Users/shiuing/Desktop/funcode/openclaw-contexthub-plugin/companion-memory-plugin/index.ts`
- `/Users/shiuing/Desktop/funcode/openclaw-contexthub-plugin/companion-memory-plugin/openclaw.plugin.json`
- `/Users/shiuing/Desktop/notes/contexthub/LOCAL-CUTOVER.md`
- `/Users/shiuing/Desktop/notes/contexthub/RETRIEVAL-EVIDENCE.md`
- `/Users/shiuing/Desktop/notes/contexthub/TASK.md`
- `/Users/shiuing/Desktop/notes/contexthub/TODO.md`
