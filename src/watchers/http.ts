import { BaseWatcher, type NotifyFn } from './base.js';
import type { HttpConfig, EventSource } from '../types.js';

export class HttpWatcher extends BaseWatcher {
  readonly source: EventSource = 'http';
  private config: HttpConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastStatus: number | null = null;
  private lastBody: string | null = null;

  constructor(id: string, action_id: string | null, notify: NotifyFn, config: HttpConfig) {
    super(id, action_id, notify);
    this.config = config;
  }

  start(): void {
    this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    const interval = (this.config.interval ?? 30) * 1000;
    if (!this.stopped) {
      this.timer = setTimeout(() => this.poll(), interval);
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(this.config.url, {
        method: this.config.method ?? 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const body = await response.text();
      const status = response.status;

      const statusChanged = status !== this.lastStatus;
      const bodyChanged = body !== this.lastBody;

      if (statusChanged || bodyChanged) {
        this.lastStatus = status;
        this.lastBody = body;

        const expectedStatus = this.config.expect?.status;
        const bodyContains = this.config.expect?.body_contains;

        let severity: 'info' | 'success' | 'error' | 'warning' = 'info';
        let eventType = 'http.changed';

        if (expectedStatus && status !== expectedStatus) {
          severity = 'error';
          eventType = 'http.unexpected_status';
        } else if (bodyContains && !body.includes(bodyContains)) {
          severity = 'warning';
          eventType = 'http.unexpected_body';
        } else if (status >= 200 && status < 300) {
          severity = 'info';
          eventType = 'http.ok';
        } else if (status >= 500) {
          severity = 'error';
          eventType = 'http.server_error';
        } else if (status >= 400) {
          severity = 'warning';
          eventType = 'http.client_error';
        }

        this.emit({
          event_type: eventType,
          summary: `HTTP ${this.config.url} → ${status}${bodyContains && !body.includes(bodyContains) ? ' (missing expected content)' : ''}`,
          detail: {
            url: this.config.url,
            status,
            body_preview: body.slice(0, 500),
            status_changed: statusChanged,
            body_changed: bodyChanged,
          },
          severity,
        });
      }
    } catch (err) {
      if (this.stopped) return;
      this.emit({
        event_type: 'http.error',
        summary: `HTTP poll error for ${this.config.url}: ${err instanceof Error ? err.message : String(err)}`,
        detail: { url: this.config.url, error: String(err) },
        severity: 'error',
      });
    }
    this.scheduleNext();
  }
}
