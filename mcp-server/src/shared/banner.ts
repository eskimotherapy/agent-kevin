/**
 * ASCII banner for the SessionStart hook.
 *
 * Colors wrap each line individually: Claude Code's systemMessage renderer
 * resets ANSI state at every newline, so a single open/close around the
 * whole block would only color line 1.
 */

const ESC = '\x1b[';
const YELLOW_BOLD = `${ESC}1m${ESC}33m`;
const CYAN_BOLD = `${ESC}1m${ESC}36m`;
const RESET = `${ESC}0m`;

/** Raw (uncolored) wordmark lines + tagline. Exported so other surfaces (e.g.
 *  the `status` screen) can re-colorize them under their own color policy
 *  without inheriting this module's hardcoded SessionStart palette. */
export const BANNER_LINES = [' ╔═╗ ╔═╗ ╔═╗ ╔╗╔ ╔╦╗', ' ╠═╣ ║ ╦ ║╣  ║║║  ║ ', ' ╩ ╩ ╚═╝ ╚═╝ ╝╚╝  ╩ '] as const;
export const BANNER_TAG = '===KEVIN=== 🍌';

const colorize = (text: string, color: string): string => `${color}${text}${RESET}`;

export const BANNER = [
  ...BANNER_LINES.map((line) => colorize(line, YELLOW_BOLD)),
  colorize(BANNER_TAG, CYAN_BOLD)
].join('\n');
