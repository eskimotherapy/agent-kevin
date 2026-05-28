/**
 * Harness-agnostic session-capture core. Used by:
 *  - Claude Code's SessionEnd / PreCompact hooks via `bin/kevin session-capture --hook-protocol=claude`.
 *  - Future harnesses (Codex, Pi, ...) — each adds a transcript-format adapter
 *    + a `--hook-protocol=<host>` envelope in `bin/kevin`.
 *
 * This module knows nothing about hook envelopes (stdin/stdout JSON shapes) —
 * that's the CLI wrapper's job. It takes plain args, applies self-defer +
 * exclusion + min-turns filtering + secret redaction, and appends to today's
 * session log.
 */
import { FOLDERS, KNOWLEDGE, PLUGIN_NAME, isInitialized } from '@/config';
import { ENTRY_SEPARATOR } from '@/knowledge/session-format';
import { redactSecrets } from '@/knowledge/utils';
import { nowTime, todayDate } from '@/shared/date';
import { log as baseLog } from '@/shared/log';
import type { TranscriptTurn } from '@/shared/types';
import { expandTilde } from '@/shared/utils';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { relative, resolve } from 'node:path';

const log = baseLog.session.with('capture');

export type CaptureMode = 'session-end' | 'pre-compact';
export type CaptureFormat = 'claude';

interface ModeConfig {
  heading: string;
  minTurns: number;
}

const MODES: Record<CaptureMode, ModeConfig> = {
  'session-end': { heading: 'Session', minTurns: 1 },
  'pre-compact': { heading: 'Pre-Compact', minTurns: 5 },
};

// ── Transcript extractors ────────────────────────────────────────────

type Extractor = (transcriptPath: string) => TranscriptTurn[];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** Flatten a Claude Code content block (string or structured array) into text. */
function claudeContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
    } else if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/**
 * Claude Code transcript extractor. Reads the JSONL transcript at the given
 * path and returns only the user/assistant text turns — tool results,
 * non-text blocks, system-reminders, and slash-command artefacts are
 * filtered out.
 */
const claudeExtractor: Extractor = (transcriptPath) => {
  const turns: TranscriptTurn[] = [];
  const fileContent = readFileSync(transcriptPath, 'utf-8');
  for (const line of fileContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(entry)) continue;
    const msg = isRecord(entry.message) ? entry.message : entry;
    const role = typeof msg.role === 'string' ? msg.role : undefined;
    if (role !== 'user' && role !== 'assistant') continue;

    const text = claudeContentToText(msg.content).trim();
    if (!text) continue;
    if (text.startsWith('<system-reminder>') || text.startsWith('<command-name>')) continue;

    turns.push({ role, text });
  }
  return turns;
};

const EXTRACTORS: Record<CaptureFormat, Extractor> = {
  claude: claudeExtractor,
};

// ── Defer + exclusion helpers ────────────────────────────────────────

/** True when called by Claude Code's plugin-hook invocation (sets CLAUDE_PLUGIN_ROOT). */
function isPluginInvocation(): boolean {
  return Boolean(process.env.CLAUDE_PLUGIN_ROOT);
}

/** True when the project at `cwd` has *this* plugin (PLUGIN_NAME) enabled. */
function pluginEnabledInCwd(cwd: string): boolean {
  if (!cwd) return false;
  const settingsPath = resolve(cwd, '.claude/settings.json');
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      enabledPlugins?: Record<string, boolean>;
    };
    return Object.entries(settings.enabledPlugins ?? {}).some(
      ([key, enabled]) => enabled === true && key.startsWith(`${PLUGIN_NAME}@`),
    );
  } catch {
    return false;
  }
}

/**
 * Returns the matching exclude path when `cwd` falls under any of them
 * (exact or `/`-bounded prefix), else null. The `/` boundary stops
 * `/foo/bar` from excluding `/foo/barbaz`.
 */
function matchedExclude(cwd: string, excludes: string[]): string | null {
  if (!cwd || excludes.length === 0) return null;
  const target = resolve(cwd);
  for (const path of excludes) {
    const absolute = resolve(expandTilde(path));
    if (target === absolute || target.startsWith(`${absolute}/`)) return absolute;
  }
  return null;
}

