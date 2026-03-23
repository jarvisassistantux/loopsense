export type Severity = 'info' | 'warning' | 'error' | 'success';
export type EventSource = 'github_ci' | 'process' | 'file' | 'http' | 'webhook';
export type WatchKind = 'github_ci' | 'process' | 'file' | 'http' | 'webhook';

export interface LoopSenseEvent {
  id: string;
  action_id: string | null;
  watch_id: string | null;
  source: EventSource;
  event_type: string;
  timestamp: string; // ISO 8601
  summary: string;
  detail: Record<string, unknown>;
  severity: Severity;
  resolved: boolean;
  notified: boolean;
}

export interface WatchRecord {
  id: string;
  kind: WatchKind;
  config: WatchConfig;
  action_id: string | null;
  created_at: string;
  active: boolean;
  last_poll_at: string | null;
}

// Discriminated union of watch configs
export type WatchConfig =
  | GithubCiConfig
  | ProcessConfig
  | FileConfig
  | HttpConfig
  | WebhookConfig;

export interface GithubCiConfig {
  kind: 'github_ci';
  owner: string;
  repo: string;
  branch?: string;
  run_id?: number;
  github_token?: string;
}

export interface ProcessConfig {
  kind: 'process';
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface FileConfig {
  kind: 'file';
  path: string;
  pattern?: string;
}

export interface HttpConfig {
  kind: 'http';
  url: string;
  interval?: number; // seconds, default 30
  method?: string;
  expect?: {
    status?: number;
    body_contains?: string;
  };
}

export interface WebhookConfig {
  kind: 'webhook';
  source_type: string;
  port?: number; // default 9876
  filter?: Record<string, unknown>;
}

export interface EventRow {
  id: string;
  action_id: string | null;
  watch_id: string | null;
  source: string;
  event_type: string;
  timestamp: string;
  summary: string;
  detail: string; // JSON string
  severity: string;
  resolved: number;
  notified: number;
}

export interface WatchRow {
  id: string;
  kind: string;
  config: string; // JSON string
  action_id: string | null;
  created_at: string;
  active: number;
  last_poll_at: string | null;
}
