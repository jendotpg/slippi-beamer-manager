import { DownloadStatus, RequestFailure } from '../common/types';

type Active = { written: number; attempt: number };

// The user-visible unit of downloading: everything that's happening at once,
// across every beamer, from the first file queued until all queues go idle.
export default class Wave {
  totalFiles = 0;

  doneFiles = 0;

  private totalBytes = 0;

  private doneBytes = 0;

  private unknownSizes = 0;

  private readonly active = new Map<string, Active>();

  readonly failures = new Map<string, RequestFailure>();

  private cancelled = false;

  add(size: number | undefined) {
    this.totalFiles += 1;
    if (size != null) {
      this.totalBytes += Math.max(size, 0);
    } else {
      this.unknownSizes += 1;
    }
  }

  start(key: string, resumedFrom: number) {
    this.active.set(key, { written: resumedFrom, attempt: 1 });
  }

  setWritten(key: string, written: number) {
    const active = this.active.get(key);
    if (active) {
      active.written = written;
    }
  }

  setAttempt(key: string, attempt: number) {
    const active = this.active.get(key);
    if (active) {
      active.attempt = attempt;
    }
  }

  succeeded(key: string, size: number | undefined) {
    this.doneFiles += 1;
    this.doneBytes += Math.max(size ?? 0, 0);
    this.failures.delete(key);
    this.active.delete(key);
  }

  failed(key: string, failure: RequestFailure) {
    this.doneFiles += 1;
    this.failures.set(key, failure);
    this.active.delete(key);
  }

  stopped(key: string) {
    this.active.delete(key);
  }

  cancel() {
    this.cancelled = true;
    this.active.clear();
  }

  progress(): number {
    if (this.unknownSizes === 0 && this.totalBytes > 0) {
      let activeWritten = 0;
      this.active.forEach(({ written }) => {
        activeWritten += written;
      });
      return ((this.doneBytes + activeWritten) / this.totalBytes) * 100;
    }
    if (this.totalFiles > 0) {
      return (this.doneFiles / this.totalFiles) * 100;
    }
    return 0;
  }

  // the worst retry among the files downloading right now
  attempt(): number | undefined {
    let attempt = 1;
    this.active.forEach((active) => {
      attempt = Math.max(attempt, active.attempt);
    });
    return attempt > 1 ? attempt : undefined;
  }

  terminalStatus(): DownloadStatus | null {
    if (this.cancelled) {
      return {
        status: 'cancelled',
        filesDone: this.doneFiles,
        totalFiles: this.totalFiles,
      };
    }
    if (this.failures.size > 0) {
      return {
        status: 'error',
        failedFiles: Array.from(this.failures.values()),
      };
    }
    if (this.totalFiles > 0) {
      return { status: 'success' };
    }
    return null;
  }

  reset() {
    this.totalFiles = 0;
    this.doneFiles = 0;
    this.totalBytes = 0;
    this.doneBytes = 0;
    this.unknownSizes = 0;
    this.active.clear();
    this.failures.clear();
    this.cancelled = false;
  }
}
