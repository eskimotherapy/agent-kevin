#!/usr/bin/env bun
/**
 * Upgrade migration for v0.3.3 — fix the sandbox secrets-deny key.
 *
 * v0.3.0/v0.3.1 wrote the secrets deny under `sandbox.filesystem.read.denyOnly`,
 * which is NOT a real Claude Code settings key — it's the harness's internal
 * resolved shape, not the input schema — so Claude Code silently ignored it and
 * files nested under `.kevin/secrets/` stayed readable by sandboxed Bash. The
 * real key is `sandbox.filesystem.denyRead`; pointing it at the directory (no
 * glob) denies the dir and everything under it at the OS level, which also
 * sidesteps the gitignore `**`-won't-descend-into-`.kevin` dot-dir trap.
 *
 * This migration: drops the dead `filesystem.read.denyOnly` key, adds the real
 * `filesystem.denyRead`, and seeds `sandbox.credentials.files` (honored on
 * Claude Code v2.1.187+, ignored on older) for forward-compatibility.
 *
 * Contract: prints a single-line JSON report as its LAST stdout line; exits
 * non-zero on failure. Self-contained, idempotent, fail-loud.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOME = process.env.KEVIN_HOME?.trim() || process.cwd();
const SETTINGS_PROJECT = resolve(HOME, '.claude', 'settings.json');

// Project-root-relative directory path (no glob). denyRead on a directory denies
// it and everything under it; credentials.files applies the same block on v2.1.187+.
const SECRETS_DIR_PATH = '.kevin/secrets';

const readJson = (path: string): Record<string, unknown> =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>) : {};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function main(): void {
  if (!existsSync(SETTINGS_PROJECT)) {
    process.stdout.write(JSON.stringify({ ok: true, version: '0.3.3', settingsTouched: false, note: 'no settings.json' }) + '\n');
    return;
  }

  const project = readJson(SETTINGS_PROJECT);
  const sandbox = asObject(project.sandbox);
  const filesystem = asObject(sandbox.filesystem);

  // 1. Drop the dead `filesystem.read.denyOnly` key (Claude Code never honored it).
  const read = asObject(filesystem.read);
  const deadKeyRemoved = 'denyOnly' in read;
  if (deadKeyRemoved) {
    delete read.denyOnly;
    if (Object.keys(read).length === 0) delete filesystem.read;
    else filesystem.read = read;
  }

  // 2. Add the real key: deny reads of the secrets dir (and everything under it).
  const denyRead = Array.isArray(filesystem.denyRead) ? (filesystem.denyRead as string[]) : [];
  const denyReadAdded = !denyRead.includes(SECRETS_DIR_PATH);
  if (denyReadAdded) filesystem.denyRead = [...denyRead, SECRETS_DIR_PATH];

  // 3. Forward-compat: sandbox.credentials.files (Claude Code v2.1.187+; ignored on older).
  const credentials = asObject(sandbox.credentials);
  const files = Array.isArray(credentials.files) ? (credentials.files as Array<Record<string, unknown>>) : [];
  const credAdded = !files.some((entry) => asObject(entry).path === SECRETS_DIR_PATH);
  if (credAdded) credentials.files = [...files, { path: SECRETS_DIR_PATH, mode: 'deny' }];

  const settingsTouched = deadKeyRemoved || denyReadAdded || credAdded;
  if (settingsTouched) {
    sandbox.filesystem = filesystem;
    sandbox.credentials = credentials;
    project.sandbox = sandbox;
    writeFileSync(SETTINGS_PROJECT, JSON.stringify(project, null, 2) + '\n');
  }

  process.stdout.write(
    JSON.stringify({ ok: true, version: '0.3.3', deadKeyRemoved, denyReadAdded, credAdded, settingsTouched }) + '\n'
  );
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: '0.3.3', error: message }) + '\n');
  process.exit(1);
}
