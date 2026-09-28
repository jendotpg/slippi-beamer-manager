import { DnsSd, DnsSdBrowse } from '@fugood/dns-sd';
import { createSocket } from 'dgram';
import os from 'os';
import path from 'path';
import sanitize from 'sanitize-filename';
import { parse as parseIpaddr } from 'ipaddr.js';
import {
  Beamer,
  BeamerFleet,
  BeamerGame,
  BeamerHealth,
  BeamerLocal,
  BeamerPort,
  DownloadStatus,
  KeepOldReplays,
  LabeledBeamer,
  ReplaysSize,
  RequestFailure,
} from '../common/types';
import {
  BeamerFile,
  countBeamerReplays,
  deleteBeamerDirs,
  forgetUnserved,
  hideBeamerDirSync,
  isDownloaded,
  measureBeamerDirs,
  pruneBeamerDir,
  readBeamerContext,
  setBeamerHidden,
  setBeamerLabel,
} from './beamerDir';
import {
  cancelDownloads,
  enqueueDownload,
  initDownloadQueue,
  isDownloadPending,
} from './downloadQueue';

const INDEX_ATTEMPTS = 3;
const INDEX_RETRY_MS = 1000;
const INDEX_TIMEOUT_MS = 5000;

const PING_FAILS_BEFORE_OFFLINE = 3;

const STATUS_POLL_MS = 10000;
const INDEX_POLL_MS = 10000;
const INDEX_POLL_OFFSET_MS = 5000;

const EVENT_GROUP = '239.255.42.1';
const EVENT_PORT = 34700;

const STATUS_TIMEOUT_MS = 4000;
const RESET_TIMEOUT_MS = 90000;
const MAX_JSON_BYTES = 1024 * 1024;

const BEAMER_SCHEMA = 1;

const BEAMER_HEALTHS: readonly BeamerHealth[] = [
  'ok',
  'starting',
  'warn',
  'error',
];

const BEAMER_EVENT_KINDS = ['game_started', 'game_finished'] as const;

type BeamerEventKind = (typeof BEAMER_EVENT_KINDS)[number];

type BeamerEvent = {
  event: BeamerEventKind;
  beamerId: string;
};

type BeamerStatusBody = {
  schema: typeof BEAMER_SCHEMA;
  station_id: string;
  station_name?: string;
  firmware_version?: string;
  replay_count?: number;
  replay_cap?: number;
  health?: BeamerHealth;
  warnings?: unknown;
  secs_since_port_change?: number;
  secs_since_game_start?: number;
  game?: unknown;
};

class BeamerSchemaError extends Error {
  firmwareVersion: string;

  stationName: string;

  constructor(stationName: string, firmwareVersion: string) {
    super(
      `Beamer ${stationName} found on ${
        firmwareVersion ? `firmware ${firmwareVersion}` : 'newer firmware'
      } - your Slippi Beamer Manager is out of date. Update Slippi Beamer Manager.`,
    );
    this.name = 'BeamerSchemaError';
    this.stationName = stationName;
    this.firmwareVersion = firmwareVersion;
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asPort(value: unknown): BeamerPort | null {
  const record = asRecord(value);
  if (!record || !Number.isInteger(record.port)) {
    return null;
  }
  return {
    port: record.port as number,
    charId:
      Number.isInteger(record.char_id) && (record.char_id as number) >= 0
        ? (record.char_id as number)
        : null,
    costume: Number.isInteger(record.costume) ? (record.costume as number) : 0,
    char: asString(record.char),
    nametag: asString(record.nametag),
  };
}

function asGame(value: unknown): BeamerGame | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.ports)) {
    return null;
  }
  const ports = (record.ports as unknown[])
    .map(asPort)
    .filter((port: BeamerPort | null): port is BeamerPort => port !== null);
  return { live: record.live === true, ports };
}

function asHealth(value: unknown): BeamerHealth {
  return BEAMER_HEALTHS.includes(value as BeamerHealth)
    ? (value as BeamerHealth)
    : 'unknown';
}

