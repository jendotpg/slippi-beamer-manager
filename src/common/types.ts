export type BeamerPort = {
  port: number;
  charId: number | null;
  costume: number;
  char: string;
  nametag: string;
};

export type BeamerGame = {
  live: boolean;
  ports: BeamerPort[];
};

// 'unknown' is reserved for beamers that have not reported
export type BeamerHealth = 'ok' | 'starting' | 'warn' | 'error' | 'unknown';

export type Beamer = {
  address: string;
  host: string;
  beamerId: string;
  beamerName: string;
  firmwareVersion?: string;
  replayCount?: number;
  replayCap?: number;
  health: BeamerHealth;
  warnings: string[];
  secsSincePortChange?: number;
  secsSinceGameStart?: number;
  game: BeamerGame | null;
};

export type BeamerLocal = {
  downloaded: number;
  wanted: number;
  kept: number; // older replays kept by "Keep old replays" setting
};

export type LabeledBeamer = Beamer & {
  label: string;
  subscribed: boolean;
  local: BeamerLocal | null;
};

export type BeamerFleet = {
  beamers: LabeledBeamer[];
  browsing: boolean;
  error: string;
  ghostBeamerErrors: string[];
  keepOldReplays: boolean;
};

export type KeepOldReplays = {
  on: boolean;
  count: number;
};

export type RequestFailure = {
  label: string;
  fileName?: string;
  reason: string;
};

export type DownloadSource = {
  beamerId: string;
  label: string;
};

export type DownloadStatus =
  | { status: 'idle' }
  | {
      status: 'downloading';
      progress: number;
      sources: DownloadSource[];
      filesDone: number;
      totalFiles: number;
      failedCount: number;
      attempt?: number;
    }
  | { status: 'error'; failedFiles: RequestFailure[] }
  | { status: 'cancelled'; filesDone: number; totalFiles: number }
  | { status: 'success' };

export type ReplaysSize = {
  files: number;
  bytes: number;
};
