/**
 * ANSI color + Unicode graphics primitives for the `status` screen.
 *
 * No dependencies — hand-rolled SGR codes and block-character bars. Color is a
 * progressive enhancement: every glyph (bars, tree branches, emoji) renders
 * identically with color off, so the screen stays legible when piped to a file
 * or captured by a non-TTY consumer.
 *
 * Colorizing is per-string (callers apply it per-line) because some renderers
 * reset ANSI state at every newline — see shared/banner.ts.
 */

const ESC = '\x1b[';

export const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
  brightGreen: 92,
  brightYellow: 93,
  brightMagenta: 95,
  brightCyan: 96
} as const;

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Visible (rendered) width of a string: strips ANSI SGR codes and counts wide
 * glyphs (emoji, CJK) as 2 cells. Approximate but sufficient for the fixed glyph
 * set used by the status screen — used to align box borders.
 */
export const visibleWidth = (text: string): number => {
  const stripped = text.replace(ANSI_RE, '');
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0xfe0f || code === 0x200d) continue; // variation selector / ZWJ
    const wide =
      code >= 0x1f000 ||
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x2b00 && code <= 0x2bff) ||
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff);
    width += wide ? 2 : 1;
  }
  return width;
};

/** Right-pad `text` to a visible width of `target` cells. */
export const padTo = (text: string, target: number): string =>
  text + ' '.repeat(Math.max(0, target - visibleWidth(text)));

export type ColorMode = 'auto' | 'always' | 'never';

/** Resolve whether color should be emitted. `auto` honors TTY + the NO_COLOR
 *  convention; `always`/`never` force it. */
export const colorEnabled = (mode: ColorMode): boolean => {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
};

export interface Paint {
  /** Wrap a single line in an SGR code (identity when color is off). */
  c: (text: string, code: number) => string;
  dim: (text: string) => string;
  bold: (text: string) => string;
}

export const makePaint = (on: boolean): Paint => {
  const c = (text: string, code: number): string => (on ? `${ESC}${code}m${text}${ESC}${CODES.reset}m` : text);
  return {
    c,
    dim: (text: string) => c(text, CODES.dim),
    bold: (text: string) => c(text, CODES.bold)
  };
};

const TRACK = '░';

export interface Segment {
  value: number;
  code: number;
}

/**
 * A single bar partitioned into colored segments proportional to their values
 * (e.g. active/blocked/stale task load). The final segment absorbs rounding so
 * the bar always fills exactly `width` cells.
 */
export const stackedBar = (segments: readonly Segment[], width: number, paint: Paint): string => {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return paint.dim(TRACK.repeat(width));
  let used = 0;
  return segments
    .map((segment, index) => {
      const length = index === segments.length - 1 ? width - used : Math.round((segment.value / total) * width);
      used += length;
      return paint.c('█'.repeat(Math.max(0, length)), segment.code);
    })
    .join('');
};

const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/** Render a series of numbers as a unicode sparkline. */
export const sparkline = (values: readonly number[]): string => {
  if (values.length === 0) return '';
  const max = Math.max(...values, 0);
  if (max <= 0) return SPARKS[0].repeat(values.length);
  return values
    .map((value) => SPARKS[Math.min(SPARKS.length - 1, Math.round((value / max) * (SPARKS.length - 1)))])
    .join('');
};

/** Dotted-leader key/value pair: `label ······· value`, padded to `width`.
 *  Uses visible width so colored values keep the leader length correct. */
export const leader = (label: string, value: string, width: number, paint: Paint): string => {
  const dots = Math.max(1, width - visibleWidth(label) - visibleWidth(value));
  return `${label} ${paint.dim('·'.repeat(dots))} ${value}`;
};
