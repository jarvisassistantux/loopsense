import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { BaseWatcher, type NotifyFn } from './base.js';
import type { WebhookConfig, EventSource } from '../types.js';

const DEFAULT_PORT = 9876;

export class WebhookWatcher extends BaseWatcher {
  readonly source: EventSource = 'webhook';
  private config: WebhookConfig;
  private server: ReturnType<typeof createServer> | null = null;

  constructor(id: string, action_id: string | null, notify: NotifyFn, config: WebhookConfig) {
    super(id, action_id, notify);
    this.config = config;
  }

  start(): void {
    const port = this.config.port ?? DEFAULT_PORT;

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method Not Allowed');
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        let payload: unknown = body;
        try { payload = JSON.parse(body); } catch { /* keep as string */ }

        const event_type = req.headers['x-github-event']
          ?? req.headers['x-event-type']
          ?? `${this.config.source_type}.webhook`;

        this.emit({
          event_type: String(event_type),
          summary: `Webhook received from ${this.config.source_type}: ${String(event_type)}`,
          detail: {
            source_type: this.config.source_type,
            headers: Object.fromEntries(Object.entries(req.headers)),
            payload,
          },
          severity: 'info',
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      this.emit({
        event_type: 'webhook.error',
        summary: `Webhook server failed on port ${port}: ${err.message}`,
        detail: { port, error: err.code },
        severity: 'error',
      });
    });

    this.server.listen(port, () => {
      this.emit({
        event_type: 'webhook.listening',
        summary: `Webhook listener started on port ${port}`,
        detail: { port, source_type: this.config.source_type },
        severity: 'info',
      });
    });
  }

  stop(): void {
    this.stopped = true;
    this.server?.close();
  }
}
