import path from 'path';
import PQueue from 'p-queue';
import { DownloadSource, DownloadStatus } from '../common/types';
import {
  BeamerFile,
  localFileFor,
  prepareBeamerDir,
  recordDownloaded,
} from './beamerDir';
import {
  UnreachableDownloadError,
  downloadFile,
  toDownloadError,
} from './download';
import Wave from './wave';

const STATUS_THROTTLE_MS = 100;

type DownloadRequest = {
  dir: string;
  file: BeamerFile;
  beamerId: string;
  label: string;
};

type Job = {
  key: string;
  request: DownloadRequest;
  started: boolean;
};

const keyOf = (dir: string, name: string) => path.join(dir, name);

type Hooks = {
  sendStatus: (status: DownloadStatus) => void;
  onDownloaded: (beamerId: string) => void;
};

class Downloads {
  private readonly wave = new Wave();

  private readonly queues = new Map<string, PQueue>();

  private readonly jobs = new Map<string, Job>();

  private controller = new AbortController();

  private hooks: Hooks = { sendStatus: () => {}, onDownloaded: () => {} };

  private lastSentAt = 0;

  init(hooks: Hooks) {
    this.hooks = hooks;
  }

  isPending(dir: string, name: string) {
    return this.jobs.has(keyOf(dir, name));
  }

  enqueue(dir: string, files: BeamerFile[], beamerId: string, label: string) {
    const queue = this.queueFor(beamerId);
    let added = 0;
    files.forEach((file) => {
      const key = keyOf(dir, file.name);
      if (this.jobs.has(key)) {
        return;
      }
      const job: Job = {
        key,
        request: { dir, file, beamerId, label },
        started: false,
      };
      this.jobs.set(key, job);
      this.wave.add(file.size);
      added += 1;
      queue.add(() => this.run(job)).catch(() => {});
    });
    if (added > 0) {
      this.sendStatus(true);
    }
  }

  cancel() {
    if (this.jobs.size === 0) {
      return;
    }
    this.controller.abort();
    this.controller = new AbortController();
    this.queues.forEach((queue) => queue.clear());
    this.jobs.forEach((job) => {
      if (!job.started) {
        this.jobs.delete(job.key);
      }
    });
    this.wave.cancel();
    this.finishWave();
  }

  private queueFor(beamerId: string) {
    let queue = this.queues.get(beamerId);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.queues.set(beamerId, queue);
    }
    return queue;
  }

  private async run(job: Job) {
    if (this.jobs.get(job.key) !== job) {
      return; // dropped while it waited
    }
    job.started = true;
    const { signal } = this.controller;
    const { dir, file, beamerId, label } = job.request;
    try {
      await prepareBeamerDir(dir, label);
      const local = await localFileFor(dir, file);
      if (!local.complete) {
        await downloadFile(file.url, path.join(dir, local.name), {
          expectedSize: file.size,
          signal,
          onStart: (written) => {
            this.wave.start(job.key, written);
            this.sendStatus(true);
          },
          onChunk: (written) => {
            this.wave.setWritten(job.key, written);
            this.sendStatus();
          },
          onAttempt: (attempt) => {
            this.wave.setAttempt(job.key, attempt);
            this.sendStatus();
          },
        });
      }
      await recordDownloaded(dir, file);
      this.wave.succeeded(job.key, file.size);
      this.hooks.onDownloaded(beamerId);
    } catch (error) {
      if (signal.aborted) {
        this.wave.stopped(job.key);
      } else {
        const failure = toDownloadError(error);
        this.fail(job, failure.message);
        if (failure instanceof UnreachableDownloadError) {
          this.dropWaiting(beamerId, failure.message);
        }
      }
    } finally {
      if (this.jobs.get(job.key) === job) {
        this.jobs.delete(job.key);
      }
      this.sendStatus(true);
      this.finishWave();
    }
  }

  private dropWaiting(beamerId: string, reason: string) {
    this.queues.get(beamerId)?.clear();
    this.jobs.forEach((job) => {
      if (!job.started && job.request.beamerId === beamerId) {
        this.jobs.delete(job.key);
        this.fail(job, reason);
      }
    });
  }

  private fail(job: Job, reason: string) {
    this.wave.failed(job.key, {
      label: job.request.label,
      fileName: job.request.file.name,
      reason,
    });
  }

  private finishWave() {
    if (this.jobs.size > 0) {
      return;
    }
    const terminal = this.wave.terminalStatus();
    if (terminal) {
      this.hooks.sendStatus(terminal);
    }
    this.wave.reset();
  }

  private sendStatus(force = false) {
    const now = Date.now();
    if (!force && now - this.lastSentAt < STATUS_THROTTLE_MS) {
      return;
    }
    if (this.jobs.size === 0) {
      return;
    }
    this.lastSentAt = now;

    const jobs = [...this.jobs.values()].sort(
      (a, b) => Number(b.started) - Number(a.started),
    );
    const sources: DownloadSource[] = [];
    const seen = new Set<string>();
    jobs.forEach(({ request: { beamerId, label } }) => {
      if (!seen.has(beamerId)) {
        seen.add(beamerId);
        sources.push({ beamerId, label });
      }
    });

    this.hooks.sendStatus({
      status: 'downloading',
      progress: this.wave.progress(),
      sources,
      filesDone: this.wave.doneFiles,
      totalFiles: this.wave.totalFiles,
      failedCount: this.wave.failures.size,
      attempt: this.wave.attempt(),
    });
  }
}

const downloads = new Downloads();

export function initDownloadQueue(hooks: Hooks) {
  downloads.init(hooks);
}

export const isDownloadPending = (dir: string, name: string) =>
  downloads.isPending(dir, name);

export function cancelDownloads() {
  downloads.cancel();
}

export function enqueueDownload(
  dir: string,
  files: BeamerFile[],
  beamerId: string,
  label: string,
) {
  downloads.enqueue(dir, files, beamerId, label);
}
