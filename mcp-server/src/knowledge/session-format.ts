/**
 * Single source of truth for the session-log entry format. The writer
 * (`scripts/session-capture.ts`) and readers (`chunk.ts`, `context.ts`)
 * both import from here, so any change to the separator or header shape
 * propagates to everyone that needs to stay in sync.
 */

/** Literal byte sequence the writer emits between entries. */
export const ENTRY_SEPARATOR = '\n\n---\n\n';

const ENTRY_HEADER_PATTERN = '### (?:Session|Pre-Compact) \\(';
const SESSION_HEADER_PATTERN = '### Session \\(\\d{2}:\\d{2}\\) ';
const ESCAPED_SEPARATOR = ENTRY_SEPARATOR.replace(/\n/g, '\\n');

/** Matches an entry header opening (Session or Pre-Compact) at line start. */
export const ENTRY_HEADER_RE = new RegExp(`^${ENTRY_HEADER_PATTERN}`, 'm');

/**
 * Splits a body into entry-aligned chunks. Requires either start-of-body or
 * the literal `ENTRY_SEPARATOR` immediately before each header — keeps
 * headers inside fenced code blocks from triggering false splits.
 */
export const ENTRY_SPLIT_RE = new RegExp(
  `(?<=^|${ESCAPED_SEPARATOR})(?=${ENTRY_HEADER_PATTERN})`,
);

/**
 * Locates each `ENTRY_SEPARATOR` immediately followed by a Session header
 * (not Pre-Compact). Consume via `matchAll` to avoid the shared-state hazard
 * that comes with `/g` + `exec`.
 */
export const SESSION_BLOCK_SEPARATOR_RE = new RegExp(
  `${ESCAPED_SEPARATOR}(?=${SESSION_HEADER_PATTERN})`,
  'g',
);

/** Matches a Session header at line start — fallback when no separators exist. */
export const FIRST_SESSION_HEADER_RE = new RegExp(`^${SESSION_HEADER_PATTERN}`, 'm');

/** Matches a trailing `ENTRY_SEPARATOR` + whitespace at end-of-block. */
export const TRAILING_SEPARATOR_RE = new RegExp(`${ESCAPED_SEPARATOR}\\s*$`);
