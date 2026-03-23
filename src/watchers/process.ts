import { spawn } from 'child_process';
import { BaseWatcher, type NotifyFn } from './base.js';
import type { ProcessConfig, EventSource } from '../types.js';

const MAX_BUFFER = 10 * 1024; // 10KB rolling buffer

export class ProcessWatcher extends BaseWatcher {
  readonly source: EventSource = 'process';
  private config: ProcessConfig;
  private child: ReturnType<typeof spawn> | null = null;
  private stdout = '';
  private stderr = '';

  constructor(id: string, action_id: string | null, notify: NotifyFn, config: ProcessConfig) {
    super(id, action_id, notify);
    this.config = config;
  }

  start(): void {
    this.child = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      shell: false,
    });

    const child = this.child;

    this.emit({
      event_type: 'process.started',
      summary: `Process started: ${this.config.command} ${this.config.args.join(' ')}`,
      detail: {
        command: this.config.command,
        args: this.config.args,
        cwd: this.config.cwd,
        pid: child.pid,
      },
      severity: 'info',
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.stdout = (this.stdout + chunk.toString()).slice(-MAX_BUFFER);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-MAX_BUFFER);
    });

    child.on('close', (code) => {
      if (this.stopped) return;
      const success = code === 0;
      this.emit({
        event_type: success ? 'process.success' : 'process.failed',
        summary: `Process ${success ? 'succeeded' : `failed (exit ${code})`}: ${this.config.command}`,
        detail: {
          command: this.config.command,
          args: this.config.args,
          exit_code: code,
          stdout: this.stdout.slice(-2048),
          stderr: this.stderr.slice(-2048),
        },
        severity: success ? 'success' : 'error',
        resolved: true,
      });
      this.stopped = true;
    });

    child.on('error', (err) => {
      if (this.stopped) return;
      this.emit({
        event_type: 'process.error',
        summary: `Process error: ${err.message}`,
        detail: {
          command: this.config.command,
          error: err.message,
        },
        severity: 'error',
        resolved: true,
      });
      this.stopped = true;
    });
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
  }
}
