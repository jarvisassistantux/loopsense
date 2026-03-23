import Database from 'better-sqlite3';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { SCHEMA_SQL } from './migrations.js';
import type { LoopSenseEvent, WatchRecord, WatchConfig, WatchKind, EventRow, WatchRow, Severity, EventSource } from '../types.js';

function getDbPath(): string {
  const dir = join(homedir(), '.loopsense');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'events.db');
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(getDbPath());
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.exec(SCHEMA_SQL);
  }
  return _db;
}

function rowToEvent(row: EventRow): LoopSenseEvent {
  return {
    id: row.id,
    action_id: row.action_id,
    watch_id: row.watch_id,
    source: row.source as EventSource,
    event_type: row.event_type,
    timestamp: row.timestamp,
    summary: row.summary,
    detail: JSON.parse(row.detail) as Record<string, unknown>,
    severity: row.severity as Severity,
    resolved: row.resolved === 1,
    notified: row.notified === 1,
  };
}

function rowToWatch(row: WatchRow): WatchRecord {
  return {
    id: row.id,
    kind: row.kind as WatchKind,
    config: JSON.parse(row.config) as WatchConfig,
    action_id: row.action_id,
    created_at: row.created_at,
    active: row.active === 1,
    last_poll_at: row.last_poll_at,
  };
}

export function insertEvent(event: LoopSenseEvent): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO events
      (id, action_id, watch_id, source, event_type, timestamp, summary, detail, severity, resolved, notified)
    VALUES
      (@id, @action_id, @watch_id, @source, @event_type, @timestamp, @summary, @detail, @severity, @resolved, @notified)
  `).run({
    ...event,
    detail: JSON.stringify(event.detail),
    resolved: event.resolved ? 1 : 0,
    notified: event.notified ? 1 : 0,
  });
}

export function getEventsByActionId(action_id: string): LoopSenseEvent[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM events WHERE action_id = ? ORDER BY timestamp DESC
  `).all(action_id) as EventRow[];
  return rows.map(rowToEvent);
}

export function getRecentEvents(limit = 100): LoopSenseEvent[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM events ORDER BY timestamp DESC LIMIT ?
  `).all(limit) as EventRow[];
  return rows.map(rowToEvent);
}

export function getEventsSince(since: string): LoopSenseEvent[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM events WHERE timestamp > ? ORDER BY timestamp ASC
  `).all(since) as EventRow[];
  return rows.map(rowToEvent);
}

export function markEventsNotified(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE events SET notified = 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function insertWatch(watch: WatchRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO watches
      (id, kind, config, action_id, created_at, active, last_poll_at)
    VALUES
      (@id, @kind, @config, @action_id, @created_at, @active, @last_poll_at)
  `).run({
    ...watch,
    config: JSON.stringify(watch.config),
    active: watch.active ? 1 : 0,
  });
}

export function getActiveWatches(): WatchRecord[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM watches WHERE active = 1`).all() as WatchRow[];
  return rows.map(rowToWatch);
}

export function getWatch(id: string): WatchRecord | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM watches WHERE id = ?`).get(id) as WatchRow | undefined;
  return row ? rowToWatch(row) : null;
}

export function deactivateWatch(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE watches SET active = 0 WHERE id = ?`).run(id);
}

export function updateWatchLastPoll(id: string, timestamp: string): void {
  const db = getDb();
  db.prepare(`UPDATE watches SET last_poll_at = ? WHERE id = ?`).run(timestamp, id);
}
