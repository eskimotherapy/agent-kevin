import { FOLDERS } from '@/config';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, relative, resolve } from 'path';

// ── Path helpers ──────────────────────────────────────────────────────

/**
 * Render a path as repo-root-relative so user-facing output never leaks
 * `/Users/<name>/Documents/...` absolute paths. Paths already outside the
 * repo root are returned unchanged — better than producing a `../../foo`
 * trail.
 */
export function repoRelative(absolutePath: string): string {
  const rel = relative(FOLDERS.ROOT, absolutePath);
  return rel.startsWith('..') || rel === '' ? absolutePath : rel;
}

/**
 * Expand `~` or `~/foo` to an absolute path under the user's home directory.
 * Other paths return unchanged. `config.ts` keeps a local copy of this (the
 * "config imports stdlib only" rule blocks it from importing this module);
 * every other consumer should import from here to avoid duplication.
 */
export function expandTilde(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return path;
}

// ── Filesystem helpers ────────────────────────────────────────────────

/**
 * Atomic write: serialise to a sibling `.tmp` file, then rename. A crash
 * between write and rename leaves the previous file intact.
 */
export function writeFileAtomic(path: string, content: string | Uint8Array, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, content);
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, path);
}

/** Atomic JSON write — thin wrapper over `writeFileAtomic`. */
export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2), mode);
}
