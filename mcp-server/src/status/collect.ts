/**
 * Status snapshot collector.
 *
 * Reads every surface that makes up "what Kevin is right now" — skills, MCP
 * tools, hooks, knowledge wiki, compile state, tasks, loaded context, layered
 * settings, logs — and returns a typed snapshot. Every read is best-effort:
 * a missing or malformed source degrades to a sentinel, never throws, so the
 * screen renders on a half-initialized HOME.
 *
 * Paths in: always via FOLDERS/FILES (@/config). Paths out: callers render
 * through repoRelative()/tildify so absolute machine paths never leak.
 */
import { FILES, FOLDERS, PLUGIN_NAME, TIMEZONE } from '@/config';
import { contextManifest, type ManifestEntry } from '@/context';
import { nowTime } from '@/shared/date';
import type { TaskFile } from '@/shared/types';
import { discoverProjects, scanAllTasks } from '@/tasks/scan';
import { resolveTasks } from '@/tasks/resolve';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface SettingsLayer {
  label: string;
  path: string;
  present: boolean;
}

export interface EnvEntry {
  key: string;
  value: string;
  scope: 'user' | 'workspace';
}

export interface PluginRef {
  ref: string;
  marketplace: string;
  sourceType: string;
  sourcePath: string;
}

export interface FacetSize {
  name: string;
  bytes: number;
}

export interface CompileEntry {
  day: string;
  cost: number;
  at: string;
}

export interface ReportRef {
  time: string;
  title: string;
}

export interface Health {
  overdue: number;
  stale: number;
  pendingCompiles: number;
  logErrors: number;
  missingImports: number;
  ok: boolean;
}

export type ContextGroup = 'instructions' | 'identity' | 'facets' | 'knowledge' | 'tasks' | 'other';

export interface SessionDay {
  day: string;
  label: string;
  bytes: number;
}

export interface StaticImport {
  label: string;
  bytes: number;
  present: boolean;
  group: ContextGroup;
}

export interface ProjectLoad {
  project: string;
  open: number;
  active: number;
  blocked: number;
  total: number;
}

export interface TaskRef {
  id: string;
  title: string;
  priority: string;
  project: string;
}

export interface HookEntry {
  event: string;
  command: string;
}

export interface StatusSnapshot {
  runtime: {
    version: string;
    pluginName: string;
    home: string;
    pluginRoot: string;
    knowledgePath: string;
    projectsPath: string;
    reportsPath: string;
    statePath: string;
    logsPath: string;
    timezone: string;
    date: string;
    time: string;
  };
  skills: { count: number; names: string[]; custom: number };
  mcp: { servers: string[]; toolCount: number; tools: string[] };
  hooks: { events: string[]; count: number; entries: HookEntry[] };
  knowledge: {
    concepts: number;
    conceptNames: string[];
    userFacets: number;
    facets: FacetSize[];
    memoryDaily: number;
    memoryIndexBytes: number;
    activeThreads: number;
    learnings: number;
    inboxItems: number;
    feedbackBytes: number;
    totalBytes: number;
    sessionsWeek: SessionDay[];
  };
  compile: {
    ingested: number;
    sessionFiles: number;
    pending: number;
    lastCompiled: string | null;
    totalCostUsd: number;
    recent: CompileEntry[];
  };
  tasks: {
    active: number;
    blocked: number;
    open: number;
    stale: number;
    overdue: number;
    total: number;
    projects: number;
    byProject: ProjectLoad[];
    overdueList: TaskRef[];
    staleList: TaskRef[];
    activeList: TaskRef[];
  };
  context: {
    source: string;
    staticImports: StaticImport[];
    staticBytes: number;
    dynamic: { date: string; entries: ManifestEntry[]; bytes: number };
  };
  settings: {
    layers: SettingsLayer[];
    allow: number;
    deny: number;
    env: EnvEntry[];
    enabledPlugins: string[];
    plugin: PluginRef | null;
  };
  logs: {
    path: string;
    bytes: number;
    mtime: string | null;
    warnings: number;
    errors: number;
    totalWarnings: number;
    totalErrors: number;
    lastError: string | null;
  };
  reports: ReportRef[];
  reportsTotal: number;
  health: Health;
}