function asCount(value: unknown) {
  return Number.isInteger(value) ? (value as number) : undefined;
}

function asWarnings(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (warning): warning is string =>
          typeof warning === 'string' && warning.length > 0,
      )
    : [];
}

function beamerFromStatus(
  base: Pick<Beamer, 'address' | 'host'>,
  status: BeamerStatusBody,
): Beamer {
  return {
    ...base,
    beamerId: asString(status.station_id),
    beamerName: asString(status.station_name),
    firmwareVersion: asString(status.firmware_version) || undefined,
    replayCount: asCount(status.replay_count),
    replayCap: asCount(status.replay_cap),
    health: asHealth(status.health),
    warnings: asWarnings(status.warnings),
    secsSincePortChange: asCount(status.secs_since_port_change),
    secsSinceGameStart: asCount(status.secs_since_game_start),
    game: asGame(status.game),
  };
}

function isStatusBody(body: unknown): body is BeamerStatusBody {
  const record = asRecord(body);
  return Boolean(
    record &&
    record.schema === BEAMER_SCHEMA &&
    typeof record.station_id === 'string',
  );
}

function newerSchemaError(body: unknown) {
  const record = asRecord(body);
  if (
    !record ||
    typeof record.schema !== 'number' ||
    record.schema <= BEAMER_SCHEMA ||
    typeof record.station_id !== 'string'
  ) {
    return null;
  }
  return new BeamerSchemaError(
    asString(record.station_name) || record.station_id,
    asString(record.firmware_version),
  );
}

function parseJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new Error('That beamer sent back far more than it should have.');
  }
  if (!response.body) {
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > MAX_JSON_BYTES) {
      reader.cancel();
      throw new Error('That beamer sent back far more than it should have.');
    }
    chunks.push(value);
  }
  return parseJson(Buffer.concat(chunks));
}

function unreachableError(
  e: unknown,
  origin: string,
  timeoutMessage = `${origin} did not respond.`,
) {
  const timedOut =
    e instanceof Error &&
    (e.name === 'TimeoutError' || e.name === 'AbortError');
  return new Error(
    timedOut ? timeoutMessage : `Could not reach a Beamer at ${origin}.`,
  );
}

type StatusResult =
  { kind: 'status'; body: BeamerStatusBody } | { kind: 'unreported' };

