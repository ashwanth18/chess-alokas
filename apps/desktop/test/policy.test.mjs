import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCsp,
  buildErrorEnvelope,
  createCrashGuard,
  inlineHashesFromHtml,
  isAppPageUrl,
  isInsideWebRoot,
  isSafeExternalUrl,
  isSnapshotName,
  parseDsn,
  scrubReportText,
  snapshotName,
  snapshotsToPrune,
  stripTournamentsFromSnapshot,
  validateBootIssue,
  validateTournamentIds,
  validateDutchInput,
} from '../out/policy.js';

const INDEX = 'file:///C:/Program%20Files/Chess-Alokas/resources/web/index.html';
const ROOT = 'file:///C:/Program%20Files/Chess-Alokas/resources/web';

test('only the exact index page counts as the app', () => {
  assert.equal(isAppPageUrl(INDEX, INDEX), true);
  assert.equal(isAppPageUrl(`${INDEX}#/app`, INDEX), true);
  assert.equal(isAppPageUrl(`${INDEX}?x=1`, INDEX), false);
  assert.equal(isAppPageUrl('file:///C:/Temp/evil.html', INDEX), false);
  assert.equal(isAppPageUrl('file://attacker/share/index.html', INDEX), false);
  assert.equal(isAppPageUrl('data:text/html,x', INDEX), false);
  assert.equal(isAppPageUrl('https://evil.example/', INDEX), false);
});

test('file requests stay inside the web root', () => {
  assert.equal(isInsideWebRoot(`${ROOT}/assets/a.js`, ROOT), true);
  assert.equal(isInsideWebRoot(`${ROOT}/../app.asar`, ROOT), false);
  assert.equal(isInsideWebRoot(`${ROOT}/%2e%2e/secret`, ROOT), false);
  assert.equal(isInsideWebRoot(`${ROOT}-evil/a.js`, ROOT), false);
  assert.equal(isInsideWebRoot('file:///C:/Windows/win.ini', ROOT), false);
  assert.equal(isInsideWebRoot('file://attacker/share/a.js', ROOT), false);
});

