import chokidar from 'chokidar';
import { BaseWatcher, type NotifyFn } from './base.js';
import type { FileConfig, EventSource } from '../types.js';

export class FileWatcher extends BaseWatcher {
  readonly source: EventSource = 'file';
  private config: FileConfig;
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(id: string, action_id: string | null, notify: NotifyFn, config: FileConfig) {
    super(id, action_id, notify);
    this.config = config;
  }

  start(): void {
    const watchPath = this.config.pattern
      ? `${this.config.path}/${this.config.pattern}`
      : this.config.path;

    this.watcher = chokidar.watch(watchPath, {
      ignoreInitial: true,
      persistent: true,
    });

    this.watcher.on('add', (filePath) => this.handleEvent('file.added', filePath, 'info'));
    this.watcher.on('change', (filePath) => this.handleEvent('file.changed', filePath, 'info'));
    this.watcher.on('unlink', (filePath) => this.handleEvent('file.deleted', filePath, 'warning'));
    this.watcher.on('addDir', (dirPath) => this.handleEvent('dir.added', dirPath, 'info'));
    this.watcher.on('unlinkDir', (dirPath) => this.handleEvent('dir.deleted', dirPath, 'warning'));
    this.watcher.on('error', (err) => {
      this.emit({
        event_type: 'file.error',
        summary: `File watch error: ${err instanceof Error ? err.message : String(err)}`,
        detail: { error: String(err), path: this.config.path },
        severity: 'error',
      });
    });
  }

  private handleEvent(eventType: string, filePath: string, severity: 'info' | 'warning'): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.emit({
        event_type: eventType,
        summary: `${eventType}: ${filePath}`,
        detail: { path: filePath, watch_path: this.config.path },
        severity,
      });
    }, 500);

    this.debounceTimers.set(filePath, timer);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.watcher?.close();
  }
}