async function getBeamerStatus(origin: string): Promise<StatusResult> {
  let response;
  try {
    response = await fetch(`${origin}/status`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
  } catch (e) {
    throw unreachableError(e, origin);
  }

  if (response.status === 503) {
    return { kind: 'unreported' };
  }
  if (!response.ok) {
    throw new Error(`${origin} answered ${response.status} for /status.`);
  }

  const body = await readJson(response);
  if (!isStatusBody(body)) {
    const schemaError = newerSchemaError(body);
    if (schemaError) {
      throw schemaError;
    }
    throw new Error(
      `${origin} did not return a status report. Is it a Beamer?`,
    );
  }
  return { kind: 'status', body };
}

async function requestBeamerReset(origin: string) {
  let response;
  try {
    response = await fetch(`${origin}/reset-beamer`, {
      method: 'POST',
      headers: { 'X-Beamer-Confirm': 'reset' },
      body: '',
      signal: AbortSignal.timeout(RESET_TIMEOUT_MS),
    });
  } catch (e) {
    throw unreachableError(
      e,
      origin,
      `${origin} did not answer the reset. Check the beamer before assuming its replays survived.`,
    );
  }

  if (response.ok) {
    return;
  }
  if (response.status === 400) {
    throw new Error(
      `${origin} refused the reset confirmation header. Is that a Beamer?`,
    );
  }
  const reported = asString(asRecord(await readJson(response))?.error);
  if (response.status === 409) {
    throw new Error(
      reported
        ? `That beamer refused: ${reported}. Nothing was erased - try again in a moment.`
        : 'That beamer is busy sending a replay, or with another action. Nothing was erased - try again in a moment.',
    );
  }
  throw new Error(
    reported || `${origin} answered ${response.status} for /reset-beamer.`,
  );
}

function addressFor(service: { addresses: string[]; port: number }) {
  const hasDots = (candidate: string) => candidate.includes('.');
  const isRoutable = (candidate: string) =>
    !candidate.startsWith('127.') && !candidate.startsWith('169.254.');

  const address =
    service.addresses.find(
      (candidate) => hasDots(candidate) && isRoutable(candidate),
    ) ??
    service.addresses.find(hasDots) ??
    service.addresses[0] ??
    '';
  if (!address) {
    return '';
  }
  const bracketed = address.includes(':') ? `[${address}]` : address;
  return service.port === 80 ? bracketed : `${bracketed}:${service.port}`;
}

type BeamerBrowseHandle = {
  stop: () => void;
};

function browseForBeamers(callbacks: {
  onFound: (base: Pick<Beamer, 'address' | 'host'>) => void;
  onLost: (host: string) => void;
  onError: (error: Error) => void;
}): BeamerBrowseHandle {
  let browser: DnsSdBrowse | null = DnsSd.search('_beamer._tcp')
    .on('serviceFound', (service) => {
      const address = addressFor(service);
      if (!address) {
        return;
      }
      callbacks.onFound({
        address,
        host: service.name,
      });
    })
    .on('serviceLost', (service) => {
      callbacks.onLost(service.name);
    })
    .on('error', (error) => {
      callbacks.onError(error);
    });

  return {
    stop: () => {
      if (browser) {
        browser.removeAllListeners();
        browser.stop();
        browser = null;
      }
    },
  };
}

function sanitizeReplayName(name: string): string {
  const base = path.basename(name);
  if (!base.endsWith('.slp') || base.startsWith('.')) {
    return '';
  }
  return base;
}

function parseBeamerEvent(buf: Buffer): BeamerEvent | null {
  const body = asRecord(parseJson(buf));
  if (!body || body.schema !== BEAMER_SCHEMA) {
    return null;
  }
  if (!BEAMER_EVENT_KINDS.includes(body.event as BeamerEventKind)) {
    return null;
  }
  if (typeof body.station_id !== 'string' || !body.station_id) {
    return null;
  }
  return {
    event: body.event as BeamerEventKind,
    beamerId: body.station_id,
  };
}

type BeamerEventsHandle = {
  stop: () => void;
};

function subscribeBeamerEvents(callbacks: {
  onEvent: (event: BeamerEvent, fromAddress: string) => void;
  onError: (error: Error) => void;
}): BeamerEventsHandle {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (error) => {
    callbacks.onError(error);
  });
  socket.on('message', (msg, rinfo) => {
    const event = parseBeamerEvent(msg);
    if (event) {
      callbacks.onEvent(event, rinfo.address);
    }
  });

  socket.bind(EVENT_PORT, () => {
    const join = (iface?: string) => {
      try {
        socket.addMembership(EVENT_GROUP, iface);
      } catch {
        // already a member on this interface, or it cannot join here
      }
    };
    join();
    Object.values(os.networkInterfaces()).forEach((ifaces) => {
      (ifaces ?? []).forEach((ni) => {
        if (ni.family === 'IPv4' && !ni.internal) {
          join(ni.address);
        }
      });
    });
  });

  return {
    stop: () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}

function toBeamerOrigin(addressOrHost: string) {
  // beamers have no TLS by design - strip https and force http
  const trimmed = addressOrHost
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Enter a Beamer address.');
  }

  let host = trimmed;
  try {
    const ipaddr = parseIpaddr(trimmed);
    host =
      ipaddr.kind() === 'ipv4' ? ipaddr.toString() : `[${ipaddr.toString()}]`;
  } catch {
    // not an ip
  }
  return `http://${host}`;
}

async function fetchIndex(origin: string) {
  let last: unknown;
  for (let i = 0; i < INDEX_ATTEMPTS; i += 1) {
    try {
      return await fetch(`${origin}/SLIPPI/`, {
        signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      });
    } catch (e) {
      last = e;
      if (i < INDEX_ATTEMPTS - 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, INDEX_RETRY_MS);
        });
      }
    }
  }
  throw last;
}

