import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

/**
 * Convention guard: `process.env` is read in exactly one place — `shared/env.ts`,
 * which exposes `env()` / `dbConnections()` / `scrubValues()` to the rest of the
 * codebase. That module self-loads `.kevin/secrets/.env` before any read, so
 * secrets loading is order-independent instead of depending on which file
 * imported config first. `shared/log.ts` is the sole other exception: a
 * self-contained logger that must stay dependency-free. The `...process.env`
 * spread (forwarding the env to a spawned child) is allowed everywhere — only
 * value reads (`process.env.X` / `process.env[x]`) are banned. See shared/env.ts.
 */
const SRC = resolve(import.meta.dir);
const ALLOWED = new Set(['shared/env.ts', 'shared/log.ts']);

const sourceFiles = readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.includes('generated/'))
  .map((path) => path.replaceAll('\\', '/'))
  .filter((path) => !ALLOWED.has(path));

const READ_PATTERN = /process\.env\s*[.[]/;

describe('process.env is consolidated into shared/env.ts', () => {
  test('no module outside shared/env.ts and shared/log.ts reads process.env directly', () => {
    const offenders = sourceFiles.filter((path) => READ_PATTERN.test(readFileSync(resolve(SRC, path), 'utf-8')));
    expect(
      offenders,
      `Read env via @/shared/env (env()/dbConnections()) instead of process.env in: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});
