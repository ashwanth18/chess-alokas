import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../db.js';
import { organizationsPlugin } from './organizations.js';
import { teamPlugin } from './team.js';

/** What needs a controllable environment. Rules shared by both stores are in storeContract.test.ts. */
describe('team routes: email, links and rate limits', () => {
  let app: FastifyInstance;
  let owner: string;
  let orgId: string;
  const saved = { ...process.env };

  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as never,
      headers: { 'x-test-user-id': owner, ...headers },
    });

  beforeEach(async () => {
    process.env['AUTH_DISABLED'] = '1';
    delete process.env['RESEND_API_KEY'];
    delete process.env['PUBLIC_APP_URL'];
    owner = crypto.randomUUID();
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
      void reply.code(statusCode).send({ error: (error as Error).message });
    });
    const store = new MemoryStore();
    await app.register(organizationsPlugin, { store });
    await app.register(teamPlugin, { store });
    const created = await post('/organizations', { name: 'Riverside Chess Club' });
    orgId = created.json().organization.id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
    await app.close();
  });

  it('builds the link from server config, whatever the Host header says', async () => {
    process.env['PUBLIC_APP_URL'] = 'https://app.example.test/';
    const res = await post(
      `/organizations/${orgId}/invites`,
      { email: 'dana@example.com', role: 'director' },
      { host: 'evil.example.test', 'x-forwarded-host': 'evil.example.test' },
    );
    expect(res.json().inviteUrl).toMatch(/^https:\/\/app\.example\.test\/invite\/[\w-]{43}$/);
  });

  it('defaults the link to the production site', async () => {
    const res = await post(`/organizations/${orgId}/invites`, {
      email: 'dana@example.com',
      role: 'director',
    });
    expect(res.json().inviteUrl).toMatch(/^https:\/\/chess-manager\.alokas\.com\/invite\//);
  });

  it('emails the link when Resend is configured, escaping the organization name', async () => {
    process.env['RESEND_API_KEY'] = 'test-key';
    owner = crypto.randomUUID();
    const created = await post('/organizations', { name: 'Second <b>Club</b>' });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await post(`/organizations/${created.json().organization.id}/invites`, {
      email: 'dana@example.com',
      role: 'arbiter',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().emailStatus).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { to: string[]; html: string };
    expect(body.to).toEqual(['dana@example.com']);
    expect(body.html).toContain(res.json().inviteUrl);
    expect(body.html).toContain('Second &lt;b&gt;Club&lt;/b&gt;');
    expect(body.html).not.toContain('<b>Club');
  });

  it('still returns a usable link when the email fails', async () => {
    process.env['RESEND_API_KEY'] = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const failed = await post(`/organizations/${orgId}/invites`, {
      email: 'one@example.com',
      role: 'arbiter',
    });
    expect(failed.statusCode).toBe(201);
    expect(failed.json().emailStatus).toBe('failed');
    expect(failed.json().inviteUrl).toContain('/invite/');

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const offline = await post(`/organizations/${orgId}/invites`, {
      email: 'two@example.com',
      role: 'arbiter',
    });
    expect(offline.statusCode).toBe(201);
    expect(offline.json().emailStatus).toBe('failed');
  });

  it('limits how many invites one person can send in an hour', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await post(`/organizations/${orgId}/invites`, {
        email: `person${i}@example.com`,
        role: 'arbiter',
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('a suspended organization cannot invite', async () => {
    const store = new MemoryStore();
    const local = Fastify();
    await local.register(organizationsPlugin, { store });
    await local.register(teamPlugin, { store });
    const created = await local.inject({
      method: 'POST',
      url: '/organizations',
      payload: { name: 'Paused Club' },
      headers: { 'x-test-user-id': owner },
    });
    const id = created.json().organization.id;
    await store.adminUpdateOrganization(id, { verificationStatus: 'suspended' });
    const res = await local.inject({
      method: 'POST',
      url: `/organizations/${id}/invites`,
      payload: { email: 'dana@example.com', role: 'arbiter' },
      headers: { 'x-test-user-id': owner },
    });
    expect(res.statusCode).toBe(403);
    await local.close();
  });
});