function beamerReplayUrl(url: string, origin: string): string {
  let resolved;
  try {
    resolved = new URL(url, origin);
  } catch {
    return '';
  }
  const resolvedStr = resolved.toString();
  const prefix = `${origin}/SLIPPI/`;
  return resolvedStr.startsWith(prefix) ? resolvedStr : '';
}

// newest first
async function getBeamerIndex(origin: string) {
  let response;
  try {
    response = await fetchIndex(origin);
  } catch (e) {
    throw unreachableError(e, origin);
  }
  if (!response.ok) {
    throw new Error(
      `${origin} answered ${response.status} for /SLIPPI/. Is that a Beamer?`,
    );
  }

  const index = asRecord(await readJson(response));
  const filesList = Array.isArray(index?.files) ? index.files : null;
  if (!index || !filesList) {
    throw new Error(`${origin} did not return a replay index.`);
  }
  if (index.schema !== BEAMER_SCHEMA) {
    throw new Error(
      typeof index.schema === 'number' && index.schema > BEAMER_SCHEMA
        ? "That beamer's firmware is newer than this Slippi Beamer Manager understands. Update Slippi Beamer Manager."
        : `${origin} did not return a replay index.`,
    );
  }

  const files: BeamerFile[] = [];
  filesList.forEach((entry: unknown) => {
    const file = asRecord(entry);
    if (!file || typeof file.url !== 'string' || !file.url) {
      return;
    }
    const url = beamerReplayUrl(file.url, origin);
    if (!url) {
      return; // malformed or off-origin url - skip the file
    }
    let name: string;
    try {
      const { pathname } = new URL(url);
      name = sanitizeReplayName(path.basename(decodeURIComponent(pathname)));
    } catch {
      return; // malformed percent-encoding - skip the file
    }
    if (!name) {
      return;
    }
    files.push({
      name,
      size: Number.isInteger(file.size) ? (file.size as number) : undefined,
      url,
    });
  });
  return files;
}

type Send = (channel: string, ...args: unknown[]) => void;

let send: Send = () => {};

const settings: {
  location: string;
  autoSubscribe: boolean;
  keepOld: KeepOldReplays;
} = {
  location: '',
  autoSubscribe: false,
  keepOld: { on: true, count: 10 },
};

function beamerDirIn(location: string, beamerId: string) {
  if (!beamerId) {
    throw new Error('Refusing to store replays for a beamer with no id.');
  }
  const name = sanitize(beamerId.replace(/:/g, '_'));
  if (!name) {
    throw new Error(`Could not derive a directory for ${beamerId}.`);
  }
  return path.join(location, name);
}

const beamerDirFor = (beamerId: string) =>
  beamerDirIn(settings.location, beamerId);

type BeamerBase = Pick<Beamer, 'address' | 'host'>;

const liveBeamers = {
  byId: new Map<string, Beamer>(),
  idByAddress: new Map<string, string>(), // address -> beamerId
  pingFails: new Map<string, number>(), // beamerId -> consecutive missed pings
};

const findLiveBeamerAt = (address: string) => {
  const beamerId = liveBeamers.idByAddress.get(address);
  return beamerId ? liveBeamers.byId.get(beamerId) : undefined;
};

function removeLiveBeamer(beamerId: string) {
  const removed = liveBeamers.byId.get(beamerId);
  liveBeamers.byId.delete(beamerId);
  liveBeamers.pingFails.delete(beamerId);
  if (removed && liveBeamers.idByAddress.get(removed.address) === beamerId) {
    liveBeamers.idByAddress.delete(removed.address);
  }
}

function removeLiveBeamerAt(address: string) {
  const existing = findLiveBeamerAt(address);
  if (existing) {
    removeLiveBeamer(existing.beamerId);
  }
}

