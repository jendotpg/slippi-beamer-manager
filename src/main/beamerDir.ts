import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import path from 'path';
import { KeepOldReplays, ReplaysSize } from '../common/types';

const CONTEXT = 'context.json';

export type BeamerFile = { name: string; size?: number; url: string };

type DownloadedReplay = { name: string; size?: number };

type BeamerContext = {
  label: string;
  hidden?: true;
  downloaded: DownloadedReplay[];
};

function parseContext(text: string): BeamerContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const downloaded = Array.isArray(record.downloaded)
    ? record.downloaded.flatMap((entry: unknown): DownloadedReplay[] => {
        if (!entry || typeof entry !== 'object') {
          return [];
        }
        const { name, size } = entry as Record<string, unknown>;
        if (typeof name !== 'string' || !name) {
          return [];
        }
        return [
          Number.isInteger(size) ? { name, size: size as number } : { name },
        ];
      })
    : [];
  return {
    label: typeof record.label === 'string' ? record.label : '',
    ...(record.hidden === true ? { hidden: true as const } : {}),
    downloaded,
  };
}

function serializeContext(context: BeamerContext) {
  return `${JSON.stringify(context, null, 2)}\n`;
}

const contextPath = (dir: string) => path.join(dir, CONTEXT);

const sameReplay = (a: { name: string; size?: number }, b: DownloadedReplay) =>
  a.name === b.name && (a.size == null || b.size == null || a.size === b.size);

const contexts = new Map<string, BeamerContext>();
const writes = new Map<string, Promise<unknown>>();

export function forgetBeamerContexts() {
  contexts.clear();
}

async function loadContext(dir: string): Promise<BeamerContext | null> {
  let text;
  try {
    text = await readFile(contextPath(dir), 'utf8');
  } catch {
    contexts.delete(dir);
    return null;
  }
  const cached = contexts.get(dir);
  if (cached && serializeContext(cached) === text) {
    return cached;
  }
  const context = parseContext(text);
  contexts.set(dir, context);
  return context;
}

function updateContext(
  dir: string,
  change: (context: BeamerContext) => BeamerContext,
  create?: { label: string },
): Promise<BeamerContext | null> {
  const previous = writes.get(dir) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      let context = await loadContext(dir);
      if (!context) {
        if (!create) {
          return null;
        }
        await mkdir(dir, { recursive: true });
        context = { label: create.label, downloaded: [] };
        contexts.delete(dir); // force the first write
      }
      const updated = change(context);
      if (
        contexts.get(dir) === context &&
        serializeContext(updated) === serializeContext(context)
      ) {
        return context;
      }
      const tmp = `${contextPath(dir)}.tmp`;
      try {
        await writeFile(tmp, serializeContext(updated));
        await rename(tmp, contextPath(dir));
      } catch (e) {
        contexts.delete(dir);
        throw e;
      }
      contexts.set(dir, updated);
      return updated;
    });
  writes.set(dir, next);
  next
    .finally(() => {
      if (writes.get(dir) === next) {
        writes.delete(dir);
      }
    })
    .catch(() => {});
  return next;
}

export function readBeamerContext(dir: string) {
  return updateContext(dir, (context) => context);
}

export async function prepareBeamerDir(dir: string, label: string) {
  await updateContext(dir, (context) => ({ ...context, label }), { label });
}

export async function setBeamerLabel(dir: string, label: string) {
  await updateContext(dir, (context) => ({ ...context, label }));
}

export async function setBeamerHidden(dir: string, hidden: boolean) {
  await updateContext(dir, ({ label, downloaded }) =>
    hidden ? { label, hidden: true, downloaded } : { label, downloaded },
  );
}

export function hideBeamerDirSync(dir: string) {
  const file = contextPath(dir);
  if (!existsSync(file)) {
    return;
  }
  const context = parseContext(readFileSync(file, 'utf8'));
  if (context.hidden) {
    return;
  }
  const tmp = `${file}.quit.tmp`;
  writeFileSync(
    tmp,
    serializeContext({
      label: context.label,
      hidden: true,
      downloaded: context.downloaded,
    }),
  );
  renameSync(tmp, file);
}

export async function recordDownloaded(dir: string, file: BeamerFile) {
  await updateContext(dir, (context) =>
    context.downloaded.some((entry) => sameReplay(file, entry))
      ? context
      : {
          ...context,
          downloaded: [
            ...context.downloaded,
            file.size == null
              ? { name: file.name }
              : { name: file.name, size: file.size },
          ],
        },
  );
}

export async function forgetUnserved(dir: string, files: BeamerFile[]) {
  await updateContext(dir, (context) => {
    const downloaded = context.downloaded.filter((entry) =>
      files.some((file) => sameReplay(file, entry)),
    );
    return downloaded.length === context.downloaded.length
      ? context
      : { ...context, downloaded };
  });
}

