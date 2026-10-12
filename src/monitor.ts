import { UsageSnapshot, UsageError } from "./usage";
export interface MonitorState {
  snapshot?: UsageSnapshot;
  error?: string;
  updated?: Date;
  loading: boolean;
}
export class UsageMonitor {
  state: MonitorState = { loading: false };
  private generation = 0;
  private backoffUntil = 0;
  private controller?: AbortController;
  private pending?: Promise<void>;
  constructor(private readonly changed: () => void) {}
  reset(): void {
    ++this.generation;
    this.controller?.abort();
    this.controller = undefined;
    this.pending = undefined;
    this.backoffUntil = 0;
    this.state = { loading: false };
  }
  refresh(fetcher: (signal: AbortSignal) => Promise<UsageSnapshot>): Promise<void> {
    if (this.pending) return this.pending;
    if (Date.now() < this.backoffUntil) return Promise.resolve();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.state.loading = true;
    this.changed();
    const timeout = setTimeout(() => controller.abort(), 25000);
    this.pending = (async () => {
      try {
        const snapshot = await Promise.resolve().then(() => fetcher(controller.signal));
        if (generation !== this.generation) return;
        this.state.snapshot = snapshot;
        this.state.error = undefined;
        this.state.updated = new Date();
      } catch (error) {
        if (generation !== this.generation) return;
        this.state.error = controller.signal.aborted ? "Usage request timed out. Try refreshing." : error instanceof Error ? error.message : "Usage request failed.";
        if (error instanceof UsageError) this.backoffUntil = Date.now() + error.retryAfterMs;
      } finally {
        clearTimeout(timeout);
        if (generation === this.generation) {
          this.state.loading = false;
          this.pending = undefined;
          this.controller = undefined;
          this.changed();
        }
      }
    })();
    return this.pending;
  }
}