function upsertLiveBeamer(beamer: Beamer) {
  if (!beamer.beamerId) {
    throw new Error('Refusing to key a beamer with no station id.');
  }
  const existing = liveBeamers.byId.get(beamer.beamerId);
  if (
    existing &&
    existing.address !== beamer.address &&
    liveBeamers.idByAddress.get(existing.address) === beamer.beamerId
  ) {
    liveBeamers.idByAddress.delete(existing.address);
  }
  const previous = findLiveBeamerAt(beamer.address);
  if (previous && previous.beamerId !== beamer.beamerId) {
    liveBeamers.byId.delete(previous.beamerId);
    liveBeamers.pingFails.delete(previous.beamerId);
  }
  liveBeamers.idByAddress.set(beamer.address, beamer.beamerId);
  liveBeamers.byId.set(beamer.beamerId, beamer);
}

function markPingMiss(beamerId: string) {
  if (liveBeamers.byId.has(beamerId)) {
    liveBeamers.pingFails.set(
      beamerId,
      (liveBeamers.pingFails.get(beamerId) ?? 0) + 1,
    );
  }
}

function markPingHit(beamerId: string) {
  liveBeamers.pingFails.delete(beamerId);
}

// a ghost is a beamer seen on mDNS that doesn't meet the HTTP API...
const ghosts = new Map<
  string, // address
  { base: BeamerBase; error?: BeamerSchemaError }
>();

const forgetBeamerAt = (address: string) => {
  ghosts.delete(address);
  removeLiveBeamerAt(address);
};

const rememberedBeamers = new Map<string, { origin: string; name: string }>();

function rememberBeamer(
  beamerId: string,
  origin: string,
  name: string | undefined,
) {
  if (!beamerId || !name) {
    return;
  }
  rememberedBeamers.set(beamerId, { origin, name });
}

const beamerLabel = (beamerId: string) =>
  rememberedBeamers.get(beamerId)?.name || beamerId;

const originFor = (beamerId: string) => {
  const beamer = liveBeamers.byId.get(beamerId);
  return beamer
    ? toBeamerOrigin(beamer.address)
    : rememberedBeamers.get(beamerId)?.origin || '';
};

const seenBeamers = new Set<string>();

const subscriptions = {
  subscribed: new Set<string>(),
  unsubscribed: new Set<string>(), // unsubscribes have session lifetimes
};

const autoSubscribeCandidate = (beamer: Beamer) =>
  settings.autoSubscribe &&
  Boolean(beamer.beamerId) &&
  !subscriptions.subscribed.has(beamer.beamerId) &&
  !subscriptions.unsubscribed.has(beamer.beamerId);

const indexes = new Map<string, BeamerFile[]>(); // newest first
const locals = new Map<string, BeamerLocal>();

const browse = {
  handle: null as BeamerBrowseHandle | null,
  error: '',
};

