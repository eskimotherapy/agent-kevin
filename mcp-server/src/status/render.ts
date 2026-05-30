/**
 * Renders a StatusSnapshot into the aesthetic, tabbed "mission control" screen.
 *
 * Pure presentation: no disk reads here (collect.ts owns that). One tab renders
 * per call. In an interactive TTY the caller draws the tab bar and switches tabs
 * live; piped/captured (non-TTY) it renders a single tab without the tab-bar
 * chrome. Color is gated by the resolved Paint; with color off the output is
 * clean monochrome Unicode that survives being piped or captured.
 */
import { type ManifestEntry } from '@/context';
import { BANNER_LINES, BANNER_TAG } from '@/shared/banner';
import { homedir } from 'node:os';
import {
  CODES,
  colorEnabled,
  leader,
  makePaint,
  padTo,
  sparkline,
  stackedBar,
  visibleWidth,
  type ColorMode,
  type Paint
} from './ansi';
import { collectStatus, type ContextGroup, type FacetSize, type StatusSnapshot, type TaskRef } from './collect';

const WIDTH = 62;
const TITLE = CODES.brightCyan;

export const TABS = ['overview', 'context', 'knowledge', 'work', 'system', 'settings'] as const;
export type Tab = (typeof TABS)[number];

export const isTab = (value: string): value is Tab => (TABS as readonly string[]).includes(value);

// ── small formatters ──────────────────────────────────────────────────

