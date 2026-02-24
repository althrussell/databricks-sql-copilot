/**
 * Simple counting semaphore for AI call concurrency control.
 *
 * Limits concurrent ai_query() calls to avoid 429 rate limit errors.
 * Databricks Foundation Model APIs have per-minute token limits.
 */

export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    this.permits = maxConcurrency;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  /**
   * Execute a function with semaphore-controlled concurrency.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export const aiSemaphore = new Semaphore(2);
