# LoopSense MCP Server

LoopSense is an open-source MCP server that closes the feedback loop for AI coding agents — giving them real-time visibility into CI results, deployments, test outcomes, and file system changes.

## What it does

When an AI agent pushes code, runs tests, or triggers a deployment, LoopSense watches the downstream effects and surfaces them back to the agent. No more blind actions.

**Supported sources:**
- GitHub Actions CI runs (polling)
- Local processes (stdout/stderr capture, exit codes)
- File system changes (via chokidar)
- HTTP endpoints (polling, with status/body assertions)
- Incoming webhooks (lightweight HTTP server)

## Requirements

- Node.js 18+

## Installation

```bash
npm install -g @loopsense/mcp
```

Or run directly with npx:

```bash
npx @loopsense/mcp
```

## MCP Configuration

**Claude Code** (one-liner):

```bash
claude mcp add loopsense -e GITHUB_TOKEN=ghp_yourtoken -- npx -y @loopsense/mcp
```

Or add manually to your `claude_desktop_config.json` (or equivalent MCP host config):

```json
{
  "mcpServers": {
    "loopsense": {
      "command": "npx",
      "args": ["-y", "@loopsense/mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "loopsense": {
      "command": "loopsense",
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

## Environment Variables

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | GitHub personal access token for CI polling |

## Tools

### `watch_ci`

Watch a GitHub Actions workflow run. Polls every 30 seconds and emits events on status changes.

```json
{
  "owner": "acme",
  "repo": "api",
  "branch": "main",
  "action_id": "deploy-2024-01"
}
```

### `watch_process`

Spawn a local process and capture its output and exit code.

```json
{
  "command": "npm",
  "args": ["test"],
  "cwd": "/path/to/project",
  "action_id": "run-tests"
}
```

### `watch_file`

Watch a file or directory for changes.

```json
{
  "path": "/path/to/dir",
  "pattern": "**/*.ts",
  "action_id": "file-changes"
}
```

### `watch_url`

Poll an HTTP endpoint and detect status or body changes.

```json
{
  "url": "https://api.example.com/health",
  "interval": 15,
  "expect": {
    "status": 200,
    "body_contains": "\"status\":\"ok\""
  }
}
```

### `watch_webhook`

Start a local HTTP server to receive webhook payloads.

```json
{
  "source_type": "vercel",
  "port": 9876
}
```

Configure your webhook sender to POST to `http://localhost:9876`.

### `check_consequences`

Get events for a specific action or all recent events.

```json
{
  "action_id": "deploy-2024-01"
}
```

### `list_watches`

List all active watchers.

### `cancel_watch`

Stop a watcher by ID.

```json
{
  "watch_id": "uuid-here"
}
```

### `poll_events`

Get events since a timestamp (fallback for clients without notification support).

```json
{
  "since": "2024-01-01T00:00:00.000Z"
}
```

## Resources

LoopSense exposes two MCP resources that update reactively:

- `loopsense://timeline/recent` — last 100 events across all watches
- `loopsense://watches/active` — all currently active watches
- `loopsense://consequences/{action_id}` — events for a specific action

## Usage Example

An agent workflow might look like:

1. Agent pushes code to a branch
2. Agent calls `watch_ci` with `action_id: "my-pr-123"`
3. LoopSense polls GitHub Actions every 30 seconds
4. When CI completes, agent calls `check_consequences` with `action_id: "my-pr-123"`
5. Agent sees the test failures and fixes them

## Data Storage

Events and watch records are persisted to `~/.loopsense/events.db` (SQLite). Active watches are resumed automatically on server restart.

## Development

```bash
git clone https://github.com/jarvisassistantux/loopsense
cd loopsense
npm install
npm run dev       # run in dev mode (tsx)
npm run build     # compile with tsup
npm run typecheck # TypeScript check
npm test          # run tests
```

## License

MIT
