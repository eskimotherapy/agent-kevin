import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { discoverConnections, safeConnectionInfo } from '@/tools/database';

describe('discoverConnections', () => {
  const added: string[] = [];
  const setEnv = (key: string, value: string) => {
    added.push(key);
    process.env[key] = value;
  };

  beforeEach(() => {
    added.length = 0;
  });
  afterEach(() => {
    for (const key of added) delete process.env[key];
  });

  test('discovers KEVIN_DB_* vars, lowercases the name, sorts by name', () => {
    setEnv('KEVIN_DB_ZED', 'postgres://u:p@h/z');
    setEnv('KEVIN_DB_ANALYTICS', 'postgres://u:p@h/a');
    const names = discoverConnections().map((connection) => connection.name);
    expect(names).toContain('analytics');
    expect(names).toContain('zed');
    expect(names.indexOf('analytics')).toBeLessThan(names.indexOf('zed'));
  });

  test('ignores empty values and the bare prefix', () => {
    setEnv('KEVIN_DB_EMPTY', '   ');
    setEnv('KEVIN_DB_', 'postgres://u:p@h/x');
    const names = discoverConnections().map((connection) => connection.name);
    expect(names).not.toContain('empty');
    expect(names).not.toContain('');
  });
});

describe('safeConnectionInfo', () => {
  test('strips username and password, keeps host/port/database', () => {
    const info = safeConnectionInfo('postgres://admin:secret@db.example.com:6543/analytics');
    expect(info).toEqual({ host: 'db.example.com', port: '6543', database: 'analytics' });
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain('admin');
    expect(serialized).not.toContain('secret');
  });

  test('defaults the port to 5432 when absent', () => {
    expect(safeConnectionInfo('postgres://u:p@localhost/app').port).toBe('5432');
  });

  test('does not throw on an unparseable URL', () => {
    expect(safeConnectionInfo('not a url').host).toBe('(unparseable URL)');
  });
});