const MARKDOWN_RE = /\.md$/;
const SECRET_KEY_RE =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CRED|PRIVATE|OAUTH|SESSION|DB_URL|DB_URI|DATABASE|DSN|CONN|MCP_DB)/i;
/** A connection string with embedded credentials — `scheme://user:pass@host`.
 *  Caught by value so DB URLs are masked regardless of their env-var name. */
const CRED_URL_RE = /:\/\/[^\s:@/]+:[^\s@/]+@/;

/** Count entries in a directory matching a predicate; 0 if the dir is absent. */
const countDir = (dir: string, predicate: (name: string) => boolean): number => {
  try {
    return readdirSync(dir).filter(predicate).length;
  } catch {
    return 0;
  }
};

const listDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
};

const safeBytes = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/** Mask a secret value, preserving the last 4 chars when long enough to help
 *  identify which credential it is without exposing it. */
const maskValue = (value: string): string => (value.length > 8 ? `••••${value.slice(-4)}` : '••••••');

const collectSkills = (): StatusSnapshot['skills'] => {
  const hasSkill = (base: string) => (name: string) => existsSync(resolve(base, name, 'SKILL.md'));
  const pluginSkillsDir = resolve(FOLDERS.ROOT, 'skills');
  const names = listDirs(pluginSkillsDir)
    .filter(hasSkill(pluginSkillsDir))
    .sort((a, b) => a.localeCompare(b));
  const customDir = resolve(FOLDERS.HOME, '.claude', 'skills');
  const custom = listDirs(customDir).filter(hasSkill(customDir)).length;
  return { count: names.length + custom, names, custom };
};

const collectMcp = async (): Promise<StatusSnapshot['mcp']> => {
  const servers = new Set<string>();
  for (const path of [resolve(FOLDERS.ROOT, '.mcp.json'), resolve(FOLDERS.HOME, '.mcp.json')]) {
    const parsed = readJson<{ mcpServers?: Record<string, unknown> }>(path);
    Object.keys(parsed?.mcpServers ?? {}).forEach((name) => servers.add(name));
  }
  const tools = await collectMcpTools();
  return { servers: [...servers], toolCount: tools.length, tools };
};

/**
 * Authoritative tool list: gather the side-effect-free `tools` arrays exactly
 * as server.ts aggregates them. server.ts itself can't be imported (its
 * top-level `server.connect()` would start a server), so the module list is
 * mirrored here — keep in sync with server.ts's TOOLS assembly.
 */
const collectMcpTools = async (): Promise<string[]> => {
  const modules = [
    'capture',
    'compile',
    'google-page-speed',
    'google-search-console',
    'knowledge',
    'open-page-rank',
    'perplexity',
    'ping',
    'playwright',
    'reports',
    'serpapi',
    'tasks'
  ];
  const lists = await Promise.all(
    modules.map(async (name) => {
      try {
        const mod = (await import(`@/tools/${name}`)) as {
          tools?: Array<{ name?: string }>;
        };
        return (mod.tools ?? []).map((tool) => tool.name ?? '?');
      } catch {
        return [];
      }
    })
  );
  return lists.flat().sort((a, b) => a.localeCompare(b));
};

interface HookConfig {
  hooks?: Array<{ command?: string }>;
}

