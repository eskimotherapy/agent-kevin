/**
 * Generic Postgres MCP tools. Unlike a hardcoded list of named environments,
 * connections are discovered at call time from any `KEVIN_DB_<NAME>` env var —
 * add a connection by adding an env line to `.claude/settings.local.json`,
 * no code change. Connections are pooled per env key and lazy.
 *
 * Three read-only tools:
 *   db_list   — names + credential-stripped host/db of configured connections
 *   db_schema — list tables, or describe one table's columns
 *   db_query  — arbitrary read-only SQL
 *
 * Every query runs inside a `BEGIN READ ONLY` transaction with a
 * `statement_timeout`, always rolled back — Postgres itself rejects any
 * write (error 25006), so reads are enforced by the server, not by parsing SQL.
 */
import { defineTool, type ToolDef } from '@/shared/types';
import pg from 'pg';
import { z } from 'zod';

const { Pool } = pg;

const ENV_PREFIX = 'KEVIN_DB_';

interface Connection {
  name: string;
  envKey: string;
}

/** Every `KEVIN_DB_<NAME>` env var, as `{ name, envKey }`. Name is lowercased. */
export const discoverConnections = (): Connection[] =>
  Object.keys(process.env)
    .filter((key) => key.startsWith(ENV_PREFIX) && key.length > ENV_PREFIX.length && process.env[key]?.trim())
    .map((envKey) => ({ name: envKey.slice(ENV_PREFIX.length).toLowerCase(), envKey }))
    .sort((first, second) => first.name.localeCompare(second.name));

/** Resolve a free-form connection name to its env key. */
const envKeyFor = (name: string): string => ENV_PREFIX + name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

/** Parse a connection URL into display metadata, dropping all credentials. */
export const safeConnectionInfo = (url: string): { host: string; port: string; database: string } => {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, '') || ''
    };
  } catch {
    return { host: '(unparseable URL)', port: '', database: '' };
  }
};

const pools = new Map<string, pg.Pool>();

/** Lazy, cached pool for a connection name. Throws (listing names) if unknown. */
const getPool = (name: string): pg.Pool => {
  const envKey = envKeyFor(name);
  const existing = pools.get(envKey);
  if (existing) return existing;
  const url = process.env[envKey]?.trim();
  if (!url) {
    const available = discoverConnections().map((connection) => connection.name);
    const hint = available.length
      ? `Available connections: ${available.join(', ')}.`
      : `No connections configured. Add a KEVIN_DB_<NAME> env var to .claude/settings.local.json.`;
    throw new Error(`Unknown database connection "${name}" (looked for ${envKey}). ${hint}`);
  }
  const pool = new Pool({ connectionString: url, max: 4 });
  pools.set(envKey, pool);
  return pool;
};

/** Run a callback inside a rolled-back READ ONLY transaction with a timeout. */
const inReadOnlyTx = async <Result>(
  name: string,
  timeoutMs: number,
  run: (client: pg.PoolClient) => Promise<Result>
): Promise<Result> => {
  const client = await getPool(name).connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
    return await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
};

const TABLES_SQL = `
  SELECT table_schema AS schema, table_name AS name, table_type AS type
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name
`;

const COLUMNS_SQL = `
  SELECT table_schema AS schema, column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS default
  FROM information_schema.columns
  WHERE table_name = $1 AND ($2::text IS NULL OR table_schema = $2)
  ORDER BY table_schema, ordinal_position
`;

export const tools: ToolDef[] = [
  defineTool({
    name: 'db_list',
    description:
      'List the Postgres connections available to query. Each is configured via a KEVIN_DB_<NAME> env var. Returns name + host/port/database only — never credentials or the connection string.',
    inputSchema: {},
    handler: async () => {
      const connections = discoverConnections().map((connection) => ({
        name: connection.name,
        ...safeConnectionInfo(process.env[connection.envKey] ?? '')
      }));
      if (!connections.length) {
        return {
          connections: [],
          hint: 'No connections configured. Add a KEVIN_DB_<NAME> env var (e.g. KEVIN_DB_APP) to .claude/settings.local.json under "env".'
        };
      }
      return { connections };
    }
  }),
  defineTool({
    name: 'db_schema',
    description:
      'Inspect a Postgres database structure (read-only). Without `table`, lists all user tables {schema, name, type}. With `table`, describes its columns {name, type, nullable, default}. Use this before db_query to learn table and column names.',
    inputSchema: {
      connection: z.string().describe('Connection name from db_list (e.g. "app").'),
      table: z.string().optional().describe('Table name to describe. Omit to list all tables.'),
      schema: z.string().optional().describe('Schema to disambiguate when the table name exists in several (e.g. "public").')
    },
    handler: async ({ connection, table, schema }) => {
      return inReadOnlyTx(connection, 30000, async (client) => {
        if (table) {
          const result = await client.query({ text: COLUMNS_SQL, values: [table, schema ?? null] });
          if (!result.rowCount) throw new Error(`Table "${table}" not found in connection "${connection}".`);
          return { connection, table, columns: result.rows };
        }
        const result = await client.query(TABLES_SQL);
        return { connection, tableCount: result.rowCount, tables: result.rows };
      });
    }
  }),
  defineTool({
    name: 'db_query',
    description:
      'Run a read-only SQL query against a configured Postgres connection. Executes inside a READ ONLY transaction with a statement timeout — writes (INSERT/UPDATE/DELETE/DDL) are rejected by Postgres. Returns rows + column metadata as JSON.',
    inputSchema: {
      connection: z.string().describe('Connection name from db_list (e.g. "app").'),
      sql: z.string().describe('The SQL statement. Read-only — DML/DDL is rejected by the transaction.'),
      params: z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .describe('Optional positional parameters ($1, $2, ...).'),
      timeout_ms: z.number().int().min(100).max(300000).optional().describe('Query timeout in ms (default 30000).')
    },
    handler: async ({ connection, sql, params, timeout_ms }) => {
      return inReadOnlyTx(connection, timeout_ms ?? 30000, async (client) => {
        const result = await client.query({ text: sql, values: params });
        return {
          connection,
          rowCount: result.rowCount,
          fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
          rows: result.rows
        };
      });
    }
  })
];