test('external URLs are limited to web and mail', () => {
  assert.equal(isSafeExternalUrl('https://example.com'), true);
  assert.equal(isSafeExternalUrl('mailto:a@b.co'), true);
  assert.equal(isSafeExternalUrl('file:///C:/x.exe'), false);
  assert.equal(isSafeExternalUrl('smb://host/share'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
});

test('CSP hashes inline code and names the backends', () => {
  const html = `<link onload="this.media='all'"><script type="module" src="./a.js"></script><script>boot()</script>`;
  const hashes = inlineHashesFromHtml(html);
  assert.equal(hashes.scripts.length, 1);
  assert.equal(hashes.handlers.length, 1);
  const csp = buildCsp({
    html,
    apiBaseUrl: 'https://api.example/api',
    supabaseUrl: 'https://ref.supabase.co',
    sentryDsn: 'https://key@o1.ingest.de.sentry.io/2',
  });
  assert.match(csp, /connect-src [^;]*https:\/\/api\.example/);
  assert.match(csp, /connect-src [^;]*https:\/\/ref\.supabase\.co/);
  assert.match(csp, /connect-src [^;]*wss:\/\/ref\.supabase\.co/);
  assert.match(csp, /connect-src [^;]*https:\/\/o1\.ingest\.de\.sentry\.io/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('inline hashes match what the browser computes after newline normalisation', () => {
  const lf = inlineHashesFromHtml('<script>\nboot()\n</script>');
  const crlf = inlineHashesFromHtml('<script>\r\nboot()\r\n</script>');
  assert.deepEqual(lf.scripts, crlf.scripts);
});

test('crash guard stops the reload loop and recovers after the window', () => {
  let t = 0;
  const guard = createCrashGuard(3, 1000, () => t);
  assert.equal(guard.allow(), true);
  assert.equal(guard.allow(), true);
  assert.equal(guard.allow(), true);
  assert.equal(guard.allow(), false);
  t = 2000;
  assert.equal(guard.allow(), true);
  guard.reset();
  assert.equal(guard.allow(), true);
});

test('Dutch input validation accepts real shapes and copies only known fields', () => {
  const clean = validateDutchInput({
    players: [{ id: 'a', name: 'A', rating: null, seed: 1, secret: 'x' }],
    pastGames: [{ round: 1, whiteId: 'a', blackId: null, result: '1-0', isBye: true, extra: 1 }],
    round: 2,
    totalRounds: 5,
    initialColor: 'B',
    other: 'dropped',
  });
  assert.deepEqual(Object.keys(clean).sort(), ['initialColor', 'pastGames', 'players', 'round', 'totalRounds']);
  assert.equal('secret' in clean.players[0], false);
  assert.equal('extra' in clean.pastGames[0], false);
});

test('Dutch input validation rejects malformed input', () => {
  const ok = { players: [], pastGames: [], round: 1 };
  for (const bad of [
    null,
    {},
    { ...ok, players: 'x' },
    { ...ok, pastGames: {} },
    { ...ok, round: -5 },
    { ...ok, round: 1.5 },
    { ...ok, totalRounds: 1e9 },
    { ...ok, initialColor: 'X' },
    { ...ok, players: [{ id: 5, name: 'a' }] },
    { ...ok, players: [{ id: 'a', name: 'a', rating: 'high' }] },
    { ...ok, pastGames: [{ round: 1, whiteId: 'a', blackId: 'b', result: '1-0' }] },
  ]) {
    assert.throws(() => validateDutchInput(bad), /Invalid pairing input/);
  }
});

test('boot issues are bounded', () => {
  assert.equal(validateBootIssue(null), null);
  assert.equal(validateBootIssue({ code: 'A' }), null);
  assert.equal(validateBootIssue({ code: 'A', message: 'm'.repeat(9000) }).message.length, 500);
});

test('snapshot names cannot traverse and pruning keeps the newest', () => {
  const name = snapshotName('round', new Date(2026, 0, 2, 3, 4, 5, 6));
  assert.equal(name, 'snapshot-20260102-030405-006-round.json');
  assert.equal(isSnapshotName(name), true);
  assert.equal(isSnapshotName('../snapshot-20260102-030405-006-round.json'), false);
  assert.equal(isSnapshotName('snapshot-20260102-030405-006-round.json\\..\\x'), false);
  assert.equal(isSnapshotName('notes.json'), false);
  assert.equal(snapshotName('../../evil', new Date(2026, 0, 2)).includes('..'), false);
  const names = [1, 2, 3].map((i) => `snapshot-2026010${i}-000000-000-round.json`);
  assert.deepEqual(snapshotsToPrune([...names, 'other.txt'], 2), [names[0]]);
});

test('reports contain no home paths, emails, tokens or link secrets', () => {
  const dirty =
    'C:\\Users\\Priya Nair\\AppData\\x /home/priya/y ana@club.org Bearer abc.def eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig /live/tok123 /t/table9';
  const clean = scrubReportText(dirty);
  assert.doesNotMatch(clean, /Priya|priya|ana@club|abc\.def|eyJ|tok123|table9/);
});

test('error envelope carries no user and is scrubbed', () => {
  const dsn = 'https://key@o1.ingest.de.sentry.io/42';
  assert.equal(parseDsn(dsn).envelopeUrl, 'https://o1.ingest.de.sentry.io/api/42/envelope/');
  assert.equal(parseDsn('not a dsn'), null);
  const body = buildErrorEnvelope({
    dsn,
    eventId: 'a'.repeat(32),
    code: 'RENDERER_CRASH',
    message: 'failed for ana@club.org at C:\\Users\\ana\\x',
    stack: 'at C:\\Users\\ana\\y',
    release: 'desktop@v1',
    environment: 'production',
    platform: 'win32',
    timestampMs: 1000,
  });
  const lines = body.split('\n');
  assert.equal(lines.length, 3);
  const event = JSON.parse(lines[2]);
  assert.equal('user' in event, false);
  assert.doesNotMatch(body, /ana/);
});

const GONE = '11111111-1111-4111-8111-111111111111';
const KEPT = '22222222-2222-4222-8222-222222222222';
const snapshot = () => ({
  format: 'chess-alokas-backup',
  formatVersion: 1,
  dbVersion: 9,
  tables: {
    tournaments: [{ id: GONE, name: 'Gone' }, { id: KEPT, name: 'Kept' }],
    categories: [{ id: 'c1', tournamentId: GONE }, { id: 'c2', tournamentId: KEPT }],
    participants: [{ id: 'p1', tournamentId: GONE, name: 'Removed Player' }, { id: 'p2', tournamentId: KEPT }],
    games: [{ id: 'g1', tournamentId: GONE }],
    certificateTemplates: [{ id: 't1', tournamentId: null }, { id: 't2', tournamentId: GONE }],
    tournamentTables: [{ id: 'x1', tournamentId: GONE }],
    meta: [{ key: 'clientId', value: GONE }],
  },
});

test('stripTournamentsFromSnapshot removes the tournament and its rows, and nothing else', () => {
  const out = JSON.parse(stripTournamentsFromSnapshot(JSON.stringify(snapshot()), [GONE]));
  assert.deepEqual(out.tables.tournaments, [{ id: KEPT, name: 'Kept' }]);
  assert.deepEqual(out.tables.categories, [{ id: 'c2', tournamentId: KEPT }]);
  assert.deepEqual(out.tables.participants, [{ id: 'p2', tournamentId: KEPT }]);
  assert.deepEqual(out.tables.games, []);
  assert.deepEqual(out.tables.certificateTemplates, [{ id: 't1', tournamentId: null }]);
  assert.deepEqual(out.tables.tournamentTables, []);
  assert.deepEqual(out.tables.meta, [{ key: 'clientId', value: GONE }]);
  assert.equal(out.format, 'chess-alokas-backup');
  assert.equal(out.dbVersion, 9);
});

test('stripTournamentsFromSnapshot leaves alone a file with nothing to remove or not a backup', () => {
  const other = '33333333-3333-4333-8333-333333333333';
  assert.equal(stripTournamentsFromSnapshot(JSON.stringify(snapshot()), [other]), null);
  assert.equal(stripTournamentsFromSnapshot('not json', [GONE]), null);
  assert.equal(stripTournamentsFromSnapshot('{"format":"other","tables":{}}', [GONE]), null);
  assert.equal(stripTournamentsFromSnapshot('null', [GONE]), null);
});

test('validateTournamentIds accepts only a list of ids', () => {
  assert.deepEqual(validateTournamentIds([GONE]), [GONE]);
  assert.deepEqual(validateTournamentIds([]), []);
  for (const bad of ['x', null, [1], ['../../secret'], [GONE, '*']]) {
    assert.throws(() => validateTournamentIds(bad));
  }
});
