#!/usr/bin/env bun
/**
 * SessionStart hook. Two disjoint paths:
 *
 * - preInitOutput(): no `<HOME>/CLAUDE.md` exists. Emit the banner + setup
 *   hint. NO filesystem writes — anything that walks FOLDERS.* must stay out
 *   of this path, otherwise an empty Kevin home tree gets created before
 *   the user has chosen where data should live.
 *
 * - postInitOutput(): emit the dynamic lane (today, last session tail, git
 *   activity). Static identity (AGENTS, SOUL, IDENTITY, USER) is loaded
 *   natively by Claude Code via `@-imports` in `<HOME>/CLAUDE.md`.
 */
import { isInitialized } from '../mcp-server/src/config';
import { assembleContext } from '../mcp-server/src/context';
import { AGENT_KEVIN_BANNER } from '../mcp-server/src/shared/banner';
import { log as baseLog } from '../mcp-server/src/shared/log';

const log = baseLog.session.with('start');

interface HookOutput {
  systemMessage: string;
  hookSpecificOutput: {
    hookEventName: 'SessionStart';
    additionalContext: string;
  };
}

function preInitOutput(): HookOutput {
  const systemMessage = [
    '',
    AGENT_KEVIN_BANNER,
    '',
    '→ Not set up yet, run /agent-kevin:init to get started.',
  ].join('\n');

  const additionalContext = [
    "The agent-kevin plugin is loaded, but `/agent-kevin:init` hasn't been run yet — the Agent home directory and identity files don't exist.",
    '',
    "If the user asks you to do anything that requires Kevin's data (compile, briefing, task ops, knowledge lookup), suggest they run `/agent-kevin:init` first.",
    '',
    "If they ask general questions or want help with something unrelated to Kevin, answer normally — you don't need Kevin's context to be helpful.",
  ].join('\n');

  return {
    systemMessage,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  };
}

interface PostInit {
  output: HookOutput;
  banner: string;
  hasIssues: boolean;
}

async function postInitOutput(): Promise<PostInit> {
  const { context, banner, hasIssues } = await assembleContext();
  return {
    output: {
      systemMessage: '\n' + banner,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
    },
    banner,
    hasIssues,
  };
}

try {
  const initialized = isInitialized();
  if (initialized) {
    const { output, banner, hasIssues } = await postInitOutput();
    // Mirror what the operator sees in their terminal into the log file so
    // failures (missing knowledge dir, git repo unavailable, oversized
    // context) are diagnosable after the fact.
    const emit = hasIssues ? log.warn.bind(log) : log.info.bind(log);
    emit('hook fired (post-init)\n' + banner);
    process.stdout.write(JSON.stringify(output));
  } else {
    log.info('hook fired (pre-init)');
    process.stdout.write(JSON.stringify(preInitOutput()));
  }
} catch (err) {
  log.error('hook failed', err);
  // Still emit a minimal valid payload so Claude Code doesn't choke.
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' } }));
  process.exit(1);
}
