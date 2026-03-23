import { Octokit } from '@octokit/rest';
import { BaseWatcher, type NotifyFn } from './base.js';
import { updateWatchLastPoll, deactivateWatch } from '../store/db.js';
import type { GithubCiConfig, EventSource } from '../types.js';

const POLL_INTERVAL_MS = 30_000;
const TERMINAL_CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'skipped', 'stale', 'neutral']);

export class GithubCiWatcher extends BaseWatcher {
  readonly source: EventSource = 'github_ci';
  private config: GithubCiConfig;
  private octokit: Octokit;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pollCount = 0;
  private lastStatus: string | null = null;
  private lastConclusion: string | null = null;
  private watchedRunId: number | null = null;

  constructor(id: string, action_id: string | null, notify: NotifyFn, config: GithubCiConfig) {
    super(id, action_id, notify);
    this.config = config;
    this.octokit = new Octokit({
      auth: config.github_token ?? process.env.GITHUB_TOKEN,
    });
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
    if (this.stopped) return;
    const interval = this.pollCount < 12 ? 5_000 : POLL_INTERVAL_MS;
    this.pollCount++;
    this.timer = setTimeout(() => this.poll(), interval);
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      updateWatchLastPoll(this.id, new Date().toISOString());

      if (this.config.run_id && !this.watchedRunId) {
        this.watchedRunId = this.config.run_id;
      }

      if (this.watchedRunId) {
        await this.pollRun(this.watchedRunId);
      } else {
        await this.pollLatestRun();
      }
    } catch (err) {
      this.emit({
        event_type: 'ci.poll_error',
        summary: `Failed to poll GitHub CI: ${err instanceof Error ? err.message : String(err)}`,
        detail: { error: String(err) },
        severity: 'warning',
      });
      this.scheduleNext();
    }
  }

  private async pollLatestRun(): Promise<void> {
    const { data } = await this.octokit.actions.listWorkflowRunsForRepo({
      owner: this.config.owner,
      repo: this.config.repo,
      per_page: 1,
      ...(this.config.branch ? { branch: this.config.branch } : {}),
    });

    if (data.workflow_runs.length === 0) {
      if (this.pollCount === 0) {
        this.emit({
          event_type: 'ci.waiting',
          summary: `Waiting for CI run to appear on ${this.config.owner}/${this.config.repo}`,
          detail: { branch: this.config.branch },
          severity: 'info',
        });
      }
      this.scheduleNext();
      return;
    }

    const run = data.workflow_runs[0];
    if (!this.watchedRunId) {
      this.watchedRunId = run.id;
    }
    await this.pollRun(run.id);
  }

  private async pollRun(runId: number): Promise<void> {
    const { data: run } = await this.octokit.actions.getWorkflowRun({
      owner: this.config.owner,
      repo: this.config.repo,
      run_id: runId,
    });

    const statusChanged = run.status !== this.lastStatus || run.conclusion !== this.lastConclusion;

    if (statusChanged) {
      this.lastStatus = run.status ?? null;
      this.lastConclusion = run.conclusion ?? null;

      const isTerminal = run.status === 'completed';
      const conclusion = run.conclusion ?? 'unknown';

      let severity: 'info' | 'success' | 'error' | 'warning' = 'info';
      if (isTerminal) {
        if (conclusion === 'success') severity = 'success';
        else if (['failure', 'timed_out'].includes(conclusion)) severity = 'error';
        else severity = 'warning';
      }

      this.emit({
        event_type: isTerminal ? `ci.${conclusion}` : `ci.${run.status}`,
        summary: isTerminal
          ? `CI run #${run.run_number} ${conclusion}: ${run.name ?? run.id}`
          : `CI run #${run.run_number} is ${run.status}: ${run.name ?? run.id}`,
        detail: {
          run_id: run.id,
          run_number: run.run_number,
          name: run.name,
          status: run.status,
          conclusion: run.conclusion,
          html_url: run.html_url,
          head_sha: run.head_sha,
          head_branch: run.head_branch,
          created_at: run.created_at,
          updated_at: run.updated_at,
        },
        severity,
        resolved: isTerminal,
      });

      if (isTerminal && conclusion && TERMINAL_CONCLUSIONS.has(conclusion)) {
        deactivateWatch(this.id);
        this.stopped = true;
        return;
      }
    }

    this.scheduleNext();
  }
}
