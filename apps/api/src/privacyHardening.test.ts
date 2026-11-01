import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { PRIVACY_NOTICE_VERSION, guardianConsentRequired, isUnder18 } from '@chess-alokas/shared';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from './db.js';
import { apiLoggerOptions, redactPagePath, redactPath, redactUrl } from './lib/logRedaction.js';
import { scrubServerEvent } from './sentry.js';
import { importPlugin } from './routes/import.js';
import { readFileSync } from 'node:fs';

const NOW = new Date('2026-11-01T00:00:00Z');

describe('who would need guardian consent, kept for the stricter rules', () => {
  it('reads age from a date of birth exactly', () => {
    expect(isUnder18({ dateOfBirth: '2008-11-02' }, NOW)).toBe(true);
    expect(isUnder18({ dateOfBirth: '2008-11-01' }, NOW)).toBe(false);
  });

  it('counts someone turning 18 this year as under 18, when only the year is known', () => {
    expect(isUnder18({ yearOfBirth: 2008 }, NOW)).toBe(true);
    expect(isUnder18({ yearOfBirth: 2007 }, NOW)).toBe(false);
  });

  it('believes either signal that says under 18', () => {
    expect(isUnder18({ age: 30, yearOfBirth: 2015 }, NOW)).toBe(true);
    expect(isUnder18({ age: 12, yearOfBirth: 1990 }, NOW)).toBe(true);
    expect(isUnder18({}, NOW)).toBeNull();
  });

  it.each([
    [{ relationship: 'child' as const, yearOfBirth: 1980 }, true],
    [{ relationship: 'self' as const }, false],
    [{ relationship: 'self' as const, age: 14 }, true],
    [{ relationship: 'self' as const, age: 40 }, false],
    [{ relationship: 'student' as const }, true],
    [{ relationship: 'student' as const, age: 40 }, false],
    [{ relationship: 'family' as const, age: 10 }, true],
    [{}, true],
    [{ age: 40 }, false],
    [{ relationship: null, age: 12 }, true],
  ])('%j -> %s', (facts, expected) => {
    expect(guardianConsentRequired(facts, NOW)).toBe(expected);
  });
});

describe('what reaches logs, statistics and error reports', () => {
  it('takes location and search out of a logged address, and keeps the rest', () => {
    const out = redactUrl('/public/events?lat=3.14&lng=101.6&search=my%20school&radiusKm=50');
    expect(out).toBe('/public/events?lat=[redacted]&lng=[redacted]&search=[redacted]&radiusKm=50');
    expect(redactUrl('/health')).toBe('/health');
    expect(redactUrl('/x?LAT=1&%6Cng=2')).not.toMatch(/=1|=2/);
  });

  it('takes link secrets out of a path', () => {
    expect(redactPath('/public/live/abc123/standings')).toBe('/public/live/[redacted]/standings');
    expect(redactPath('/public/tables/slug1')).toBe('/public/tables/[redacted]');
    expect(redactPagePath('/live/abc123/tv?x=1#y')).toBe('/live/[redacted]/tv');
    expect(redactPagePath('/invite/secret')).toBe('/invite/[redacted]');
    expect(redactPagePath('/t/slug')).toBe('/t/[redacted]');
    expect(redactPagePath('/discover')).toBe('/discover');
    expect(redactPagePath('/tournaments/live')).toBe('/tournaments/live');
  });

  it('a real request writes no coordinates or search to the API log', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = Fastify({ logger: { ...apiLoggerOptions(), stream, level: 'info' } });
    app.get('/public/events', async () => ({ ok: true }));
    app.get('/public/live/:token', async () => ({ ok: true }));
    await app.inject({ url: '/public/events?lat=3.1412&lng=101.6869&search=Secret%20School' });
    await app.inject({ url: '/public/live/topsecrettoken' });
    await app.close();
    const log = lines.join('');
    expect(log).toContain('/public/events');
    expect(log).toContain('[redacted]');
    expect(log).not.toMatch(/3\.1412|101\.6869|Secret|topsecrettoken/);
  });

  it('error reports carry an opaque id, no email, no address details', () => {
    const event = scrubServerEvent({
      user: { id: 'u1', email: 'someone@example.com', ip_address: '1.2.3.4' },
      request: {
        url: 'https://x.test/public/events?lat=3.14&search=Kid',
        query_string: 'lat=3.14',
        headers: { authorization: 'Bearer abc', accept: 'json' },
      },
    });
    expect(event.user).toEqual({ id: 'u1' });
    expect(JSON.stringify(event)).not.toMatch(/someone@|1\.2\.3\.4|3\.14|Kid|Bearer abc/);
  });

  it('the API sets no email on error reports', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/setUser\([^)]*email/s);
  });
});

