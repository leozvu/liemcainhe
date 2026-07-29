import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import worker from '../worker/index.js';
import { roleCan } from '../services/authService';

const root = path.join(__dirname, '..');
const workerSource = readFileSync(path.join(root, 'worker', 'index.js'), 'utf8');
const migrationSource = readFileSync(path.join(root, 'drizzle', '0012_team_auth.sql'), 'utf8');
const indexSource = readFileSync(path.join(root, 'index.tsx'), 'utf8');

const countDb = (count = 0) => ({
  prepare: () => ({
    bind() { return this; },
    first: async () => ({ count }),
    run: async () => ({ success: true, meta: { changes: 1 } }),
  }),
});

describe('Egoric team authentication contract', () => {
  it('stores password and session material only as hashes', () => {
    expect(migrationSource).toContain('password_salt TEXT NOT NULL');
    expect(migrationSource).toContain('password_hash TEXT NOT NULL');
    expect(migrationSource).toContain('token_hash TEXT PRIMARY KEY NOT NULL');
    expect(migrationSource).not.toMatch(/password\s+TEXT/i);
    expect(workerSource).toContain("name: 'PBKDF2'");
    expect(workerSource).toContain("hash: 'SHA-256'");
    expect(workerSource).toContain('AUTH_PASSWORD_ITERATIONS = 210_000');
  });

  it('issues a hardened, server-only session cookie', () => {
    expect(workerSource).toContain("AUTH_SESSION_COOKIE = '__Host-egoric_session'");
    expect(workerSource).toContain('HttpOnly; SameSite=Lax');
    expect(workerSource).toContain("headers.delete('oai-authenticated-user-email')");
    expect(workerSource).toContain("headers.set('oai-authenticated-user-email', identity.workspaceOwnerEmail)");
  });

  it('ignores a spoofed ChatGPT identity when app-owned auth is enabled', async () => {
    const response = await worker.fetch(new Request('https://studio.test/api/cloud/projects', {
      headers: { 'oai-authenticated-user-email': 'owner@egoric.vn' },
    }), { EGORIC_BOOTSTRAP_TOKEN: 'configured', DB: {}, MEDIA: {} });
    expect(response.status).toBe(401);
  });

  it('reports first-run setup without exposing the bootstrap token', async () => {
    const response = await worker.fetch(new Request('https://studio.test/api/auth/state'), {
      EGORIC_BOOTSTRAP_TOKEN: 'never-return-this',
      DB: countDb(0),
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({ authEnabled: true, setupRequired: true, user: null });
    expect(JSON.stringify(payload)).not.toContain('never-return-this');
  });

  it('rejects an invalid first-run code before writing a user', async () => {
    const response = await worker.fetch(new Request('https://studio.test/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://studio.test' },
      body: JSON.stringify({
        email: 'owner@egoric.vn', displayName: 'Owner', password: 'password1234', bootstrapToken: 'wrong',
      }),
    }), { EGORIC_BOOTSTRAP_TOKEN: 'correct', DB: countDb(0) });
    expect(response.status).toBe(401);
  });

  it('keeps the role matrix least-privileged in both client and server contracts', () => {
    expect(roleCan('owner', 'team:manage')).toBe(true);
    expect(roleCan('director', 'production:use')).toBe(true);
    expect(roleCan('editor', 'production:use')).toBe(true);
    expect(roleCan('account', 'production:use')).toBe(false);
    expect(roleCan('account', 'finance:write')).toBe(true);
    expect(workerSource).toContain("account: new Set(['workspace:read', 'workspace:write', 'review:write', 'distribution:write', 'finance:read', 'finance:write'])");
  });

  it('mounts auth before the application and its alert provider', () => {
    expect(indexSource.indexOf('<AuthGate>')).toBeGreaterThan(-1);
    expect(indexSource.indexOf('<AuthGate>')).toBeLessThan(indexSource.indexOf('<App />'));
  });
});
