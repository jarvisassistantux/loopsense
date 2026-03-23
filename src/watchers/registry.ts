import type { BaseWatcher, NotifyFn } from './base.js';
import type { LoopSenseEvent } from '../types.js';

export class WatcherRegistry {
  private watchers = new Map<string, BaseWatcher>();
  private notifyFn: NotifyFn;

  constructor(notifyFn: NotifyFn) {
    this.notifyFn = notifyFn;
  }

  setNotifyFn(fn: NotifyFn): void {
    this.notifyFn = fn;
  }

  getNotifyFn(): NotifyFn {
    return (event: LoopSenseEvent) => this.notifyFn(event);
  }

  register(watcher: BaseWatcher): void {
    this.watchers.set(watcher.id, watcher);
    watcher.start();
  }

  cancel(id: string): boolean {
    const watcher = this.watchers.get(id);
    if (!watcher) return false;
    watcher.stop();
    this.watchers.delete(id);
    return true;
  }

  stopAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.stop();
    }
    this.watchers.clear();
  }

  list(): Array<{ id: string; source: string; action_id: string | null }> {
    return Array.from(this.watchers.values()).map(w => ({
      id: w.id,
      source: w.source,
      action_id: w.action_id,
    }));
  }

  has(id: string): boolean {
    return this.watchers.has(id);
  }
}
