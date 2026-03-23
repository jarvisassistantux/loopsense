import { v4 as uuidv4 } from 'uuid';
import { insertEvent } from '../store/db.js';
import type { LoopSenseEvent, Severity, EventSource } from '../types.js';

export type NotifyFn = (event: LoopSenseEvent) => void;

export interface EmitOptions {
  event_type: string;
  summary: string;
  detail: Record<string, unknown>;
  severity: Severity;
  resolved?: boolean;
}

export abstract class BaseWatcher {
  readonly id: string;
  readonly action_id: string | null;
  protected notify: NotifyFn;
  protected stopped = false;

  constructor(id: string, action_id: string | null, notify: NotifyFn) {
    this.id = id;
    this.action_id = action_id;
    this.notify = notify;
  }

  abstract readonly source: EventSource;
  abstract start(): void;
  abstract stop(): void;

  protected emit(opts: EmitOptions): void {
    const event: LoopSenseEvent = {
      id: uuidv4(),
      action_id: this.action_id,
      watch_id: this.id,
      source: this.source,
      event_type: opts.event_type,
      timestamp: new Date().toISOString(),
      summary: opts.summary,
      detail: opts.detail,
      severity: opts.severity,
      resolved: opts.resolved ?? false,
      notified: false,
    };
    insertEvent(event);
    this.notify(event);
  }
}