describe('page views', () => {
  afterEach(() => vi.doUnmock('../src/auth.js'));

  it('stores a live link only in redacted form', async () => {
    const inserts: unknown[][] = [];
    vi.resetModules();
    vi.doMock('./auth.js', async (original) => ({
      ...(await original<typeof import('./auth.js')>()),
      getDatabaseSql: () => (_s: TemplateStringsArray, ...values: unknown[]) => {
        inserts.push(values);
        return Promise.resolve([]);
      },
    }));
    const { publicAnalyticsPlugin } = await import('./routes/publicAnalytics.js');
    const app = Fastify();
    await app.register(publicAnalyticsPlugin);
    const res = await app.inject({
      method: 'POST',
      url: '/public/analytics/pageview',
      payload: { path: '/live/raw-live-token/tv?from=qr', routeKey: 'live', liveToken: 'raw-live-token' },
    });
    await app.close();
    expect(res.statusCode).toBe(204);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]![0]).toBe('/live/[redacted]/tv');
    expect(JSON.stringify(inserts)).not.toContain('raw-live-token');
  });
});

describe('roster import', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111';
  let store: MemoryStore;

  function form(fields: Record<string, string>, csv = 'Name,Age\nAvery Tan,12\n') {
    const boundary = 'x-boundary';
    const parts = Object.entries(fields).map(
      ([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
    );
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="r.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
    );
    return {
      payload: `${parts.join('')}--${boundary}--\r\n`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-test-user-id': OWNER },
    };
  }

  beforeEach(() => {
    process.env['AUTH_DISABLED'] = '1';
    store = new MemoryStore();
  });

  async function build() {
    const app = Fastify();
    await app.register(multipart);
    await app.register(importPlugin, { store });
    const t = await store.createTournament({
      id: crypto.randomUUID(),
      name: 'Roster Test',
      style: 'swiss',
      rounds: 3,
      status: 'draft',
      currentRound: 0,
      confirmedRounds: 0,
      mixCategories: false,
      prizePlaces: 3,
      awardScope: 'per_category',
      sharedPlaces: true,
      tableCount: 0,
      publicEnabled: false,
      ownerId: OWNER,
      updatedAt: new Date().toISOString(),
    });
    return { app, id: t.id };
  }
  const mapping = JSON.stringify({ name: 'Name', age: 'Age' });

  it('imports without the field and records nothing', async () => {
    const { app, id } = await build();
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${id}/import`,
      ...form({ mapping }),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(await store.listParticipants(id)).toHaveLength(1);
    expect(await store.listRosterConsents(id)).toEqual([]);
    await app.close();
  });

  it('with the field, records who saw the notice, when and which version', async () => {
    const { app, id } = await build();
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${id}/import`,
      ...form({ mapping, consentConfirmed: 'true' }),
    });
    expect(res.statusCode, res.body).toBe(201);
    const [record] = await store.listRosterConsents(id);
    expect(record).toMatchObject({ userId: OWNER, noticeVersion: PRIVACY_NOTICE_VERSION });
    await app.close();
  });
});

describe('deployment settings', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('caps log size for both services', () => {
    const compose = read('../../../deploy/docker-compose.yml');
    expect(compose).toMatch(/max-size: "10m"/);
    expect(compose).toMatch(/max-file: "5"/);
    expect(compose.match(/logging: \*logging/g)).toHaveLength(2);
  });

  it('nginx logs no query string or link secret', () => {
    const nginx = read('../../../deploy/nginx.conf');
    expect(nginx).toMatch(/access_log \S+ no_query;/);
    const format = /log_format no_query ([^;]*);/.exec(nginx)?.[1] ?? '';
    expect(format).toContain('$log_path');
    expect(format).not.toMatch(/\$request\b|\$request_uri|\$args|\$query_string/);
  });
});