const tildifyHome = (path: string): string => {
  const home = homedir();
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

const humanBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const relTime = (iso: string | null): string => {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Strip the `mcp__<server>__` prefix MCP adds, leaving the bare tool name. */
const shortToolName = (name: string): string => {
  const idx = name.lastIndexOf('__');
  return idx >= 0 ? name.slice(idx + 2) : name;
};

const STATUS_ICON: Record<ManifestEntry['status'], string> = {
  loaded: '✓',
  missing: '✗',
  unavailable: '⚠'
};

// ── primitives ────────────────────────────────────────────────────────

/** Colored section header: `<emoji> Title ───────────────── right`. */
const head = (emoji: string, label: string, right: string, paint: Paint): string => {
  const left = `${emoji} ${paint.c(label, TITLE)}`;
  const visibleLeft = visibleWidth(`${emoji} ${label}`);
  if (!right) return `${left} ${paint.dim('─'.repeat(Math.max(2, WIDTH - visibleLeft - 1)))}`;
  const dashes = Math.max(2, WIDTH - visibleLeft - visibleWidth(right) - 2);
  return `${left} ${paint.dim('─'.repeat(dashes))} ${paint.dim(right)}`;
};

/** Wrap tokens to WIDTH, dim ` · ` between them, each line prefixed `indent`. */
const bulletList = (tokens: string[], indent: string, paint: Paint): string => {
  const SEP = ' · ';
  const rows: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (current.length && indent.length + [...current, token].join(SEP).length > WIDTH) {
      rows.push(current);
      current = [];
    }
    current.push(token);
  }
  if (current.length) rows.push(current);
  return rows.map((row) => indent + row.join(paint.dim(SEP))).join('\n');
};

/** One token per line, each prefixed with `indent`. */
const stack = (tokens: string[], indent: string): string => tokens.map((token) => `${indent}${token}`).join('\n');

/** Lay tokens out in a fixed-column grid (ANSI-aware padding). */
const grid = (tokens: string[], cols: number, indent: string): string => {
  const cellW = Math.floor((WIDTH - indent.length) / cols);
  const rows: string[] = [];
  for (let i = 0; i < tokens.length; i += cols) {
    rows.push(
      indent +
        tokens
          .slice(i, i + cols)
          .map((cell) => padTo(cell, cellW))
          .join('')
    );
  }
  return rows.map((row) => row.trimEnd()).join('\n');
};

/** Magnitude bar (scaled to `max`) followed by a dim remainder track. */
const magnitudeBar = (value: number, max: number, width: number, code: number, paint: Paint): string => {
  const filled = Math.max(value > 0 ? 1 : 0, Math.round((value / (max || 1)) * width));
  return paint.c('█'.repeat(filled), code) + paint.dim('░'.repeat(Math.max(0, width - filled)));
};

const boxTop = (paint: Paint) => paint.dim(`╭${'─'.repeat(WIDTH)}╮`);
const boxBottom = (paint: Paint) => paint.dim(`╰${'─'.repeat(WIDTH)}╯`);
const boxLine = (content: string, paint: Paint): string =>
  `${paint.dim('│')}${padTo(` ${content}`, WIDTH)}${paint.dim('│')}`;

const tabBarLine = (active: Tab, paint: Paint): string =>
  TABS.map((tab) => (tab === active ? paint.c(`▸ ${tab.toUpperCase()}`, TITLE) : paint.dim(tab))).join('   ');

/** Tab-bar box (interactive only) — no title row; identity lives in the banner. */
const tabBox = (active: Tab, paint: Paint): string =>
  [boxTop(paint), boxLine(tabBarLine(active, paint), paint), boxBottom(paint)].join('\n');

// ── panels ────────────────────────────────────────────────────────────

const dot = (paint: Paint, code: number) => paint.c('●', code);

const panelRuntime = (snap: StatusSnapshot, paint: Paint): string => {
  const { skills, mcp, hooks, context } = snap;
  return [
    head('⚡', 'Runtime', '', paint),
    `   ${leader('skills', String(skills.count), 26, paint)}   ${leader('mcp', `${mcp.servers.length} srv · ${mcp.toolCount} tools`, 24, paint)}`,
    `   ${leader('hooks', String(hooks.count), 26, paint)}   ${leader('context', `${context.staticImports.length} @-imports`, 24, paint)}`
  ].join('\n');
};

const knowledgeSummary = (snap: StatusSnapshot, paint: Paint): string => {
  const { knowledge, compile } = snap;
  const pending = compile.pending > 0 ? paint.c(`${compile.pending} pending`, CODES.yellow) : paint.dim('0 pending');
  const costs = [...compile.recent].reverse().map((entry) => entry.cost);
  const hasCostTrend = costs.some((cost) => cost > 0);
  const W = 22;
  const col = (label: string, value: string) => leader(label, value, W, paint);
  const row = (left: string, right: string) => `   ${left}   ${right}`.trimEnd();
  return [
    head('🧠', 'Knowledge', `compiled ${relTime(compile.lastCompiled)}`, paint),
    `   ${leader('sessions', `${compile.ingested} ingested · ${pending}`, W, paint)}`,
    row(col('concepts', String(knowledge.concepts)), col('user facets', String(knowledge.userFacets))),
    row(col('daily mem', String(knowledge.memoryDaily)), col('inbox', String(knowledge.inboxItems))),
    row(
      col('feedback', humanBytes(knowledge.feedbackBytes)),
      hasCostTrend ? col('cost trend', paint.c(sparkline(costs), CODES.green)) : ''
    ),
    `   ${paint.dim(`wiki ${humanBytes(knowledge.totalBytes)} · Σ $${compile.totalCostUsd.toFixed(2)} spent`)}`
  ].join('\n');
};

const WEEK_COLORS = [
  CODES.cyan,
  CODES.green,
  CODES.yellow,
  CODES.magenta,
  CODES.blue,
  CODES.brightMagenta,
  CODES.brightCyan
];

/** Last-7-days session volume as a single segmented bar + per-day legend. */
const sessionsWeekBar = (snap: StatusSnapshot, paint: Paint): string => {
  const { sessionsWeek } = snap.knowledge;
  const seg = stackedBar(
    sessionsWeek.map((day, index) => ({
      value: day.bytes,
      code: WEEK_COLORS[index]
    })),
    SEG_W,
    paint
  );
  const legend = grid(
    sessionsWeek.map(
      (day, index) => `${paint.c('◼', WEEK_COLORS[index])} ${day.label} ${day.bytes > 0 ? humanBytes(day.bytes) : '—'}`
    ),
    3,
    '   '
  );
  return [`   ${seg}`, legend].join('\n');
};

const facetBars = (facets: FacetSize[], paint: Paint): string => {
  const max = Math.max(...facets.map((facet) => facet.bytes), 1);
  return facets
    .map(
      (facet) =>
        `   ${padTo(facet.name, 13)} ${magnitudeBar(facet.bytes, max, 16, CODES.magenta, paint)} ${paint.dim(humanBytes(facet.bytes))}`
    )
    .join('\n');
};

const panelKnowledge = (snap: StatusSnapshot, paint: Paint): string => {
  const { knowledge } = snap;
  return [
    knowledgeSummary(snap, paint),
    [
      head('🧵', 'Memory', '', paint),
      `   ${paint.dim(`index ${humanBytes(knowledge.memoryIndexBytes)} · ${knowledge.activeThreads} active threads · ${knowledge.learnings} learnings · ${knowledge.memoryDaily} daily files`)}`
    ].join('\n'),
    [head('📅', 'Sessions', 'last 7 days', paint), sessionsWeekBar(snap, paint)].join('\n'),
    [head('👤', 'User facets', `${knowledge.userFacets}`, paint), facetBars(knowledge.facets, paint)].join('\n'),
    [head('🗂', 'Concepts', `${knowledge.concepts}`, paint), bulletList(knowledge.conceptNames, '   ', paint)].join(
      '\n'
    )
  ].join('\n\n');
};

const loadDots = (snap: StatusSnapshot, paint: Paint): string => {
  const { tasks } = snap;
  const overdue = tasks.overdue > 0 ? paint.c(`${tasks.overdue} overdue`, CODES.red) : paint.dim('0 overdue');
  return `   ${dot(paint, CODES.green)} ${tasks.active} active   ${dot(paint, CODES.cyan)} ${tasks.open} open   ${dot(paint, CODES.red)} ${tasks.blocked} blocked   ${dot(paint, CODES.yellow)} ${tasks.stale} stale   ${overdue}`;
};

const loadBar = (snap: StatusSnapshot, paint: Paint): string => {
  const { tasks } = snap;
  const load = stackedBar(
    [
      { value: tasks.active, code: CODES.green },
      { value: tasks.open, code: CODES.cyan },
      { value: tasks.blocked, code: CODES.red },
      { value: tasks.stale, code: CODES.yellow }
    ],
    22,
    paint
  );
  return [`   tasks    ${load} ${paint.dim(String(tasks.total))}`, loadDots(snap, paint)].join('\n');
};

const refLines = (refs: TaskRef[], limit: number, paint: Paint): string =>
  refs
    .slice(0, limit)
    .map((ref) => `   ${paint.dim('•')} ${ref.id.padEnd(7)} ${truncate(ref.title, 42)} ${paint.dim(ref.priority)}`)
    .join('\n') + (refs.length > limit ? `\n   ${paint.dim(`… +${refs.length - limit} more`)}` : '');

const panelWork = (snap: StatusSnapshot, paint: Paint): string => {
  const { tasks } = snap;

  const BAR_W = 14;
  const maxTotal = Math.max(...tasks.byProject.map((load) => load.total), 1);
  const projectRows = tasks.byProject.map((load) => {
    const width = Math.max(1, Math.round((load.total / maxTotal) * BAR_W));
    const mini = stackedBar(
      [
        { value: load.active, code: CODES.green },
        { value: load.open, code: CODES.cyan },
        { value: load.blocked, code: CODES.red }
      ],
      width,
      paint
    );
    const track = paint.dim('░'.repeat(BAR_W - width));
    return `   ${padTo(load.project, 16)} ${mini}${track} ${paint.dim(String(load.total).padStart(2))}`;
  });

  // By-project breakdown first, then the aggregate load bar.
  const blocks = [
    [head('📂', 'By project', `${tasks.projects}`, paint), ...projectRows].join('\n'),
    [head('✅', 'Work', `${tasks.total} tasks`, paint), loadBar(snap, paint)].join('\n')
  ];

  if (tasks.overdueList.length)
    blocks.push([head('⏰', 'Overdue', '', paint), refLines(tasks.overdueList, 5, paint)].join('\n'));
  if (tasks.activeList.length)
    blocks.push([head('🔼', 'Active', '', paint), refLines(tasks.activeList, 5, paint)].join('\n'));
  if (tasks.staleList.length)
    blocks.push([head('🥀', 'Stale', '', paint), refLines(tasks.staleList, 5, paint)].join('\n'));

  return blocks.join('\n\n');
};

const panelSkills = (snap: StatusSnapshot, paint: Paint): string => {
  const { skills } = snap;
  const right = `${skills.count}${skills.custom ? ` · ${skills.custom} custom` : ''}`;
  return [head('🧩', 'Skills', right, paint), bulletList(skills.names, '   ', paint)].join('\n');
};

const panelMcp = (snap: StatusSnapshot, paint: Paint): string => {
  const { mcp, hooks } = snap;
  const hookRows = hooks.entries.map(
    (entry) => `   ${padTo(paint.c(entry.event, CODES.brightGreen), 26)} ${paint.dim(entry.command)}`
  );
  return [
    [
      head('🔌', 'MCP', `${mcp.servers.join(', ')} · ${mcp.toolCount} tools`, paint),
      bulletList(mcp.tools.map(shortToolName), '   ', paint)
    ].join('\n'),
    [head('🪝', 'Hooks', `${hooks.count}`, paint), ...hookRows].join('\n')
  ].join('\n\n');
};

const panelSettings = (snap: StatusSnapshot, paint: Paint): string => {
  const { settings } = snap;
  const layers = settings.layers.filter((l) => l.present).map((l) => l.label);
  const plugins = settings.enabledPlugins.map((name) => name.split('@')[0]);
  const renderEnv = (scope: 'user' | 'workspace') => {
    const items = settings.env
      .filter((entry) => entry.scope === scope)
      .map((entry) => `${entry.key}=${tildifyHome(entry.value)}`);
    return items.length ? [`   ${paint.dim(`env · ${scope}`)}`, stack(items, '     ')] : [];
  };
  const pluginLines = settings.plugin
    ? [
        `   ${leader('plugin', settings.plugin.ref, 26, paint)}`,
        `   ${leader('marketplace', `${settings.plugin.marketplace} (${settings.plugin.sourceType} ${tildifyHome(settings.plugin.sourcePath)})`, 26, paint)}`
      ]
    : [];
  return [
    head('⚙', 'Settings', layers.join(' + ') || 'none', paint),
    `   ${leader('permissions', `${settings.allow} allow · ${settings.deny} deny`, 26, paint)}`,
    ...pluginLines,
    `   ${paint.dim('plugins enabled')}`,
    bulletList(plugins, '     ', paint),
    ...renderEnv('user'),
    ...renderEnv('workspace')
  ].join('\n');
};

const panelLogs = (snap: StatusSnapshot, paint: Paint, compact = false): string => {
  const { logs } = snap;
  // warn always yellow, err always red — consistent with the rest of the UI.
  const warns = paint.c(`${logs.warnings} warn`, CODES.yellow);
  const errs = paint.c(`${logs.errors} err`, CODES.red);
  const W = 22;
  const lines = [
    head('📜', 'Logs', '', paint),
    `   ${leader('file', `${tildifyHome(logs.path)} (${humanBytes(logs.bytes)})`, W, paint)}`,
    `   ${leader('today', `${warns} · ${errs}`, W, paint)}`
  ];
  if (compact) return lines.join('\n');
  if (logs.lastError) lines.push(`   ${leader('last err', truncate(logs.lastError, 40), W, paint)}`);
  // all-time stats fully dimmed — historical context, not a live signal.
  lines.push(`   ${paint.dim(`all-time ${logs.totalWarnings} warn · ${logs.totalErrors} err`)}`);
  return lines.join('\n');
};

const panelReports = (snap: StatusSnapshot, paint: Paint): string => {
  if (!snap.reports.length) return '';
  return [
    head('📰', 'Recent reports', `${snap.reportsTotal} total`, paint),
    ...snap.reports.map((report) => `   ${paint.dim(report.time)} ${truncate(report.title, 50)}`)
  ].join('\n');
};

const CONTEXT_GROUPS: Array<{
  key: ContextGroup;
  label: string;
  code: number;
}> = [
  { key: 'instructions', label: 'instructions', code: CODES.cyan },
  { key: 'identity', label: 'identity', code: CODES.yellow },
  { key: 'facets', label: 'user facets', code: CODES.magenta },
  { key: 'knowledge', label: 'knowledge', code: CODES.green },
  { key: 'tasks', label: 'tasks', code: CODES.brightMagenta },
  { key: 'other', label: 'other', code: CODES.gray }
];

const panelLocations = (snap: StatusSnapshot, paint: Paint): string => {
  const { runtime } = snap;
  const row = (label: string, path: string) => `   ${leader(label, tildifyHome(path), 28, paint)}`;
  return [head('📍', 'Locations', '', paint), row('plugin', runtime.pluginRoot), row('home', runtime.home)].join('\n');
};

const manifestRows = (entries: ManifestEntry[], paint: Paint): string[] =>
  entries.map((entry) => {
    const code = entry.status === 'loaded' ? CODES.green : entry.status === 'missing' ? CODES.red : CODES.yellow;
    const note = entry.note ? paint.dim(`  (${entry.note})`) : '';
    return `   ${paint.c(STATUS_ICON[entry.status], code)} ${padTo(entry.label, 22)} ${padTo(humanBytes(entry.bytes), 8)}${note}`;
  });

const SEG_W = 54;

/** Segmented bar + legend for the static-context composition by group. */
const contextComposition = (snap: StatusSnapshot, paint: Paint): string[] => {
  const sums = CONTEXT_GROUPS.map((group) => ({
    ...group,
    bytes: snap.context.staticImports
      .filter((item) => item.group === group.key)
      .reduce((sum, item) => sum + item.bytes, 0)
  })).filter((group) => group.bytes > 0);
  const total = sums.reduce((sum, group) => sum + group.bytes, 0) || 1;
  const seg = stackedBar(
    sums.map((group) => ({ value: group.bytes, code: group.code })),
    SEG_W,
    paint
  );
  const legend = bulletList(
    sums.map(
      (group) =>
        `${paint.c('◼', group.code)} ${group.label} ${humanBytes(group.bytes)} ${Math.round((group.bytes / total) * 100)}%`
    ),
    '   ',
    paint
  );
  return [`   ${seg}`, legend];
};

const panelContext = (snap: StatusSnapshot, paint: Paint): string => {
  const { context } = snap;
  // Detail list with the 5 user facets rolled into one line.
  let facetsEmitted = false;
  const staticRows = context.staticImports.flatMap((item) => {
    if (item.group === 'facets') {
      if (facetsEmitted) return [];
      facetsEmitted = true;
      const facets = context.staticImports.filter((i) => i.group === 'facets');
      const bytes = facets.reduce((sum, i) => sum + i.bytes, 0);
      return [
        `   ${paint.c('✓', CODES.green)} ${padTo(`knowledge/user/* (${facets.length})`, 32)} ${paint.dim(humanBytes(bytes))}`
      ];
    }
    const code = item.present ? CODES.green : CODES.red;
    return [
      `   ${paint.c(item.present ? '✓' : '✗', code)} ${padTo(item.label, 32)} ${paint.dim(humanBytes(item.bytes))}`
    ];
  });
  return [
    [
      head(
        '📥',
        'Static context',
        `${context.staticImports.length} sources · ${humanBytes(context.staticBytes)}`,
        paint
      ),
      ...contextComposition(snap, paint),
      '',
      ...staticRows
    ].join('\n'),
    [
      head('🔄', 'Dynamic context', `SessionStart · ${humanBytes(context.dynamic.bytes)}`, paint),
      ...manifestRows(context.dynamic.entries, paint)
    ].join('\n')
  ].join('\n\n');
};

// ── tabs ──────────────────────────────────────────────────────────────

/** One-line context-size breakdown for the overview (dim ` · `-separated). */
const contextSummary = (snap: StatusSnapshot, paint: Paint): string => {
  const groupBytes = (key: ContextGroup) =>
    snap.context.staticImports.filter((item) => item.group === key).reduce((sum, item) => sum + item.bytes, 0);
  const dyn = (needle: string) =>
    snap.context.dynamic.entries.find((entry) => entry.label.includes(needle))?.bytes ?? 0;
  const items: Array<[string, number]> = [
    ['instructions', groupBytes('instructions')],
    ['identity', groupBytes('identity')],
    ['knowledge', groupBytes('knowledge')],
    ['tasks', groupBytes('tasks')],
    ['session', dyn('session')],
    ['reports', dyn('report')],
    ['git', dyn('git')]
  ];
  const total = snap.context.staticBytes + snap.context.dynamic.bytes;
  return [
    head('📚', 'Context', humanBytes(total), paint),
    bulletList(
      items.filter(([, bytes]) => bytes > 0).map(([label, bytes]) => `${label} ${humanBytes(bytes)}`),
      '   ',
      paint
    )
  ].join('\n');
};

const overview = (snap: StatusSnapshot, paint: Paint): string =>
  [
    panelRuntime(snap, paint),
    knowledgeSummary(snap, paint),
    contextSummary(snap, paint),
    [
      head('✅', 'Work', `${snap.tasks.projects} projects / ${snap.tasks.total} tasks`, paint),
      loadDots(snap, paint)
    ].join('\n'),
    panelReports(snap, paint),
    panelLocations(snap, paint),
    panelLogs(snap, paint, true)
  ]
    .filter(Boolean)
    .join('\n\n');

const TAB_BODY: Record<Tab, (snap: StatusSnapshot, paint: Paint) => string> = {
  overview,
  knowledge: panelKnowledge,
  work: panelWork,
  system: (snap, paint) => [panelSkills(snap, paint), panelMcp(snap, paint), panelLogs(snap, paint)].join('\n\n'),
  context: panelContext,
  settings: panelSettings
};

/** Compact system-status badge for the banner's top-right corner. */
const compactStatus = (snap: StatusSnapshot, paint: Paint): string => {
  const { health } = snap;
  if (health.ok) return `${paint.c('🟢', CODES.green)} ${paint.c('all systems nominal', CODES.green)}`;
  const issues = [
    health.overdue && `${health.overdue} overdue`,
    health.pendingCompiles && `${health.pendingCompiles} pending`,
    health.logErrors && `${health.logErrors} errors`,
    health.missingImports && `${health.missingImports} missing`,
    health.stale && `${health.stale} stale`
  ].filter(Boolean);
  return `${paint.c('🟠', CODES.yellow)} ${paint.c(issues.join(' · '), CODES.yellow)}`;
};

const bannerBlock = (snap: StatusSnapshot, paint: Paint): string => {
  const art = BANNER_LINES.map((line) => paint.c(line, CODES.brightYellow));
  // System status sits top-right, across from the wordmark.
  const status = compactStatus(snap, paint);
  const gap = Math.max(2, WIDTH - visibleWidth(art[0]) - visibleWidth(status));
  art[0] = `${art[0]}${' '.repeat(gap)}${status}`;
  const tag = `${paint.c(BANNER_TAG, CODES.brightCyan)} ${paint.dim(`v${snap.runtime.version}`)}`;
  return [...art, tag].join('\n');
};

export interface RenderOptions {
  tab?: Tab;
  color?: ColorMode;
  banner?: boolean;
  /** Draw the tab bar in the header (interactive TTY). Off for static renders. */
  tabBar?: boolean;
}

/** Render a single tab from an already-collected snapshot (used by the
 *  interactive loop, which collects once and re-renders on key presses). */
export const renderSnapshot = (snapshot: StatusSnapshot, options: RenderOptions, paint: Paint): string => {
  const tab: Tab = options.tab ?? 'overview';
  const blocks: string[] = [];
  // Banner carries identity + version + status badge; shown unless disabled.
  if (options.banner !== false) blocks.push(bannerBlock(snapshot, paint));
  // The tab bar only appears in the interactive TTY (where it's switchable).
  if (options.tabBar) blocks.push(tabBox(tab, paint));
  blocks.push(TAB_BODY[tab](snapshot, paint));
  return `\n${blocks.join('\n\n')}\n`;
};

export const renderStatus = async (options: RenderOptions = {}): Promise<string> => {
  const snapshot = await collectStatus();
  const paint = makePaint(colorEnabled(options.color ?? 'auto'));
  return renderSnapshot(snapshot, options, paint);
};
