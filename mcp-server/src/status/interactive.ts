/**
 * Interactive "mission control" TUI — only used in a real terminal (TTY).
 *
 * Collects the snapshot once, draws a tab on the alt-screen, and switches tabs
 * live on key presses (← → / Tab to cycle, 1-6 to jump, r to refresh,
 * q/Esc/Ctrl-C to quit). Piped/captured runs never reach here — bin/kevin falls
 * back to a static single-tab render when stdout/stdin aren't both TTYs.
 */
import { makePaint } from './ansi';
import { collectStatus } from './collect';
import { renderSnapshot, TABS, type Tab } from './render';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR = '\x1b[2J\x1b[3J\x1b[H';

export const runInteractive = async (startTab: Tab): Promise<void> => {
  const paint = makePaint(true);
  const out = process.stdout;
  const stdin = process.stdin;
  let snapshot = await collectStatus();
  let index = Math.max(0, TABS.indexOf(startTab));

  const keyHint = paint.dim('  ← → switch · 1-6 jump · r refresh · q quit');

  const draw = (): void => {
    const body = renderSnapshot(snapshot, { tab: TABS[index], tabBar: true, banner: true }, paint);
    out.write(`${CLEAR}${body}\n${keyHint}\n`);
  };

  out.write(ALT_ON + HIDE_CURSOR);
  draw();
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding('utf-8');

  return new Promise<void>((finish) => {
    const onKey = async (key: string): Promise<void> => {
      if (key === 'q' || key === '\x03' || key === '\x1b') {
        stdin.off('data', onKey);
        stdin.setRawMode?.(false);
        stdin.pause();
        out.write(SHOW_CURSOR + ALT_OFF);
        finish();
        return;
      }
      if (key === '\x1b[C' || key === '\t') {
        index = (index + 1) % TABS.length;
        draw();
      } else if (key === '\x1b[D') {
        index = (index - 1 + TABS.length) % TABS.length;
        draw();
      } else if (key === 'r') {
        snapshot = await collectStatus();
        draw();
      } else {
        const num = Number.parseInt(key, 10);
        if (num >= 1 && num <= TABS.length) {
          index = num - 1;
          draw();
        }
      }
    };
    stdin.on('data', onKey);
  });
};
