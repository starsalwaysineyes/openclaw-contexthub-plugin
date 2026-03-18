# openclaw-contexthub-plugin

This repo is now the minimal `ctx` plugin line on `main`.

The old query/record-first ContextHub plugin line is preserved on the `feat` branch.

## What this plugin does

It registers exactly two user-facing surfaces:

- command: `/ctx`
- tool: `ctx`

Both use the same CLI-like grammar and can operate on:

Cloud `search` now defaults to `defaultWorkspace`; add `--workspace-mode user` or `--workspace-mode default-first` only when you intentionally want a wider scope.

- local filesystem paths
- cloud `ctx://` URIs backed by the phase-1 ContextHub filesystem service

Current focus is practical operator use, not memory-slot ownership.

## Supported ops

- `register-workspace`
- `mkdir`
- `ls`
- `tree`
- `stat`
- `read`
- `write`
- `edit`
- `apply-patch`
- `mv`
- `cp`
- `rm`
- `search`
- `glob`
- `grep`
- `rg`
- `import-tree`

## Config

Example plugin config in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/Users/shiuing/Desktop/funcode/openclaw-contexthub-plugin"
      ]
    },
    "allow": [
      "openclaw-contexthub-plugin"
    ],
    "entries": {
      "openclaw-contexthub-plugin": {
        "enabled": true,
        "config": {
          "baseUrl": "http://YOUR_HOST:24040",
          "token": "<bearer token>",
          "defaultUserId": "YOUR_USER_ID",
          "localRoot": "/Users/shiuing/.openclaw/workspace",
          "timeoutMs": 30000
        }
      }
    }
  }
}
```

## Command examples

```text
/ctx ls ./memory --local
/ctx read ./memory/2026-03-17.md --local
/ctx stat ctx://shiuing/defaultWorkspace --cloud
/ctx mkdir ctx://shiuing/defaultWorkspace/tasks --cloud
/ctx write ctx://shiuing/defaultWorkspace/tasks/today.md --text "hello" --cloud
/ctx search "cloud cutover" --cloud
/ctx search "phase1" --workspace-mode user --mode lexical --expansion import-tree --expansion 24040 --cloud
/ctx grep cloud --scope-uri ctx://shiuing/defaultWorkspace --user-id shiuing --cloud
/ctx import-tree ./memory ctx://shiuing/defaultWorkspace/memory --include '*.md' --exclude 'archive/**' --cloud
```

## Tool example

```json
{
  "command": "ls ctx://shiuing/defaultWorkspace --cloud"
}
```

## Development

```bash
npm run check
npm run build
```
