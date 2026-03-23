import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  insertWatch,
  getActiveWatches,
  deactivateWatch,
  getEventsByActionId,
  getRecentEvents,
  getEventsSince,
} from './store/db.js';
import { WatcherRegistry } from './watchers/registry.js';
import { GithubCiWatcher } from './watchers/github-ci.js';
import { ProcessWatcher } from './watchers/process.js';
import { FileWatcher } from './watchers/file.js';
import { HttpWatcher } from './watchers/http.js';
import { WebhookWatcher } from './watchers/webhook.js';
import { createNotifyFn } from './router/notify.js';
import type {
  GithubCiConfig,
  ProcessConfig,
  FileConfig,
  HttpConfig,
  WebhookConfig,
  WatchRecord,
} from './types.js';

export class LoopSenseServer {
  private server: Server;
  private registry: WatcherRegistry;

  constructor() {
    this.server = new Server(
      { name: 'loopsense', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    this.registry = new WatcherRegistry((_event) => {
      // Placeholder — replaced after server is ready
    });

    this.setupTools();
    this.setupResources();
  }

  private setupTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'watch_ci',
          description: 'Watch a GitHub Actions workflow run and emit events on status changes',
          inputSchema: {
            type: 'object',
            properties: {
              owner: { type: 'string', description: 'GitHub repo owner' },
              repo: { type: 'string', description: 'GitHub repo name' },
              branch: { type: 'string', description: 'Branch to watch (optional)' },
              run_id: { type: 'number', description: 'Specific run ID to watch (optional)' },
              action_id: { type: 'string', description: 'ID to associate events with an agent action' },
            },
            required: ['owner', 'repo'],
          },
        },
        {
          name: 'watch_process',
          description: 'Spawn and monitor a local process, capturing stdout/stderr and exit code',
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to run' },
              args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
              cwd: { type: 'string', description: 'Working directory (optional)' },
              action_id: { type: 'string', description: 'Link events to an agent action' },
            },
            required: ['command'],
          },
        },
        {
          name: 'watch_file',
          description: 'Watch a file or directory for changes using chokidar',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File or directory path to watch' },
              pattern: { type: 'string', description: 'Glob pattern filter (optional)' },
              action_id: { type: 'string', description: 'Link events to an agent action' },
            },
            required: ['path'],
          },
        },
        {
          name: 'watch_url',
          description: 'Poll an HTTP endpoint and emit events when status or body changes',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to poll' },
              interval: { type: 'number', description: 'Poll interval in seconds (default: 30)' },
              expect: {
                type: 'object',
                properties: {
                  status: { type: 'number' },
                  body_contains: { type: 'string' },
                },
              },
              action_id: { type: 'string', description: 'Link events to an agent action' },
            },
            required: ['url'],
          },
        },
        {
          name: 'watch_webhook',
          description: 'Start an HTTP server to receive incoming webhooks',
          inputSchema: {
            type: 'object',
            properties: {
              source_type: { type: 'string', description: 'Label for the webhook source (e.g. "github", "vercel")' },
              port: { type: 'number', description: 'Port to listen on (default: 9876)' },
              filter: { type: 'object', description: 'Optional filter criteria' },
              action_id: { type: 'string', description: 'Link events to an agent action' },
            },
            required: ['source_type'],
          },
        },
        {
          name: 'check_consequences',
          description: 'Get events associated with an agent action, or all recent events',
          inputSchema: {
            type: 'object',
            properties: {
              action_id: { type: 'string', description: 'Action ID to filter by (optional — omit for all recent)' },
            },
          },
        },
        {
          name: 'list_watches',
          description: 'List all active watchers',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'cancel_watch',
          description: 'Stop and remove a watcher',
          inputSchema: {
            type: 'object',
            properties: {
              watch_id: { type: 'string', description: 'Watch ID to cancel' },
            },
            required: ['watch_id'],
          },
        },
        {
          name: 'poll_events',
          description: 'Get new events since a timestamp (push notification fallback)',
          inputSchema: {
            type: 'object',
            properties: {
              since: { type: 'string', description: 'ISO 8601 timestamp — returns events after this time' },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'watch_ci': return this.handleWatchCi(args ?? {});
        case 'watch_process': return this.handleWatchProcess(args ?? {});
        case 'watch_file': return this.handleWatchFile(args ?? {});
        case 'watch_url': return this.handleWatchUrl(args ?? {});
        case 'watch_webhook': return this.handleWatchWebhook(args ?? {});
        case 'check_consequences': return this.handleCheckConsequences(args ?? {});
        case 'list_watches': return this.handleListWatches();
        case 'cancel_watch': return this.handleCancelWatch(args ?? {});
        case 'poll_events': return this.handlePollEvents(args ?? {});
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private setupResources(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'loopsense://watches/active',
          name: 'Active Watches',
          description: 'All currently active watchers',
          mimeType: 'application/json',
        },
        {
          uri: 'loopsense://timeline/recent',
          name: 'Recent Timeline',
          description: 'Last 100 events across all watches',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'loopsense://watches/active') {
        const watches = getActiveWatches();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(watches, null, 2),
          }],
        };
      }

      if (uri === 'loopsense://timeline/recent') {
        const events = getRecentEvents(100);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(events, null, 2),
          }],
        };
      }

      const consequencesMatch = uri.match(/^loopsense:\/\/consequences\/(.+)$/);
      if (consequencesMatch) {
        const action_id = consequencesMatch[1];
        const events = getEventsByActionId(action_id);
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(events, null, 2),
          }],
        };
      }

      throw new Error(`Unknown resource URI: ${uri}`);
    });
  }

  private async handleWatchCi(args: Record<string, unknown>) {
    const schema = z.object({
      owner: z.string(),
      repo: z.string(),
      branch: z.string().optional(),
      run_id: z.number().optional(),
      action_id: z.string().optional(),
    });
    const parsed = schema.parse(args);
    const id = uuidv4();
    const now = new Date().toISOString();

    const config: GithubCiConfig = { kind: 'github_ci', ...parsed };
    const watch: WatchRecord = {
      id,
      kind: 'github_ci',
      config,
      action_id: parsed.action_id ?? null,
      created_at: now,
      active: true,
      last_poll_at: null,
    };

    insertWatch(watch);
    const watcher = new GithubCiWatcher(id, parsed.action_id ?? null, this.registry.getNotifyFn(), config);
    this.registry.register(watcher);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ watch_id: id, status: 'watching', repo: `${parsed.owner}/${parsed.repo}` }),
      }],
    };
  }

  private async handleWatchProcess(args: Record<string, unknown>) {
    const schema = z.object({
      command: z.string(),
      args: z.array(z.string()).default([]),
      cwd: z.string().optional(),
      action_id: z.string().optional(),
    });
    const parsed = schema.parse(args);
    const id = uuidv4();
    const now = new Date().toISOString();

    const config: ProcessConfig = {
      kind: 'process',
      command: parsed.command,
      args: parsed.args,
      cwd: parsed.cwd,
    };
    const watch: WatchRecord = {
      id,
      kind: 'process',
      config,
      action_id: parsed.action_id ?? null,
      created_at: now,
      active: true,
      last_poll_at: null,
    };

    insertWatch(watch);
    const watcher = new ProcessWatcher(id, parsed.action_id ?? null, this.registry.getNotifyFn(), config);
    this.registry.register(watcher);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ watch_id: id, status: 'running', command: parsed.command }),
      }],
    };
  }

  private async handleWatchFile(args: Record<string, unknown>) {
    const schema = z.object({
      path: z.string(),
      pattern: z.string().optional(),
      action_id: z.string().optional(),
    });
    const parsed = schema.parse(args);
    const id = uuidv4();
    const now = new Date().toISOString();

    const config: FileConfig = { kind: 'file', path: parsed.path, pattern: parsed.pattern };
    const watch: WatchRecord = {
      id,
      kind: 'file',
      config,
      action_id: parsed.action_id ?? null,
      created_at: now,
      active: true,
      last_poll_at: null,
    };

    insertWatch(watch);
    const watcher = new FileWatcher(id, parsed.action_id ?? null, this.registry.getNotifyFn(), config);
    this.registry.register(watcher);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ watch_id: id, status: 'watching', path: parsed.path }),
      }],
    };
  }

  private async handleWatchUrl(args: Record<string, unknown>) {
    const schema = z.object({
      url: z.string(),
      interval: z.number().optional(),
      method: z.string().optional(),
      expect: z.object({
        status: z.number().optional(),
        body_contains: z.string().optional(),
      }).optional(),
      action_id: z.string().optional(),
    });
    const parsed = schema.parse(args);
    const id = uuidv4();
    const now = new Date().toISOString();

    const config: HttpConfig = { kind: 'http', ...parsed };
    const watch: WatchRecord = {
      id,
      kind: 'http',
      config,
      action_id: parsed.action_id ?? null,
      created_at: now,
      active: true,
      last_poll_at: null,
    };

    insertWatch(watch);
    const watcher = new HttpWatcher(id, parsed.action_id ?? null, this.registry.getNotifyFn(), config);
    this.registry.register(watcher);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ watch_id: id, status: 'polling', url: parsed.url }),
      }],
    };
  }

  private async handleWatchWebhook(args: Record<string, unknown>) {
    const schema = z.object({
      source_type: z.string(),
      port: z.number().optional(),
      filter: z.record(z.unknown()).optional(),
      action_id: z.string().optional(),
    });
    const parsed = schema.parse(args);
    const id = uuidv4();
    const now = new Date().toISOString();

    const config: WebhookConfig = { kind: 'webhook', ...parsed };
    const watch: WatchRecord = {
      id,
      kind: 'webhook',
      config,
      action_id: parsed.action_id ?? null,
      created_at: now,
      active: true,
      last_poll_at: null,
    };

    insertWatch(watch);
    const watcher = new WebhookWatcher(id, parsed.action_id ?? null, this.registry.getNotifyFn(), config);
    this.registry.register(watcher);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ watch_id: id, status: 'listening', port: parsed.port ?? 9876 }),
      }],
    };
  }

  private async handleCheckConsequences(args: Record<string, unknown>) {
    const schema = z.object({ action_id: z.string().optional() });
    const parsed = schema.parse(args);

    const events = parsed.action_id
      ? getEventsByActionId(parsed.action_id)
      : getRecentEvents(50);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(events, null, 2),
      }],
    };
  }

  private async handleListWatches() {
    const watches = this.registry.list();
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(watches, null, 2),
      }],
    };
  }

  private async handleCancelWatch(args: Record<string, unknown>) {
    const schema = z.object({ watch_id: z.string() });
    const { watch_id } = schema.parse(args);

    const cancelled = this.registry.cancel(watch_id);
    if (cancelled) {
      deactivateWatch(watch_id);
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ watch_id, cancelled }),
      }],
    };
  }

  private async handlePollEvents(args: Record<string, unknown>) {
    const schema = z.object({ since: z.string().optional() });
    const parsed = schema.parse(args);

    const events = parsed.since
      ? getEventsSince(parsed.since)
      : getRecentEvents(100);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(events, null, 2),
      }],
    };
  }

  async start(): Promise<void> {
    // Wire up the real notify function now that server is ready
    this.registry.setNotifyFn(createNotifyFn(this.server));

    // Restart recovery: re-instantiate active watches from DB
    const activeWatches = getActiveWatches();
    for (const watch of activeWatches) {
      const notifyFn = this.registry.getNotifyFn();
      let watcher;
      switch (watch.kind) {
        case 'github_ci':
          watcher = new GithubCiWatcher(watch.id, watch.action_id, notifyFn, watch.config as GithubCiConfig);
          break;
        case 'process':
          // Don't re-spawn processes after restart — the original process is gone
          deactivateWatch(watch.id);
          break;
        case 'file':
          watcher = new FileWatcher(watch.id, watch.action_id, notifyFn, watch.config as FileConfig);
          break;
        case 'http':
          watcher = new HttpWatcher(watch.id, watch.action_id, notifyFn, watch.config as HttpConfig);
          break;
        case 'webhook':
          watcher = new WebhookWatcher(watch.id, watch.action_id, notifyFn, watch.config as WebhookConfig);
          break;
      }
      if (watcher) this.registry.register(watcher);
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    this.registry.stopAll();
    await this.server.close();
  }
}
