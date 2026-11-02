import type { Page } from '@playwright/test';
import { test, expect, json, signIn, seedDesk, settle, setPersona } from './fixtures/mockApi';
import { fixtureUser, NOW } from './fixtures/data';
import { PERSONAS, type Persona } from './fixtures/personas';

/** One login, two areas: who opens where, and what the account menu offers them. */

const openAccountMenu = (page: Page) => page.getByRole('button', { name: 'Account menu' }).click();
const menuLabels = (page: Page) => page.locator('.am-panel .am-item').allInnerTexts();

async function as(page: Page, persona: Persona) {
  setPersona(page, persona);
  await signIn(page);
}

test.describe('landing by role', () => {
  const CASES: [string, Persona, RegExp][] = [
    ['a player opens on their page', PERSONAS.player, /\/player$/],
    ['an organizer opens on the desk', PERSONAS.organizer, /\/app$/],
    ['an organizer by account role alone opens on the desk', PERSONAS.roleOnly, /\/app$/],
    ['someone with both opens on the desk by default', PERSONAS.both, /\/app$/],
    ['an arbiter-only member opens on /team', PERSONAS.arbiter, /\/team$/],
    ['an arbiter who directs elsewhere opens on the desk', PERSONAS.arbiterAndDirector, /\/app$/],
  ];
  for (const [name, persona, url] of CASES) {
    test(name, async ({ page }) => {
      await as(page, persona);
      await page.goto('/');
      await expect(page).toHaveURL(url);
      await expect(page.locator('main.page-content')).toBeVisible();
    });
  }

  test('an arbiter-only member sees Floor duty, and no desk navigation', async ({ page }) => {
    await as(page, PERSONAS.arbiter);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Floor duty' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Floor duty' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'New' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Certificates' })).toHaveCount(0);
  });

  test('a player sent away from /app never opens the local database', async ({ page }) => {
    await as(page, PERSONAS.player);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/player$/);
    await expect(page.locator('main.page-content')).toBeVisible();
    await settle(page);
    const dbs = await page.evaluate(() => indexedDB.databases());
    expect(dbs.map((d) => d.name)).not.toContain('chess-alokas');
  });

  test('every URL still works for a player, with their own navigation', async ({ page }) => {
    await as(page, PERSONAS.player);
    for (const path of ['/account', '/settings', '/team', '/certificates', '/tournaments/new']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My page' })).toBeVisible();
      await expect(page.locator('.status-label')).toHaveCount(0);
    }
  });

  test('an organizer can still open /player by its URL, and get back', async ({ page }) => {
    await as(page, PERSONAS.organizer);
    await page.goto('/player');
    await expect(page).toHaveURL(/\/player$/);
    await openAccountMenu(page);
    expect(await menuLabels(page)).toEqual(['My desk', 'Account', 'Settings', 'Sign out']);
    await page.getByRole('link', { name: 'My desk' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('offline with this device remembering them, an organizer still opens straight on the desk', async ({ page }) => {
    await as(page, PERSONAS.organizer);
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await settle(page);
    await page.route('http://localhost:3999/**', (route) => route.abort());
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('main.page-content')).toBeVisible();
  });

  test('with no answer from the API at all, the desk opens rather than a blank wait', async ({ page }) => {
    await as(page, PERSONAS.player);
    await page.route('http://localhost:3999/**', (route) => route.abort());
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('main.page-content')).toBeVisible();
  });
});

test.describe('after sign-in', () => {
  const session = () => ({
    access_token: 'header.e2e-not-a-real-token.signature',
    refresh_token: 'e2e-not-a-real-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(new Date(NOW).getTime() / 1000) + 3600 * 24 * 365,
    user: fixtureUser,
  });

  async function signInThroughTheForm(page: Page) {
    await page.route('http://localhost:3998/auth/v1/token**', (route) => route.fulfill(json(session(), 200, '*')));
    await page.getByLabel('Email').fill('someone@example.invalid');
    await page.getByLabel('Password').fill('not-a-real-password');
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  }

  test('a player lands on their page', async ({ page }) => {
    setPersona(page, PERSONAS.player);
    await page.goto('/login');
    await signInThroughTheForm(page);
    await expect(page).toHaveURL(/\/player$/);
  });

  test('an organizer lands on the desk', async ({ page }) => {
    setPersona(page, PERSONAS.organizer);
    await page.goto('/login');
    await signInThroughTheForm(page);
    await expect(page).toHaveURL(/\/app$/);
  });

  for (const [who, persona, target] of [
    ['a player', PERSONAS.player, '/discover'],
    ['a player', PERSONAS.player, '/team?org=1'],
    ['an organizer', PERSONAS.organizer, '/player'],
    ['an organizer', PERSONAS.organizer, '/discover'],
  ] as const) {
    test(`the return path wins for ${who} going to ${target}`, async ({ page }) => {
      setPersona(page, persona);
      await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
      await signInThroughTheForm(page);
      await expect(page).toHaveURL(new RegExp(`${target.replace('?', '\\?')}$`));
    });
  }

  test('a signed-out visit to a page comes back to it, past the role landing', async ({ page }) => {
    setPersona(page, PERSONAS.player);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fsettings$/);
    await signInThroughTheForm(page);
    await expect(page).toHaveURL(/\/settings$/);
  });
});