/** Reduce a hook command to a readable `kevin <verb>` summary. */
const summarizeHookCommand = (command: string): string => {
  const match = command.match(/bin\/kevin"?\s+([a-z-]+(?:\s+--?[a-z-]+=?\S*)?)/);
  return match ? `kevin ${match[1]}` : command.split(/\s+/).slice(0, 3).join(' ');
};

const collectHooks = (): StatusSnapshot['hooks'] => {
  const parsed = readJson<{ hooks?: Record<string, HookConfig[]> }>(resolve(FOLDERS.ROOT, 'hooks', 'hooks.json'));
  const hookMap = parsed?.hooks ?? {};
  const events = Object.keys(hookMap);
  const entries: HookEntry[] = events.map((event) => {
    const command = hookMap[event]?.[0]?.hooks?.[0]?.command ?? '';
    return { event, command: command ? summarizeHookCommand(command) : '—' };
  });
  return { events, count: events.length, entries };
};

const listMarkdown = (dir: string, exclude: (name: string) => boolean = () => false): string[] => {
  try {
    return readdirSync(dir)
      .filter((name) => MARKDOWN_RE.test(name) && !exclude(name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

/** Recursively sum the bytes of every markdown file under a directory. */
const treeBytes = (dir: string): number => {
  try {
    return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) return sum + treeBytes(full);
      return MARKDOWN_RE.test(entry.name) ? sum + safeBytes(full) : sum;
    }, 0);
  } catch {
    return 0;
  }
};

/** Count `- ` bullet lines under a `## Heading` in a markdown file. */
const countBulletsUnder = (file: string, heading: string): number => {
  try {
    const lines = readFileSync(file, 'utf-8').split('\n');
    const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
    if (start === -1) return 0;
    let count = 0;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i] ?? '')) break;
      if (/^\s*[-*] /.test(lines[i] ?? '')) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
};

/** Byte size of each of the last 7 days' session transcripts (oldest first). */
const collectSessionsWeek = (): SessionDay[] => {
  const now = new Date();
  return Array.from({ length: 7 }, (_unused, offset) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (6 - offset));
    const iso = day.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    const label = day.toLocaleDateString('en-US', {
      timeZone: TIMEZONE,
      weekday: 'short'
    });
    return {
      day: iso,
      label,
      bytes: safeBytes(resolve(FOLDERS.SESSIONS, `${iso}.md`))
    };
  });
};

const collectKnowledge = (): StatusSnapshot['knowledge'] => {
  const conceptNames = listMarkdown(FOLDERS.CONCEPTS, (name) => name === 'index.md').map((name) =>
    name.replace(MARKDOWN_RE, '')
  );
  const facets = listMarkdown(FOLDERS.USER_KNOWLEDGE).map((name) => ({
    name: name.replace(MARKDOWN_RE, ''),
    bytes: safeBytes(resolve(FOLDERS.USER_KNOWLEDGE, name))
  }));
  return {
    concepts: conceptNames.length,
    conceptNames,
    userFacets: facets.length,
    facets,
    memoryDaily: countDir(FOLDERS.MEMORY, (name) => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(name)),
    memoryIndexBytes: safeBytes(FILES.MEMORY),
    activeThreads: countBulletsUnder(FILES.MEMORY, 'Active Threads'),
    learnings: countBulletsUnder(FILES.MEMORY, 'Learnings'),
    inboxItems: countDir(FOLDERS.INBOX_RAW, (name) => !name.startsWith('.')),
    feedbackBytes: safeBytes(FILES.FEEDBACK),
    sessionsWeek: collectSessionsWeek(),
    // Curated wiki only — concepts + facets + memory + index. Excludes
    // raw/sessions transcripts, which dwarf the wiki and aren't "knowledge".
    totalBytes:
      treeBytes(FOLDERS.CONCEPTS) +
      treeBytes(FOLDERS.USER_KNOWLEDGE) +
      treeBytes(FOLDERS.MEMORY) +
      safeBytes(FILES.KNOWLEDGE)
  };
};

interface IngestEntry {
  compiled_at?: string;
  cost_usd?: number;
}