const listedBeamers = (): LabeledBeamer[] =>
  Array.from(liveBeamers.byId.values())
    .filter(
      (beamer) =>
        (liveBeamers.pingFails.get(beamer.beamerId) ?? 0) <
        PING_FAILS_BEFORE_OFFLINE,
    )
    .map((beamer) => ({
      ...beamer,
      subscribed: subscriptions.subscribed.has(beamer.beamerId),
      label: beamerLabel(beamer.beamerId),
      local: locals.get(beamer.beamerId) ?? null,
    }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );

export const getBeamerFleet = (): BeamerFleet => ({
  beamers: listedBeamers(),
  browsing: browse.handle !== null,
  error: browse.error,
  ghostBeamerErrors: Array.from(ghosts.values()).flatMap((ghost) =>
    ghost.error ? [ghost.error.message] : [],
  ),
  keepOldReplays: settings.keepOld.on,
});

let listedIds = new Set<string>();

function syncHidden(beamers: LabeledBeamer[]) {
  const ids = new Set(beamers.map((beamer) => beamer.beamerId));
  const setHidden = (beamerId: string, hidden: boolean) => {
    setBeamerHidden(beamerDirFor(beamerId), hidden).catch(() => {});
  };
  ids.forEach((beamerId) => {
    if (!listedIds.has(beamerId)) {
      setHidden(beamerId, false);
      processBeamerIndex(beamerId).catch(() => {});
    }
  });
  listedIds.forEach((beamerId) => {
    if (!ids.has(beamerId)) {
      setHidden(beamerId, true);
    }
  });
  listedIds = ids;
}

const sendBeamerFleet = () => {
  const fleet = getBeamerFleet();
  syncHidden(fleet.beamers);
  send('beamerFleet', fleet);
};

async function recountBeamer(beamerId: string) {
  const files = indexes.get(beamerId);
  if (!files) {
    return;
  }
  const dir = beamerDirFor(beamerId);
  const counts = await countBeamerReplays(dir, files, (name) =>
    isDownloadPending(dir, name),
  );
  locals.set(beamerId, {
    downloaded: counts.downloaded,
    wanted: counts.wanted,
    kept: settings.keepOld.on ? counts.stale : 0,
  });
  sendBeamerFleet();
}

function pruneAndRecount(beamerId: string, files: BeamerFile[]) {
  const dir = beamerDirFor(beamerId);
  return pruneBeamerDir(dir, files, settings.keepOld, (name) =>
    isDownloadPending(dir, name),
  ).then(() => recountBeamer(beamerId));
}

async function processBeamerIndex(beamerId: string) {
  const origin = originFor(beamerId);
  if (!origin) {
    return;
  }
  let files: BeamerFile[];
  try {
    files = await getBeamerIndex(origin);
  } catch {
    markPingMiss(beamerId);
    sendBeamerFleet();
    return; // unreachable or no index
  }
  markPingHit(beamerId);
  indexes.set(beamerId, files);

  const dir = beamerDirFor(beamerId);
  await forgetUnserved(dir, files);
  if (subscriptions.subscribed.has(beamerId)) {
    const context = await readBeamerContext(dir);
    const missing = files.filter(
      (file) =>
        !isDownloaded(context, file) && !isDownloadPending(dir, file.name),
    );
    if (missing.length > 0) {
      enqueueDownload(dir, missing, beamerId, beamerLabel(beamerId));
    }
  }
  await pruneAndRecount(beamerId, files);
}

function subscribe(beamerId: string) {
  subscriptions.subscribed.add(beamerId);
  subscriptions.unsubscribed.delete(beamerId);
}

const processBeamerStatus = async (base: BeamerBase) => {
  const origin = toBeamerOrigin(base.address);
  let result: StatusResult;
  try {
    result = await getBeamerStatus(origin);
  } catch (e) {
    if (e instanceof BeamerSchemaError) {
      removeLiveBeamerAt(base.address);
      ghosts.set(base.address, { base, error: e });
      return;
    }
    const known = findLiveBeamerAt(base.address);
    if (known) {
      markPingMiss(known.beamerId);
    }
    return;
  }
  const beamer =
    result.kind === 'status' ? beamerFromStatus(base, result.body) : null;

  if (!beamer || !beamer.beamerId) {
    removeLiveBeamerAt(base.address);
    ghosts.set(base.address, { base });
    return;
  }

  upsertLiveBeamer(beamer);
  markPingHit(beamer.beamerId);
  ghosts.delete(base.address);
  seenBeamers.add(beamer.beamerId);

  const label = beamer.beamerName || beamer.beamerId;
  rememberBeamer(beamer.beamerId, origin, label);
  setBeamerLabel(beamerDirFor(beamer.beamerId), label).catch(() => {});

  if (autoSubscribeCandidate(beamer)) {
    subscribe(beamer.beamerId);
  }
};

async function pollAllStatus() {
  const bases = [
    ...liveBeamers.byId.values(),
    ...Array.from(ghosts.values()).map((ghost) => ghost.base),
  ].map(({ address, host }) => ({ address, host }));
  await Promise.all(bases.map((base) => processBeamerStatus(base)));
  sendBeamerFleet();
}

async function pollAllIndex() {
  await Promise.all(
    listedBeamers().map((beamer) => processBeamerIndex(beamer.beamerId)),
  );
}

export async function refreshAllBeamers() {
  await pollAllStatus();
  await pollAllIndex();
}

function every(ms: number, poll: () => Promise<void>) {
  setInterval(() => {
    poll().catch(() => {});
  }, ms);
}

function startPolls() {
  every(STATUS_POLL_MS, pollAllStatus);
  setTimeout(() => every(INDEX_POLL_MS, pollAllIndex), INDEX_POLL_OFFSET_MS);
}

const statusRefreshInFlight = new Set<string>();

const refreshBeamerForEvent = async (beamerId: string) => {
  const beamer = liveBeamers.byId.get(beamerId);
  if (!beamer || statusRefreshInFlight.has(beamerId)) {
    return;
  }
  statusRefreshInFlight.add(beamerId);
  try {
    await processBeamerStatus({
      address: beamer.address,
      host: beamer.host,
    });
    sendBeamerFleet();
  } finally {
    statusRefreshInFlight.delete(beamerId);
  }
};

const onBeamerEvent = async (event: BeamerEvent) => {
  if (event.event === 'game_finished') {
    processBeamerIndex(event.beamerId).catch(() => {});
  }
  await refreshBeamerForEvent(event.beamerId);
};

const startBeamerEvents = () => {
  subscribeBeamerEvents({
    onEvent: (event) => {
      onBeamerEvent(event).catch(() => {});
    },
    onError: () => {
      // no live hints :( is what it is
    },
  });
};

const startBeamerBrowser = () => {
  if (browse.handle) {
    return;
  }
  browse.error = '';
  browse.handle = browseForBeamers({
    onFound: (base) => {
      const known = findLiveBeamerAt(base.address);
      if (known) {
        upsertLiveBeamer({ ...known, ...base });
      } else {
        ghosts.set(base.address, {
          base,
          error: ghosts.get(base.address)?.error,
        });
      }
      sendBeamerFleet();
      processBeamerStatus(base)
        .then(sendBeamerFleet)
        .catch(() => {
          sendBeamerFleet();
        });
    },
    onLost: (host) => {
      const sharing = [
        ...liveBeamers.byId.values(),
        ...Array.from(ghosts.values()).map((ghost) => ghost.base),
      ].filter((base) => base.host === host);
      if (sharing.length === 0) {
        return;
      }
      if (sharing.length === 1) {
        forgetBeamerAt(sharing[0].address);
        sendBeamerFleet();
        return;
      }
      Promise.all(
        sharing.map(async (base) => {
          try {
            await getBeamerStatus(toBeamerOrigin(base.address));
            const known = findLiveBeamerAt(base.address);
            if (known) {
              markPingHit(known.beamerId);
            }
          } catch {
            forgetBeamerAt(base.address);
          }
        }),
      )
        .then(sendBeamerFleet)
        .catch(() => {
          sendBeamerFleet();
        });
    },
    onError: (error) => {
      browse.error = error.message;
      sendBeamerFleet();
    },
  });
  sendBeamerFleet();
};

export async function downloadNewest(beamerId: string, maxGames: number) {
  const origin = originFor(beamerId);
  if (!origin) {
    throw new Error('That beamer is no longer advertising itself.');
  }
  let files: BeamerFile[];
  try {
    files = await getBeamerIndex(origin);
  } catch (e) {
    markPingMiss(beamerId);
    sendBeamerFleet();
    throw e;
  }
  markPingHit(beamerId);
  indexes.set(beamerId, files);
  enqueueDownload(
    beamerDirFor(beamerId),
    files.slice(0, maxGames),
    beamerId,
    beamerLabel(beamerId),
  );
  await recountBeamer(beamerId);
}

export function setBeamerSubscribed(beamerId: string, subscribed: boolean) {
  if (subscribed) {
    subscribe(beamerId);
    processBeamerIndex(beamerId).catch(() => {});
  } else {
    subscriptions.unsubscribed.add(beamerId);
    subscriptions.subscribed.delete(beamerId);
  }
  sendBeamerFleet();
}

export function setBeamersAutoSubscribe(on: boolean) {
  settings.autoSubscribe = on;
  if (on) {
    listedBeamers()
      .filter(autoSubscribeCandidate)
      .forEach((beamer) => {
        subscribe(beamer.beamerId);
        processBeamerIndex(beamer.beamerId).catch(() => {});
      });
  }
  sendBeamerFleet();
}

export function setKeepOldReplays(keepOld: KeepOldReplays) {
  settings.keepOld = keepOld;
  indexes.forEach((files, beamerId) => {
    pruneAndRecount(beamerId, files).catch(() => {});
  });
  sendBeamerFleet();
}

export function setBeamerReplaysLocation(location: string) {
  const previous = settings.location;
  if (location === previous) {
    return;
  }
  cancelDownloads();
  seenBeamers.forEach((beamerId) => {
    setBeamerHidden(beamerDirIn(previous, beamerId), true).catch(() => {});
  });
  settings.location = location;
  listedIds.forEach((beamerId) => {
    setBeamerHidden(beamerDirFor(beamerId), false).catch(() => {});
  });
  indexes.forEach((_, beamerId) => {
    if (!subscriptions.subscribed.has(beamerId)) {
      recountBeamer(beamerId).catch(() => {});
    }
  });
  subscriptions.subscribed.forEach((beamerId) => {
    processBeamerIndex(beamerId).catch(() => {});
  });
}

export const measureDownloadedReplays = (): Promise<ReplaysSize> =>
  measureBeamerDirs(settings.location);

export async function deleteDownloadedReplays() {
  cancelDownloads();
  try {
    await deleteBeamerDirs(settings.location);
  } finally {
    await Promise.all([...indexes.keys()].map((id) => recountBeamer(id)));
  }
}

export function hideSeenBeamers() {
  seenBeamers.forEach((beamerId) => {
    try {
      hideBeamerDirSync(beamerDirFor(beamerId));
    } catch {
      // process is exiting, so sometimes this just wont work
    }
  });
}

export async function refreshBeamerStatusAndIndex(beamerId: string) {
  const existing = liveBeamers.byId.get(beamerId);
  if (!existing) {
    throw new Error('That beamer is no longer advertising itself.');
  }
  await processBeamerStatus({
    address: existing.address,
    host: existing.host,
  });
  await processBeamerIndex(beamerId);
  sendBeamerFleet();
}

const runOverFleet = async (
  action: (beamer: Beamer) => Promise<void>,
): Promise<RequestFailure[]> => {
  const targets = listedBeamers();
  if (targets.length === 0) {
    throw new Error('No beamers are advertising themselves.');
  }

  const results = await Promise.allSettled(targets.map(action));

  const failures: RequestFailure[] = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const beamer = targets[i];
      failures.push({
        label: beamer.label,
        reason:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  });

  sendBeamerFleet();
  return failures;
};

export async function resetBeamer(beamerId: string) {
  const existing = liveBeamers.byId.get(beamerId);
  if (!existing) {
    throw new Error('That beamer is no longer advertising itself.');
  }
  const base = { address: existing.address, host: existing.host };
  await requestBeamerReset(toBeamerOrigin(base.address));
  await processBeamerStatus(base);
  await processBeamerIndex(beamerId);
  sendBeamerFleet();
}

export function resetAllBeamers() {
  return runOverFleet(async (beamer) => {
    const base = { address: beamer.address, host: beamer.host };
    await requestBeamerReset(toBeamerOrigin(base.address));
    await processBeamerStatus(base);
    await processBeamerIndex(beamer.beamerId);
  });
}

export function initBeamers(options: {
  send: Send;
  location: string;
  autoSubscribe: boolean;
  keepOld: KeepOldReplays;
}) {
  send = options.send;
  settings.location = options.location;
  settings.autoSubscribe = options.autoSubscribe;
  settings.keepOld = options.keepOld;
  initDownloadQueue({
    sendStatus: (status: DownloadStatus) => send('downloadStatus', status),
    onDownloaded: (beamerId) => {
      recountBeamer(beamerId).catch(() => {});
    },
  });
  try {
    startBeamerBrowser();
  } catch (e) {
    browse.error = e instanceof Error ? e.message : String(e);
  }
  startBeamerEvents();
  startPolls();
}
