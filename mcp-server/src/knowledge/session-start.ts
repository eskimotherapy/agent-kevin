/**
 * Harness-agnostic SessionStart core. Used by:
 *  - Claude Code's SessionStart hook via `bin/kevin session-start --hook-protocol=claude`.
 *  - Future harnesses (Codex, ...) — each adds a `--hook-protocol=<host>` envelope
 *    in `bin/kevin`. The Codex SessionStart hook happens to use the same
 *    `additionalContext` field name and semantics as Claude's, so the per-host
 *    envelope work is minimal.
 *
 * Two disjoint paths:
 *  - **Pre-init**: no `SOUL.md` — emit the banner + setup hint. NO filesystem
 *    writes (anything that touches FOLDERS.* must stay out of this path,
 *    otherwise an empty home tree gets created before the user picks a home).
 *  - **Post-init**: assemble the dynamic lane (today, last session tail, git
 *    activity, today's reports). Static identity (SOUL/IDENTITY/USER/CLAUDE)
 *    is loaded natively by the harness via `@-imports` or `AGENTS.md`.
 *
 * Always returns a result — internal errors are caught and emitted as an
 * empty payload + `error` field so the host never chokes on hook output.
 */
import { PLUGIN_NAME, isInitialized } from '@/config';
import { assembleContext } from '@/context';
import { BANNER } from '@/shared/banner';
import { log as baseLog } from '@/shared/log';

const log = baseLog.session.with('start');

export interface SessionStartResult {
  systemMessage: string;
  additionalContext: string;
  hasIssues?: boolean;
  error?: string;
}

const PRE_INIT_RESULT: SessionStartResult = {
  systemMessage: ['', BANNER, '', `→ Not set up yet, run /${PLUGIN_NAME}:init to get started.`].join('\n'),
  additionalContext: [
    `The ${PLUGIN_NAME} plugin is loaded, but \`/${PLUGIN_NAME}:init\` hasn't been run yet — the Agent home directory and identity files don't exist.`,
    '',
    `If the user asks you to do anything that requires the agent's data (compile, briefing, task ops, knowledge lookup), suggest they run \`/${PLUGIN_NAME}:init\` first.`,
    '',
    "If they ask general questions or want help with something unrelated to the agent, answer normally — you don't need the agent's context to be helpful."
  ].join('\n'),
  hasIssues: false
};

export async function sessionStart(): Promise<SessionStartResult> {
  try {
    if (!isInitialized()) {
      log.info('hook fired (pre-init)');
      return PRE_INIT_RESULT;
    }
    const { context, banner, hasIssues } = await assembleContext();
    // Mirror what the operator sees into the log file so context-assembly
    // issues (missing knowledge dir, git unavailable, oversized payload) are
    // diagnosable after the fact.
    const emit = hasIssues ? log.warn.bind(log) : log.info.bind(log);
    emit('hook fired (post-init)\n' + banner);
    return { systemMessage: '\n' + banner, additionalContext: context, hasIssues };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('hook failed', err);
    // Always emit a valid payload — the host treats malformed output as fatal.
    return { systemMessage: '', additionalContext: '', error: message };
  }
}