const collectCompile = (): StatusSnapshot['compile'] => {
  const state = readJson<{ ingested?: Record<string, IngestEntry> }>(FILES.KNOWLEDGE_STATE);
  const ingestedMap = state?.ingested ?? {};
  const entries = Object.values(ingestedMap);
  const lastCompiled =
    entries
      .map((entry) => entry.compiled_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const totalCostUsd = entries.reduce((sum, entry) => sum + (entry.cost_usd ?? 0), 0);
  const sessionFiles = countDir(FOLDERS.SESSIONS, (name) => MARKDOWN_RE.test(name));
  const ingested = Object.keys(ingestedMap).length;
  const recent: CompileEntry[] = Object.entries(ingestedMap)
    .filter(([, entry]) => Boolean(entry.compiled_at))
    .sort(([, a], [, b]) => (b.compiled_at ?? '').localeCompare(a.compiled_at ?? ''))
    .slice(0, 7)
    .map(([file, entry]) => ({
      day: file.replace(MARKDOWN_RE, ''),
      cost: entry.cost_usd ?? 0,
      at: entry.compiled_at ?? ''
    }));
  return {
    ingested,
    sessionFiles,
    pending: Math.max(0, sessionFiles - ingested),
    lastCompiled,
    totalCostUsd,
    recent
  };
};

const toRef = (task: TaskFile): TaskRef => ({
  id: task.frontmatter.id,
  title: task.frontmatter.title,
  priority: task.frontmatter.priority,
  project: task.frontmatter.project
});

const OPEN_STATUSES = new Set(['open', 'active', 'blocked']);

const collectTasks = (): StatusSnapshot['tasks'] => {
  const all = scanAllTasks();
  const scan = resolveTasks(all);
  const byStatus = (status: string) => all.filter((task) => task.frontmatter.status === status).length;

  const projectMap = new Map<string, ProjectLoad>();
  for (const task of all) {
    const { project, status } = task.frontmatter;
    if (!OPEN_STATUSES.has(status)) continue;
    const load = projectMap.get(project) ?? {
      project,
      open: 0,
      active: 0,
      blocked: 0,
      total: 0
    };
    if (status === 'open') load.open += 1;
    else if (status === 'active') load.active += 1;
    else if (status === 'blocked') load.blocked += 1;
    load.total += 1;
    projectMap.set(project, load);
  }
  const byProject = [...projectMap.values()].sort((a, b) => b.total - a.total);

  return {
    active: byStatus('active'),
    blocked: byStatus('blocked'),
    open: byStatus('open'),
    stale: scan.stale.length,
    overdue: scan.overdue.length,
    total: all.length,
    projects: discoverProjects().length,
    byProject,
    overdueList: scan.overdue.map(toRef),
    staleList: scan.stale.map(toRef),
    activeList: all.filter((task) => task.frontmatter.status === 'active').map(toRef)
  };
};

/** Classify a static-context source into a group for the segmented bar. */
const classifyImport = (label: string): ContextGroup => {
  if (/CLAUDE(\.local)?\.md$/.test(label)) return 'instructions';
  if (/knowledge\/user\//.test(label)) return 'facets';
  if (/^(SOUL|IDENTITY|USER)\.md$/.test(label)) return 'identity';
  if (/index\.md$/.test(label)) return 'knowledge';
  if (/TASKS\.md$/.test(label)) return 'tasks';
  return 'other';
};

const collectContext = async (): Promise<StatusSnapshot['context']> => {
  const source = existsSync(FILES.CLAUDE) ? FILES.CLAUDE : FILES.CLAUDE_LOCAL;
  let labels: string[] = [];
  try {
    labels = readFileSync(source, 'utf-8')
      .split('\n')
      .map((line) => line.match(/^@(\S+)/)?.[1])
      .filter((value): value is string => Boolean(value));
  } catch {
    labels = [];
  }

  // Claude Code loads CLAUDE.md at the user (~/.claude) and project levels
  // *before* the project file's @-imports — surface them as instruction sources.
  const claudeChain: Array<{ label: string; path: string }> = [
    {
      label: '~/.claude/CLAUDE.md',
      path: resolve(homedir(), '.claude', 'CLAUDE.md')
    },
    { label: 'CLAUDE.md', path: FILES.CLAUDE },
    { label: 'CLAUDE.local.md', path: FILES.CLAUDE_LOCAL }
  ];
  const claudeImports: StaticImport[] = claudeChain
    .filter((entry) => existsSync(entry.path))
    .map((entry) => ({
      label: entry.label,
      bytes: safeBytes(entry.path),
      present: true,
      group: 'instructions' as const
    }));

  const atImports: StaticImport[] = labels.map((label) => {
    const bytes = safeBytes(resolve(FOLDERS.HOME, label));
    return { label, bytes, present: bytes > 0, group: classifyImport(label) };
  });

  const staticImports = [...claudeImports, ...atImports];
  const staticBytes = staticImports.reduce((sum, item) => sum + item.bytes, 0);

  const dynamic = await contextManifest().catch(() => ({
    date: '',
    entries: [] as ManifestEntry[],
    bytes: 0
  }));

  return { source, staticImports, staticBytes, dynamic };
};

const collectSettings = (): StatusSnapshot['settings'] => {
  const layerDefs: SettingsLayer[] = [
    {
      label: 'user',
      path: resolve(homedir(), '.claude', 'settings.json'),
      present: false
    },
    {
      label: 'project',
      path: resolve(FOLDERS.HOME, '.claude', 'settings.json'),
      present: false
    },
    {
      label: 'local',
      path: resolve(FOLDERS.HOME, '.claude', 'settings.local.json'),
      present: false
    }
  ];

  interface MarketplaceSource {
    source?: { source?: string; path?: string };
  }
  interface SettingsShape {
    permissions?: { allow?: string[]; deny?: string[] };
    env?: Record<string, string>;
    enabledPlugins?: Record<string, boolean>;
    extraKnownMarketplaces?: Record<string, MarketplaceSource>;
  }

  const env = new Map<string, { value: string; scope: EnvEntry['scope'] }>();
  const enabledPlugins = new Set<string>();
  const marketplaces: Record<string, MarketplaceSource> = {};
  let allow = 0;
  let deny = 0;

  const layers = layerDefs.map((layer) => {
    const parsed = readJson<SettingsShape>(layer.path);
    if (!parsed) return layer;
    const scope: EnvEntry['scope'] = layer.label === 'user' ? 'user' : 'workspace';
    allow += parsed.permissions?.allow?.length ?? 0;
    deny += parsed.permissions?.deny?.length ?? 0;
    Object.entries(parsed.env ?? {}).forEach(([key, value]) => env.set(key, { value, scope }));
    Object.entries(parsed.enabledPlugins ?? {}).forEach(([name, on]) => on && enabledPlugins.add(name));
    Object.assign(marketplaces, parsed.extraKnownMarketplaces ?? {});
    return { ...layer, present: true };
  });

  const redactedEnv: EnvEntry[] = [...env.entries()].map(([key, entry]) => ({
    key,
    value: SECRET_KEY_RE.test(key) || CRED_URL_RE.test(entry.value) ? maskValue(entry.value) : entry.value,
    scope: entry.scope
  }));

  // Resolve the current plugin's enabled ref + its marketplace source.
  const ref = [...enabledPlugins].find((name) => name.startsWith(`${PLUGIN_NAME}@`));
  const marketplace = ref?.split('@')[1] ?? '';
  const source = marketplaces[marketplace]?.source;
  const plugin: PluginRef | null = ref
    ? {
        ref,
        marketplace,
        sourceType: source?.source ?? 'unknown',
        sourcePath: source?.path ?? ''
      }
    : null;

  return {
    layers,
    allow,
    deny,
    env: redactedEnv,
    enabledPlugins: [...enabledPlugins],
    plugin
  };
};

// Anchor on the level field (right after the ISO-UTC timestamp) so a "WARN"/
// "ERROR" substring inside a message body never inflates the count.
const LEVEL_RE = /^\S+Z (WARN|ERROR) /;

const collectLogs = (): StatusSnapshot['logs'] => {
  const path = resolve(FOLDERS.LOGS, 'app.log');
  let bytes = 0;
  let mtime: string | null = null;
  let warnings = 0;
  let errors = 0;
  let totalWarnings = 0;
  let totalErrors = 0;
  let lastError: string | null = null;
  try {
    const stat = statSync(path);
    bytes = stat.size;
    mtime = stat.mtime.toLocaleTimeString('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit'
    });
    const today = new Date().toISOString().slice(0, 10);
    const lines = readFileSync(path, 'utf-8').split('\n');
    for (const line of lines) {
      const level = line.match(LEVEL_RE)?.[1];
      if (!level) continue;
      const isToday = line.startsWith(today);
      if (level === 'WARN') {
        totalWarnings += 1;
        if (isToday) warnings += 1;
      } else {
        totalErrors += 1;
        if (isToday) errors += 1;
        lastError = line.replace(LEVEL_RE, '').slice(0, 80);
      }
    }
  } catch {
    // no log yet
  }
  return {
    path,
    bytes,
    mtime,
    warnings,
    errors,
    totalWarnings,
    totalErrors,
    lastError
  };
};

const collectRuntime = (): StatusSnapshot['runtime'] => {
  const manifest = readJson<{ name?: string; version?: string }>(
    resolve(FOLDERS.ROOT, '.claude-plugin', 'plugin.json')
  );
  const now = new Date();
  return {
    version: manifest?.version ?? '0.0.0',
    pluginName: manifest?.name ?? 'agent-kevin',
    home: FOLDERS.HOME,
    pluginRoot: FOLDERS.ROOT,
    knowledgePath: FOLDERS.KNOWLEDGE,
    projectsPath: FOLDERS.PROJECTS,
    reportsPath: FOLDERS.REPORTS,
    statePath: FOLDERS.DATA,
    logsPath: FOLDERS.LOGS,
    timezone: TIMEZONE,
    date: now.toLocaleDateString('en-GB', {
      timeZone: TIMEZONE,
      weekday: 'short',
      day: '2-digit',
      month: 'short'
    }),
    time: nowTime(now)
  };
};

/** All report entries from reports/index.md (newest first). */
const collectReports = (): ReportRef[] => {
  try {
    return readFileSync(FILES.REPORTS_INDEX, 'utf-8')
      .split('\n')
      .map((line) => line.match(/^- (\d{2}:\d{2}) · \[([^\]]+)\]/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({ time: match[1], title: match[2] }));
  } catch {
    return [];
  }
};

const computeHealth = (snap: Omit<StatusSnapshot, 'health'>): Health => {
  const overdue = snap.tasks.overdue;
  const pendingCompiles = snap.compile.pending;
  const logErrors = snap.logs.errors;
  const missingImports = snap.context.staticImports.filter((item) => !item.present).length;
  return {
    overdue,
    stale: snap.tasks.stale,
    pendingCompiles,
    logErrors,
    missingImports,
    ok: overdue === 0 && pendingCompiles === 0 && logErrors === 0 && missingImports === 0
  };
};

export const collectStatus = async (): Promise<StatusSnapshot> => {
  const allReports = collectReports();
  const base = {
    runtime: collectRuntime(),
    skills: collectSkills(),
    mcp: await collectMcp(),
    hooks: collectHooks(),
    knowledge: collectKnowledge(),
    compile: collectCompile(),
    tasks: collectTasks(),
    context: await collectContext(),
    settings: collectSettings(),
    logs: collectLogs(),
    reports: allReports.slice(0, 5),
    reportsTotal: allReports.length
  };
  return { ...base, health: computeHealth(base) };
};