export function isDownloaded(context: BeamerContext | null, file: BeamerFile) {
  return Boolean(context?.downloaded.some((entry) => sameReplay(file, entry)));
}

function candidateName(name: string, n: number) {
  if (n === 0) {
    return name;
  }
  return name.endsWith('.slp')
    ? `${name.slice(0, -'.slp'.length)}_${n}.slp`
    : `${name}_${n}`;
}

const SUFFIXED = /_\d+\.slp$/;

async function sizeOrNull(file: string) {
  try {
    const stats = await stat(file);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

export async function localFileFor(dir: string, file: BeamerFile) {
  for (let n = 0; ; n += 1) {
    const name = candidateName(file.name, n);

    const size = await sizeOrNull(path.join(dir, name));
    if (size === null) {
      return { name, complete: false };
    }
    if (file.size == null || size === file.size) {
      return { name, complete: true };
    }
  }
}

type LocalReplay = { name: string; size: number; mtimeMs: number };

async function listDir(dir: string) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((dirent) =>
      dirent.isFile(),
    );
  } catch {
    return [];
  }
}

async function listReplays(dir: string): Promise<LocalReplay[]> {
  const replays = await Promise.all(
    (await listDir(dir))
      .filter((dirent) => dirent.name.endsWith('.slp'))
      .map(async (dirent): Promise<LocalReplay | null> => {
        try {
          const stats = await stat(path.join(dir, dirent.name));
          return {
            name: dirent.name,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          };
        } catch {
          return null; // gone between the readdir and the stat
        }
      }),
  );
  return replays.filter((replay): replay is LocalReplay => replay !== null);
}

function staleReplays(local: LocalReplay[], files: BeamerFile[]) {
  const byName = new Map(local.map((replay) => [replay.name, replay]));
  const current = new Set<string>();
  files.forEach((file) => {
    for (let n = 0; ; n += 1) {
      const replay = byName.get(candidateName(file.name, n));
      if (!replay) {
        return;
      }
      if (file.size == null || replay.size === file.size) {
        current.add(replay.name);
        return;
      }
    }
  });
  return local.filter((replay) => !current.has(replay.name));
}

async function remove(file: string) {
  try {
    await unlink(file);
  } catch {
    // rats.
  }
}

export async function pruneBeamerDir(
  dir: string,
  files: BeamerFile[],
  keepOld: KeepOldReplays,
  isPending: (name: string) => boolean,
) {
  const stale = staleReplays(await listReplays(dir), files).sort(
    (a, b) => b.mtimeMs - a.mtimeMs,
  );
  const kept = keepOld.on ? stale.slice(0, keepOld.count) : [];
  const doomed = stale.slice(kept.length);

  const served = new Set(files.map((file) => file.name));
  const servedPart = (name: string) => {
    const base = name.slice(0, -'.part'.length);
    return (
      served.has(base) ||
      (SUFFIXED.test(base) && served.has(base.replace(SUFFIXED, '.slp')))
    );
  };
  const parts = (await listDir(dir))
    .map((dirent) => dirent.name)
    .filter(
      (name) =>
        name.endsWith('.slp.part') &&
        !servedPart(name) &&
        !isPending(name.slice(0, -'.part'.length)),
    );

  await Promise.all(
    [...doomed.map((replay) => replay.name), ...parts].map((name) =>
      remove(path.join(dir, name)),
    ),
  );
  return kept.length;
}

export async function countStaleReplays(dir: string, files: BeamerFile[]) {
  return staleReplays(await listReplays(dir), files).length;
}

async function beamerDirsIn(location: string) {
  let dirents;
  try {
    dirents = await readdir(location, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = dirents
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(location, dirent.name));
  const present = await Promise.all(
    dirs.map(async (dir) => (await sizeOrNull(contextPath(dir))) !== null),
  );
  return dirs.filter((_, i) => present[i]);
}

const isReplayFile = (name: string) =>
  name.endsWith('.slp') || name.endsWith('.slp.part');

export async function measureBeamerDirs(
  location: string,
): Promise<ReplaysSize> {
  const sizes = await Promise.all(
    (await beamerDirsIn(location)).map(async (dir) =>
      Promise.all(
        (await listDir(dir))
          .filter((dirent) => isReplayFile(dirent.name))
          .map((dirent) => sizeOrNull(path.join(dir, dirent.name))),
      ),
    ),
  );
  const found = sizes.flat().filter((size): size is number => size !== null);
  return {
    files: found.length,
    bytes: found.reduce((sum, size) => sum + size, 0),
  };
}

export async function deleteBeamerReplays(location: string) {
  await Promise.all(
    (await beamerDirsIn(location)).map(async (dir) =>
      Promise.all(
        (await listDir(dir))
          .filter((dirent) => isReplayFile(dirent.name))
          .map((dirent) => remove(path.join(dir, dirent.name))),
      ),
    ),
  );
}