test.describe('the pills are gone', () => {
  for (const [path, persona] of [
    ['/app', PERSONAS.both],
    ['/player', PERSONAS.both],
    ['/discover', PERSONAS.both],
    ['/account', PERSONAS.player],
  ] as const) {
    test(`${path} has no pills and no pill wording`, async ({ page }) => {
      await as(page, persona);
      await page.goto(path);
      await page.locator('.topbar').waitFor();
      await settle(page);
      await expect(page.locator('.workspace-switcher, .workspace-pill')).toHaveCount(0);
      const text = await page.locator('body').innerText();
      expect(text).not.toContain('Player Portal');
      expect(text).not.toContain('Organizer Desk');
      expect(await page.locator('.topbar').innerText()).not.toMatch(/[♔-♟]/);
    });
  }
});

test.describe('the switch', () => {
  test('shows only for someone who has both', async ({ page }) => {
    for (const [persona, path] of [
      [PERSONAS.player, '/player'],
      [PERSONAS.organizer, '/app'],
      [PERSONAS.roleOnly, '/app'],
      [PERSONAS.arbiter, '/team'],
    ] as const) {
      await as(page, persona);
      await page.goto(path);
      await openAccountMenu(page);
      expect((await menuLabels(page)).filter((label) => /switch/i.test(label))).toEqual([]);
    }
    await as(page, PERSONAS.both);
    await page.goto('/app');
    await openAccountMenu(page);
    expect(await menuLabels(page)).toEqual(['Switch to player view', 'Account', 'Settings', 'Sign out']);
  });

  test('goes both ways, and this device remembers the last choice', async ({ page }) => {
    await as(page, PERSONAS.both);
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);

    await openAccountMenu(page);
    await page.getByRole('link', { name: 'Switch to player view' }).click();
    await expect(page).toHaveURL(/\/player$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/player$/);

    // Account stays in the chosen area.
    await page.goto('/account');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My page' })).toBeVisible();

    await page.goto('/player');
    await openAccountMenu(page);
    await page.getByRole('link', { name: 'Switch to organizer view' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe('Run a tournament', () => {
  test('is in a player’s account menu; backing out returns to their page', async ({ page }) => {
    await as(page, PERSONAS.player);
    await page.goto('/player');
    await openAccountMenu(page);
    expect(await menuLabels(page)).toEqual(['Run a tournament', 'Account', 'Settings', 'Sign out']);
    await page.getByRole('link', { name: 'Run a tournament' }).click();
    await expect(page).toHaveURL(/\/app\?setup=organization$/);
    const form = page.getByRole('dialog', { name: 'Organization settings' });
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/player$/);
  });

  test('registering an organization puts them on the desk, with the switch', async ({ page }) => {
    await as(page, PERSONAS.player);
    await page.route('http://localhost:3999/organizations', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      setPersona(page, PERSONAS.both);
      const origin = (await route.request().headerValue('origin')) ?? undefined;
      return route.fulfill(json({ organization: PERSONAS.both.organizations[0] }, 201, origin));
    });
    await page.goto('/app?setup=organization');
    const form = page.getByRole('dialog', { name: 'Organization settings' });
    await form.getByLabel('Organization / Academy Name').fill('Imaginary Bay Chess Academy');
    await form.getByRole('button', { name: 'Create Organization' }).click();
    await expect(form).toHaveCount(0);
    await expect(page).toHaveURL(/\/app$/);
    await openAccountMenu(page);
    await expect(page.getByRole('link', { name: 'Switch to player view' })).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe('public pages', () => {
  test('a guest on /discover is offered sign-in, with no account menu', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.locator('.topbar').getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
  });

  test('an organizer on /discover reaches the desk from the account menu, not a button', async ({ page }) => {
    await as(page, PERSONAS.organizer);
    await page.goto('/discover');
    await expect(page.locator('.topbar .btn')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'My Player & Family Profiles' })).toHaveCount(0);
    await openAccountMenu(page);
    expect(await menuLabels(page)).toEqual(['My desk', 'Account', 'Settings', 'Sign out']);
    await page.getByRole('link', { name: 'My desk' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('a player on /discover gets their page and the way to start organizing', async ({ page }) => {
    await as(page, PERSONAS.player);
    await page.goto('/discover');
    await openAccountMenu(page);
    expect(await menuLabels(page)).toEqual(['My player page', 'Run a tournament', 'Account', 'Settings', 'Sign out']);
  });

  test('the menu closes with Escape and an outside click, and leaves the page in place', async ({ page }) => {
    await as(page, PERSONAS.player);
    await page.goto('/discover');
    await openAccountMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.am-panel')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeFocused();
    await openAccountMenu(page);
    await page.locator('h1').first().click();
    await expect(page.locator('.am-panel')).toHaveCount(0);
  });
});

test.describe('signing up', () => {
  // A sign-up answer with no identities means the email already has an account, so this has one.
  const USER = { ...fixtureUser, email: 'new@example.invalid', identities: [{ id: 'e2e', provider: 'email' }] };
  const signupSession = () => ({
    access_token: 'header.e2e-not-a-real-token.signature',
    refresh_token: 'e2e-not-a-real-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(new Date(NOW).getTime() / 1000) + 3600 * 24 * 365,
    user: USER,
  });

  async function fill(page: Page) {
    await page.getByLabel('Email').fill(USER.email);
    await page.getByLabel('Password').fill('not-a-real-password');
  }

  test('/signup?role=organizer starts on running tournaments, in plain words', async ({ page }) => {
    await page.goto('/signup?role=organizer');
    await expect(page.getByRole('button', { name: 'Run tournaments' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Play, or follow my child' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByLabel('Organization / Academy name')).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/[♔-♟]/);
    expect(text).not.toContain('Sandbox');
  });

  test('/signup starts on playing, with no organization fields', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('button', { name: 'Play, or follow my child' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Organization / Academy name')).toHaveCount(0);
  });

  test('choosing to run tournaments lands on the desk', async ({ page }) => {
    setPersona(page, PERSONAS.player);
    await page.route('http://localhost:3998/auth/v1/signup**', (route) => route.fulfill(json(signupSession(), 200, '*')));
    await page.route('http://localhost:3999/organizations', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      setPersona(page, PERSONAS.organizer);
      const origin = (await route.request().headerValue('origin')) ?? undefined;
      return route.fulfill(json({ organization: PERSONAS.organizer.organizations[0] }, 201, origin));
    });
    await page.goto('/signup?role=organizer');
    await page.getByLabel('Organization / Academy name').fill('Imaginary Bay Chess Academy');
    await fill(page);
    await page.getByRole('button', { name: 'Start your trial' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tournaments' })).toBeVisible();
  });

  test('choosing to play lands on the player page', async ({ page }) => {
    setPersona(page, PERSONAS.player);
    await page.route('http://localhost:3998/auth/v1/signup**', (route) => route.fulfill(json(signupSession(), 200, '*')));
    await page.route('http://localhost:3999/player/profiles', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const origin = (await route.request().headerValue('origin')) ?? undefined;
      return route.fulfill(json({ profile: PERSONAS.player.profiles[0] }, 201, origin));
    });
    await page.goto('/signup');
    await page.getByLabel('Your full name').fill('Parent Rook');
    await fill(page);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/player$/);
  });

  test('an organizer who confirmed by email still lands on the desk, and the organization gets made', async ({ page }) => {
    setPersona(page, PERSONAS.player);
    let created = 0;
    await page.route('http://localhost:3999/organizations', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      created += 1;
      setPersona(page, PERSONAS.organizer);
      const origin = (await route.request().headerValue('origin')) ?? undefined;
      return route.fulfill(json({ organization: PERSONAS.organizer.organizations[0] }, 201, origin));
    });
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'alokas:pendingSignupAction',
        JSON.stringify({ role: 'organizer', orgName: 'Imaginary Bay Chess Academy', email: 'new@example.invalid' }),
      );
    });
    await signIn(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await expect.poll(() => created).toBe(1);
    await expect(page).toHaveURL(/\/app$/);
  });

  test('someone already signed in who follows the organizer link goes to the setup', async ({ page }) => {
    await as(page, PERSONAS.player);
    await page.goto('/signup?role=organizer');
    await expect(page).toHaveURL(/\/app\?setup=organization$/);
    await expect(page.getByRole('dialog', { name: 'Organization settings' })).toBeVisible();
  });
});

for (const [width, height] of [
  [360, 780],
  [390, 844],
] as const) {
  test.describe(`phone menu at ${width}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    for (const [name, persona, path, expected] of [
      ['player', PERSONAS.player, '/player', ['My page', 'Explore Events', 'Run a tournament', 'Account', 'Settings', 'Sign out']],
      ['both', PERSONAS.both, '/app', ['Tournaments', 'New', 'Explore Events', 'Certificates', 'Simulator', 'Sync now', 'Switch to player view', 'Account', 'Settings', 'Sign out']],
      ['arbiter', PERSONAS.arbiter, '/team', ['Floor duty', 'Explore Events', 'Sync now', 'Account', 'Settings', 'Sign out']],
    ] as const) {
      test(`${name}: everything is there and inside the screen`, async ({ page }) => {
        await as(page, persona);
        await page.goto(path);
        await page.locator('.topbar').waitFor();
        await settle(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        await expect(page.getByRole('button', { name: 'Account menu' })).toBeHidden();

        await page.getByRole('button', { name: 'Open menu' }).click();
        const items = page.locator('.topnav').locator('a, button');
        expect((await items.allInnerTexts()).map((t) => t.trim())).toEqual([...expected]);
        for (const item of await items.all()) {
          const box = await item.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(box!.height).toBeGreaterThanOrEqual(32);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      });
    }

    test('the bar is one row, and the switch works from the phone menu', async ({ page }) => {
      await as(page, PERSONAS.both);
      await page.goto('/app');
      await page.locator('.topbar').waitFor();
      await settle(page);
      const bar = await page.locator('.topbar').boundingBox();
      expect(bar!.height).toBeLessThanOrEqual(64);
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('link', { name: 'Switch to player view' }).click();
      await expect(page).toHaveURL(/\/player$/);
      await expect(page.locator('.topnav')).toBeHidden();
    });

    test('/discover fits with the account menu open', async ({ page }) => {
      await as(page, PERSONAS.both);
      await page.goto('/discover');
      await openAccountMenu(page);
      const panel = await page.locator('.am-panel').boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe('top bar on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  for (const [name, persona, path] of [
    ['player', PERSONAS.player, '/player'],
    ['organizer', PERSONAS.organizer, '/app'],
    ['arbiter', PERSONAS.arbiter, '/team'],
  ] as const) {
    test(`${name}: one row at 1366`, async ({ page }) => {
      await as(page, persona);
      await page.goto(path);
      await page.locator('.topbar').waitFor();
      await settle(page);
      const bar = await page.locator('.topbar').boundingBox();
      expect(bar!.height).toBeLessThanOrEqual(64);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
  }

  test('one row at 1366 with the most it can hold: an organizer who is also a platform admin', async ({ page }) => {
    await as(page, PERSONAS.both);
    await page.route('http://localhost:3998/rest/v1/profiles**', (route) =>
      route.fulfill(json({ display_name: 'Director Rook', is_platform_admin: true }, 200, '*')),
    );
    await seedDesk(page);
    await page.goto('/app');
    await settle(page);
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' })).toBeVisible();
    const bar = await page.locator('.topbar').boundingBox();
    expect(bar!.height).toBeLessThanOrEqual(64);
  });
});