/** Render `cwd` as `~/<relative>` when under `$HOME`, else return unchanged. */
function homeRelative(cwd: string): string {
  if (!cwd) return 'unknown';
  const home = homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

// ── Turn formatting ──────────────────────────────────────────────────

/**
 * Format recent transcript turns as a markdown-ish context block. Per-turn cap
 * stops one oversized turn from devouring the budget; total cap caps cumulative
 * size. Walks turn boundaries explicitly so headers aren't sliced through.
 */
function formatTurns(turns: TranscriptTurn[]): string {
  const recent = turns.slice(-KNOWLEDGE.MAX_TRANSCRIPT_TURNS);
  const formatted = recent.map((t) => {
    const role = t.role === 'user' ? 'User' : 'Assistant';
    const text =
      t.text.length > KNOWLEDGE.MAX_TURN_CHARS
        ? `${t.text.slice(0, KNOWLEDGE.MAX_TURN_CHARS)}\n[… ${t.text.length - KNOWLEDGE.MAX_TURN_CHARS} chars truncated]`
        : t.text;
    return `**${role}:** ${text}\n`;
  });
  if (formatted.length === 0) return '';
  const kept: string[] = [formatted[formatted.length - 1]];
  let total = kept[0].length;
  for (let i = formatted.length - 2; i >= 0; i--) {
    if (total + formatted[i].length > KNOWLEDGE.MAX_TRANSCRIPT_CHARS) break;
    kept.unshift(formatted[i]);
    total += formatted[i].length;
  }
  return kept.join('\n');
}

// ── Public surface ───────────────────────────────────────────────────

export interface CaptureSessionOpts {
  transcriptPath: string;
  cwd: string;
  sessionId: string;
  mode: CaptureMode;
  excludes?: string[];
  format?: CaptureFormat;
  /**
   * When true, applies self-defer logic (skip if another plugin instance is
   * enabled in cwd, skip if cwd is excluded). Default mirrors today's
   * implicit behavior: defer when NOT invoked by a plugin hook (i.e. when
   * called from the user-level `~/.claude/settings.json` hook).
   */
  selfDefer?: boolean;
}

export type CaptureSessionReason =
  | 'not-initialized'
  | 'plugin-will-capture'
  | 'excluded'
  | 'no-transcript'
  | 'too-few-turns'
  | 'empty-after-redaction';

export type CaptureSessionResult =
  | { saved: true; turns: number; path: string; filename: string }
  | { saved: false; reason: CaptureSessionReason; turns?: number; detail?: string };

export async function captureSession(opts: CaptureSessionOpts): Promise<CaptureSessionResult> {
  const { mode } = opts;
  if (!isInitialized()) {
    log.info(`skip (${mode}) — /${PLUGIN_NAME}:init not run yet`);
    return { saved: false, reason: 'not-initialized' };
  }

  const selfDefer = opts.selfDefer ?? !isPluginInvocation();
  if (selfDefer) {
    if (pluginEnabledInCwd(opts.cwd)) {
      log.info(`skip (${mode}) — plugin hook will capture`);
      return { saved: false, reason: 'plugin-will-capture' };
    }
    const excluded = matchedExclude(opts.cwd, opts.excludes ?? []);
    if (excluded) {
      log.info(`skip (${mode}) — ${homeRelative(opts.cwd)} is excluded`);
      return { saved: false, reason: 'excluded', detail: excluded };
    }
  }

  if (!opts.transcriptPath || !existsSync(opts.transcriptPath)) {
    log.warn(`skip (${mode}) — no transcript at ${opts.transcriptPath}`);
    return { saved: false, reason: 'no-transcript' };
  }

  const extract = EXTRACTORS[opts.format ?? 'claude'];
  const turns = extract(opts.transcriptPath);
  const cfg = MODES[mode];
  if (turns.length < cfg.minTurns) {
    log.info(`skip (${mode}) — ${turns.length} turns (min ${cfg.minTurns})`);
    return { saved: false, reason: 'too-few-turns', turns: turns.length };
  }

  const formatted = formatTurns(turns);
  const redacted = redactSecrets(formatted);
  if (!redacted.trim()) {
    log.info(`skip (${mode}) — empty after redaction`);
    return { saved: false, reason: 'empty-after-redaction', turns: turns.length };
  }

  const today = todayDate();
  const filename = `${today}.md`;
  const logPath = resolve(FOLDERS.SESSIONS, filename);

  await mkdir(FOLDERS.SESSIONS, { recursive: true });
  if (!existsSync(logPath)) {
    await writeFile(logPath, `# Session Log: ${today}\n\n`, 'utf-8');
  }

  const idShort = opts.sessionId.slice(0, 8);
  const source = homeRelative(opts.cwd);
  const entry = `### ${cfg.heading} (${nowTime()}) [${idShort}] · ${source}\n\n${redacted}${ENTRY_SEPARATOR}`;
  await appendFile(logPath, entry, 'utf-8');

  log.info(`saved ${turns.length} turns → ${filename} (${mode})`);
  return { saved: true, turns: turns.length, path: logPath, filename };
}
