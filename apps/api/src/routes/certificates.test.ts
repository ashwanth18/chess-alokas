/**
 * Bulk certificate email sends to exactly the certificates the organizer ticked on the review screen,
 * each checked against the tournament, within the daily cap, and never twice by accident. Both stores.
 * Resend is never contacted: fetch is replaced, and every address is on a reserved domain.
 */
import type { Organization } from '@chess-alokas/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_STORES, buildTestApp, type TestApp, type TestBackend } from '../testBackends.js';

const PDF = Buffer.from('%PDF-1.4 certificate').toString('base64');

type Sent = { to: string; subject: string };

describe.each(TEST_STORES)('certificate bulk email: %s', (_name, makeBackend) => {
  let backend: TestBackend;
  let t: TestApp;
  let owner: string;
  let arbiter: string;
  let outsider: string;
  let org: Organization;
  let tournamentId: string;
  let otherTournamentId: string;
  let outsiderTournamentId: string;
  /** What "Resend" received, in order. */
  let sent: Sent[];
  /** Addresses Resend refuses, for the failure path. */
  let bounce: Set<string>;

  const email = (tid: string, user: string, body: unknown) =>
    t.call(user, 'POST', `/tournaments/${tid}/certificates/email`, body);
  const list = async (tid = tournamentId) =>
    (await t.call(owner, 'GET', `/tournaments/${tid}/certificates`)).body.issues as Array<{
      id: string;
      recipientName: string;
      status: string;
      emailedAt?: string;
      error?: string;
    }>;

  /** Issues one certificate per name, returning ids in the same order. */
  async function issue(tid: string, people: Array<[string, string | null]>, user = owner): Promise<string[]> {
    const res = await t.call(user, 'POST', `/tournaments/${tid}/certificates/issue`, {
      items: people.map(([name, address]) => ({
        type: 'participation',
        recipientName: name,
        recipientEmail: address,
        pdfBase64: PDF,
      })),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.issues.map((i: { id: string }) => i.id);
  }

  beforeAll(async () => {
    backend = await makeBackend();
    t = await buildTestApp(backend);
    owner = await t.newUser();
    arbiter = await t.newUser();
    outsider = await t.newUser();
    org = await t.verifiedOrg(owner);
    await backend.addMember(org.id, arbiter, 'arbiter');
    tournamentId = (await t.seedTournament(owner, org.id, { name: 'Pretend Heights Rapid' })).id;
    otherTournamentId = (await t.seedTournament(owner, org.id, { name: 'Nowhere Road Blitz' })).id;
    const outsiderOrg = await t.verifiedOrg(outsider);
    outsiderTournamentId = (await t.seedTournament(outsider, outsiderOrg.id)).id;
  }, 180_000);

  afterAll(async () => {
    await t?.close();
    await backend?.close();
  });

  beforeEach(() => {
    sent = [];
    bounce = new Set();
    process.env['RESEND_API_KEY'] = 'test-key-not-real';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        expect(url).toBe('https://api.resend.com/emails');
        const body = JSON.parse(init.body) as { to: string[]; subject: string };
        if (bounce.has(body.to[0]!)) return new Response('The recipient address bounced', { status: 422 });
        sent.push({ to: body.to[0]!, subject: body.subject });
        return new Response('{"id":"fake"}', { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['RESEND_API_KEY'];
  });

  it('sends only to the ticked certificates and records each one as sent', async () => {
    const ids = await issue(tournamentId, [
      ['Tan Zwischen Zug', 'tan.zug@example.invalid'],
      ['Lim Gambit Ling', 'lim.gambit@example.invalid'],
      ['Chong Rook Hao', 'chong.rook@example.invalid'],
      ['Ng Pawn Mei', 'ng.pawn@example.invalid'],
    ]);
    const ticked = [ids[0]!, ids[2]!];
    const res = await email(tournamentId, owner, { issueIds: ticked });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ sent: 2, failed: 0, skipped: 0 });
    expect(sent.map((s) => s.to).sort()).toEqual(['chong.rook@example.invalid', 'tan.zug@example.invalid']);
    expect(sent[0]!.subject).toContain('Pretend Heights Rapid');

    const after = await list();
    const statusOf = (id: string) => after.find((i) => i.id === id)!;
    expect(statusOf(ids[0]!)).toMatchObject({ status: 'emailed' });
    expect(statusOf(ids[0]!).emailedAt).toBeTruthy();
    expect(statusOf(ids[2]!).status).toBe('emailed');
    expect(statusOf(ids[1]!).status).toBe('stored');
    expect(statusOf(ids[3]!).status).toBe('stored');
  });

  it('skips one already sent unless resend is asked for, so "already sent" stays true', async () => {
    const [id] = await issue(tournamentId, [['Yap Pin Yi', 'yap.pin@example.invalid']]);
    expect((await email(tournamentId, owner, { issueIds: [id] })).body.sent).toBe(1);
    sent = [];

    const again = await email(tournamentId, owner, { issueIds: [id] });
    expect(again.body).toMatchObject({ sent: 0, skipped: 1 });
    expect(again.body.results).toEqual([expect.objectContaining({ id, status: 'skipped', error: 'Already sent' })]);
    expect(sent).toEqual([]);

    const resend = await email(tournamentId, owner, { issueIds: [id], resend: true });
    expect(resend.body.sent).toBe(1);
    expect(sent.map((s) => s.to)).toEqual(['yap.pin@example.invalid']);
  });

  it('sends to two siblings who share one parent address, one email each', async () => {
    const ids = await issue(tournamentId, [
      ['PUTERI ALEKHINE DAMIA BINTI QUEEN GAMBIT', 'parent.alekhine@example.invalid'],
      ['PUTERI ALEKHINE DAMIA BINTI QUEEN INDIAN', 'parent.alekhine@example.invalid'],
    ]);
    const res = await email(tournamentId, owner, { issueIds: ids });
    expect(res.body.sent).toBe(2);
    expect(sent.map((s) => s.to)).toEqual(['parent.alekhine@example.invalid', 'parent.alekhine@example.invalid']);
  });

  it('skips a missing or mistyped address without failing the certificate or using the cap', async () => {
    const ids = await issue(tournamentId, [
      ['Teoh Rook Lift', null],
      ['Lee Skewer Xuan', 'not-an-address'],
      ['Priya Benoni a/p Philidor', 'priya.benoni@example.invalid'],
    ]);
    const quotaBefore = (await t.call(owner, 'GET', `/tournaments/${tournamentId}/certificates/email-quota`)).body;
    const res = await email(tournamentId, owner, { issueIds: ids });
    expect(res.body).toMatchObject({ sent: 1, failed: 0, skipped: 2 });
    const reasons = Object.fromEntries(
      res.body.results.map((r: { id: string; status: string; error?: string }) => [r.id, `${r.status}: ${r.error ?? ''}`]),
    );
    expect(reasons[ids[0]!]).toBe('skipped: No email address');
    expect(reasons[ids[1]!]).toBe('skipped: Email address is not valid');
    expect(reasons[ids[2]!]).toBe('emailed: ');
    expect(sent.map((s) => s.to)).toEqual(['priya.benoni@example.invalid']);

    const after = await list();
    expect(after.find((i) => i.id === ids[0])!.status).toBe('stored');
    expect(after.find((i) => i.id === ids[1])!.status).toBe('stored');
    const quotaAfter = (await t.call(owner, 'GET', `/tournaments/${tournamentId}/certificates/email-quota`)).body;
    expect(quotaAfter.used - quotaBefore.used).toBe(1);
  });

  it('reports a Resend failure per recipient, and a retry of only that one goes through', async () => {
    const ids = await issue(tournamentId, [
      ['Harish Catalan a/l Tartakower', 'harish.catalan@example.invalid'],
      ['Wan Rookiah Fianchetta binti Wan Back Rank', 'wan.rookiah@example.invalid'],
    ]);
    bounce.add('wan.rookiah@example.invalid');
    const res = await email(tournamentId, owner, { issueIds: ids });
    expect(res.body).toMatchObject({ sent: 1, failed: 1 });
    const failed = res.body.results.find((r: { id: string }) => r.id === ids[1]);
    expect(failed).toMatchObject({ status: 'failed', error: 'The recipient address bounced' });
    expect((await list()).find((i) => i.id === ids[1])).toMatchObject({ status: 'failed', error: 'The recipient address bounced' });

    bounce.clear();
    sent = [];
    const retry = await email(tournamentId, owner, { issueIds: [ids[1]!] });
    expect(retry.body).toMatchObject({ sent: 1, failed: 0 });
    expect(sent.map((s) => s.to)).toEqual(['wan.rookiah@example.invalid']);
  });

  it('refuses a list with an id from another of the same owner\'s tournaments, and sends nothing', async () => {
    const [mine] = await issue(tournamentId, [['Dayang Nimzo Indiana', 'dayang.nimzo@example.invalid']]);
    const [theirs] = await issue(otherTournamentId, [['Vikram Tempo', 'vikram.tempo@example.invalid']]);
    const res = await email(tournamentId, owner, { issueIds: [mine, theirs] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('1 of the chosen certificates is not in this tournament. Nothing was sent.');
    expect(res.body.unknownIds).toEqual([theirs]);
    expect(sent).toEqual([]);
    expect((await list()).find((i) => i.id === mine)!.status).toBe('stored');
  });

  it('refuses an id that is no certificate at all', async () => {
    const res = await email(tournamentId, owner, { issueIds: [crypto.randomUUID()] });
    expect(res.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('refuses a send with no ids, or the old "everyone pending" mode', async () => {
    await issue(tournamentId, [['Arjun Pirc', 'arjun.pirc@example.invalid']]);
    expect((await email(tournamentId, owner, {})).status).toBe(400);
    expect((await email(tournamentId, owner, { issueIds: [] })).status).toBe(400);
    expect((await email(tournamentId, owner, { allPending: true })).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('refuses someone from another organization, on the route and on the quota', async () => {
    const [id] = await issue(tournamentId, [['Muhammad Caro Kann', 'caro.kann@example.invalid']]);
    const res = await email(tournamentId, outsider, { issueIds: [id] });
    expect([403, 404]).toContain(res.status);
    const quota = await t.call(outsider, 'GET', `/tournaments/${tournamentId}/certificates/email-quota`);
    expect([403, 404]).toContain(quota.status);
    // Naming this tournament's certificate from their own tournament doesn't work either.
    const viaOwn = await email(outsiderTournamentId, outsider, { issueIds: [id] });
    expect(viaOwn.status).toBe(400);
    expect(sent).toEqual([]);
    expect((await list()).find((i) => i.id === id)!.status).toBe('stored');
  });

  it('refuses an arbiter of the same organization', async () => {
    const [id] = await issue(tournamentId, [['Kavitha Zugzwang', 'kavitha.zug@example.invalid']]);
    const res = await email(tournamentId, arbiter, { issueIds: [id] });
    expect(res.status).toBe(403);
    expect((await t.call(arbiter, 'GET', `/tournaments/${tournamentId}/certificates/email-quota`)).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('shows the daily cap before sending, and refuses a send that would pass it', async () => {
    const before = (await t.call(owner, 'GET', `/tournaments/${tournamentId}/certificates/email-quota`)).body;
    expect(before).toMatchObject({ canSend: true, demo: false, emailConfigured: true, limit: 2000 });
    expect(before.remaining).toBe(2000 - before.used);

    // Use all but two of today's sends.
    const fill = await backend.store.reserveEmailSends({
      kind: 'bulk',
      scopeKey: `org:${org.id}`,
      count: before.remaining - 2,
      limit: 2000,
      tournamentId,
    });
    expect(fill.allowed).toBe(true);
    const quota = (await t.call(owner, 'GET', `/tournaments/${tournamentId}/certificates/email-quota`)).body;
    expect(quota).toMatchObject({ remaining: 2, used: 1998, canSend: true });

    const ids = await issue(tournamentId, [
      ['Goh En Passant', 'goh.passant@example.invalid'],
      ['Nur Sicilia Najdorfah', 'nur.sicilia@example.invalid'],
      ['Tengku Gambit Iskandar', 'tengku.gambit@example.invalid'],
    ]);
    const over = await email(tournamentId, owner, { issueIds: ids });
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ remaining: 2, limit: 2000 });
    expect(over.body.error).toContain('Only 2 of today');
    expect(sent).toEqual([]);

    const fits = await email(tournamentId, owner, { issueIds: ids.slice(0, 2) });
    expect(fits.status).toBe(200);
    expect(fits.body).toMatchObject({ sent: 2, quota: { remaining: 0, limit: 2000 } });
    const spent = (await t.call(owner, 'GET', `/tournaments/${tournamentId}/certificates/email-quota`)).body;
    expect(spent).toMatchObject({ remaining: 0, canSend: false });
    expect(spent.reason).toContain('used up');
  });

  it('an unverified organization sees why it can\'t send, before trying', async () => {
    const unverifiedOwner = await t.newUser();
    const created = await t.call(unverifiedOwner, 'POST', '/organizations', { name: `Org ${crypto.randomUUID()}` });
    expect(created.status).toBe(201);
    const tid = (await t.seedTournament(unverifiedOwner, created.body.organization.id)).id;
    const quota = (await t.call(unverifiedOwner, 'GET', `/tournaments/${tid}/certificates/email-quota`)).body;
    expect(quota).toMatchObject({ canSend: false, remaining: 0 });
    expect(quota.reason).toContain('Organizer Verification');
    const [id] = await issue(tid, [['Lim Gambit Ling', 'lim.gambit@example.invalid']], unverifiedOwner);
    const res = await email(tid, unverifiedOwner, { issueIds: [id] });
    expect(res.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('says when no mail provider is configured', async () => {
    delete process.env['RESEND_API_KEY'];
    const quota = (await t.call(owner, 'GET', `/tournaments/${otherTournamentId}/certificates/email-quota`)).body;
    expect(quota.emailConfigured).toBe(false);
  });

  /** A fresh organization, so these don't share a day's cap with the tests above. */
  let fresh: { user: string; tid: string };
  const freshList = async () =>
    (await t.call(fresh.user, 'GET', `/tournaments/${fresh.tid}/certificates`)).body.issues as Array<{ id: string; status: string }>;
  const freshIssue = (people: Array<[string, string | null]>) => issue(fresh.tid, people, fresh.user);
  const freshEmail = (body: unknown) => email(fresh.tid, fresh.user, body);
  const used = async () =>
    (await t.call(fresh.user, 'GET', `/tournaments/${fresh.tid}/certificates/email-quota`)).body.used as number;

  describe('on a fresh organization', () => {
  beforeAll(async () => {
    const user = await t.newUser();
    const org = await t.verifiedOrg(user);
    fresh = { user, tid: (await t.seedTournament(user, org.id)).id };
  });

  describe('double sends', () => {
    it('two sends of the same certificates at once (two tabs, a double click) send each one once', async () => {
      const ids = await freshIssue([
        ['Goh En Passant', 'goh.twice@example.invalid'],
        ['Teoh Rook Lift', 'teoh.twice@example.invalid'],
        ['Yap Pin Yi', 'yap.twice@example.invalid'],
      ]);
      // A slow mail service, so both requests are in flight together.
      const slow = vi.fn(async (_url: string, init: { body: string }) => {
        await new Promise((r) => setTimeout(r, 30));
        sent.push({ to: JSON.parse(init.body).to[0], subject: '' });
        return new Response('{}', { status: 200 });
      });
      vi.stubGlobal('fetch', slow);
      const [a, b] = await Promise.all([
        freshEmail({ issueIds: ids }),
        freshEmail({ issueIds: ids }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.sent + b.body.sent).toBe(3);
      expect(sent.map((s) => s.to).sort()).toEqual([
        'goh.twice@example.invalid',
        'teoh.twice@example.invalid',
        'yap.twice@example.invalid',
      ]);
      const skippedReasons = [...a.body.results, ...b.body.results]
        .filter((r: { status: string }) => r.status === 'skipped')
        .map((r: { error: string }) => r.error);
      expect(skippedReasons).toHaveLength(3);
      for (const reason of skippedReasons) expect(['Already being sent from another tab', 'Already sent']).toContain(reason);
      expect((await freshList()).filter((i) => ids.includes(i.id)).every((i) => i.status === 'emailed')).toBe(true);
    });

    it('two resends at once still send once', async () => {
      const [id] = await freshIssue([['Lee Skewer Xuan', 'lee.twice@example.invalid']]);
      await freshEmail({ issueIds: [id] });
      sent = [];
      const [a, b] = await Promise.all([
        freshEmail({ issueIds: [id], resend: true }),
        freshEmail({ issueIds: [id], resend: true }),
      ]);
      expect(a.body.sent + b.body.sent).toBe(1);
      expect(sent).toHaveLength(1);
    });

    it('a send that dies mid-way leaves nothing claimed, so the next one can go', async () => {
      const [id] = await freshIssue([['Chong Rook Hao', 'chong.offline@example.invalid']]);
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('fetch failed');
      }));
      const res = await freshEmail({ issueIds: [id] });
      expect(res.body.results[0]).toMatchObject({ status: 'failed', error: "Couldn't reach the mail service" });
      expect((await freshList()).find((i) => i.id === id)!.status).toBe('failed');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
      expect((await freshEmail({ issueIds: [id] })).body.sent).toBe(1);
    });
  });

  describe('the daily cap counts only mail that reached Resend', () => {
    it('no Resend key: nothing reached it, nothing counted', async () => {
      const [id] = await freshIssue([['Ng Pawn Mei', 'ng.nokey@example.invalid']]);
      delete process.env['RESEND_API_KEY'];
      const before = await used();
      const res = await freshEmail({ issueIds: [id] });
      expect(res.body).toMatchObject({ sent: 0, failed: 1 });
      expect(await used()).toBe(before);
    });

    it('could not reach the mail service: not counted', async () => {
      const [id] = await freshIssue([['Lim Gambit Ling', 'lim.offline@example.invalid']]);
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('fetch failed');
      }));
      const before = await used();
      await freshEmail({ issueIds: [id] });
      expect(await used()).toBe(before);
    });

    it('Resend refused it: that did reach Resend, so it counts; the sent ones count too', async () => {
      const ids = await freshIssue([
        ['Arjun Pirc', 'arjun.counted@example.invalid'],
        ['Priya Benoni', 'priya.bounce@example.invalid'],
      ]);
      bounce.add('priya.bounce@example.invalid');
      const before = await used();
      const res = await freshEmail({ issueIds: ids });
      expect(res.body).toMatchObject({ sent: 1, failed: 1 });
      expect(await used()).toBe(before + 2);
    });

    it('a mix: only the ones that reached Resend count', async () => {
      const ids = await freshIssue([
        ['Vikram Tempo', 'vikram.mix@example.invalid'],
        ['Siti Bishopah', 'siti.mix@example.invalid'],
      ]);
      // The first goes through; the mail service vanishes before the second.
      let calls = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        calls += 1;
        if (calls > 1) throw new TypeError('fetch failed');
        return new Response('{}', { status: 200 });
      }));
      const before = await used();
      const res = await freshEmail({ issueIds: ids });
      expect(res.body).toMatchObject({ sent: 1, failed: 1 });
      expect(await used()).toBe(before + 1);
      expect(res.body.quota.used).toBe(before + 1);
    });

    it('a send the cap refuses puts its claims back, so they can still be sent', async () => {
      const unverifiedish = await t.newUser();
      const smallOrg = await t.verifiedOrg(unverifiedish);
      const tid = (await t.seedTournament(unverifiedish, smallOrg.id)).id;
      const [id] = await issue(tid, [['Wan Rookiah', 'wan.cap@example.invalid']], unverifiedish);
      await backend.store.reserveEmailSends({ kind: 'bulk', scopeKey: `org:${smallOrg.id}`, count: 2000, limit: 2000 });
      const refused = await email(tid, unverifiedish, { issueIds: [id] });
      expect(refused.status).toBe(429);
      const issues = (await t.call(unverifiedish, 'GET', `/tournaments/${tid}/certificates`)).body.issues;
      expect(issues[0].status).toBe('stored');
    });
  });

  });

  it('a typo in one address doesn\'t fail the whole issue batch', async () => {
    const ids = await issue(otherTournamentId, [
      ['Ng Pawn Mei', 'ng.pawn@example'],
      ['Chong Rook Hao', 'chong.rook@example.invalid'],
    ]);
    expect(ids).toHaveLength(2);
  });
});
