import { test, expect, signIn, seedDesk, settle } from './fixtures/mockApi';
import { EVENT_SLUG } from './fixtures/data';

/** Legacy pages inside the layered cascade: font, colours, bug fixes, nothing else moved. */

function luminance(rgb: string): number {
  const [r, g, b] = rgb.match(/[\d.]+/g)!.map(Number).map((v) => {
    const s = v! / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test('legacy text is Archivo, loaded from this origin', async ({ page, mocks }) => {
  await page.goto('/login');
  await page.locator('form').first().waitFor();
  await settle(page);
  const family = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain('Archivo');
  expect(await page.evaluate(() => document.fonts.check('16px Archivo'))).toBe(true);
  expect(mocks.assets.some((p) => /archivo-latin-wdth.*\.woff2$/.test(p))).toBe(true);
  expect(mocks.external).toEqual([]);
});

test('index.html has no Google Fonts and the body keeps its legacy gradient', async ({ page }) => {
  await page.goto('/login');
  await page.locator('form').first().waitFor();
  expect(await page.locator('link[href*="fonts.g"]').count()).toBe(0);
  const body = await page.locator('body').evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, color: s.backgroundColor };
  });
  // The unlayered splash colour in index.html would have wiped this out.
  expect(body.image).toContain('radial-gradient');
  expect(body.color).toBe('rgb(15, 61, 46)');
});

test('the boot splash is paper and the split square, in markup', async ({ request }) => {
  const html = await (await request.get('/login')).text();
  expect(html).not.toContain('♕');
  expect(html).not.toContain('#0f3d2e');
  expect(html).toContain('#F7F5EF');
  expect(html).toContain('<rect x="8" y="1"');
});

test('the PWA manifest uses paper, not green', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.theme_color).toBe('#F7F5EF');
  expect(manifest.background_color).toBe('#F7F5EF');
});

test('registration labels pass contrast', async ({ page }) => {
  await page.goto(`/register/${EVENT_SLUG}`);
  const label = page.locator('.admin-panel .auth-form label').first();
  await label.waitFor();
  const color = await label.evaluate((el) => getComputedStyle(el).color);
  // The panel is translucent over the page, so test against the lightest thing behind it:
  // the plan measured the composite at #285748.
  expect(contrast(color, 'rgb(40, 87, 72)')).toBeGreaterThanOrEqual(4.5);
});

for (const [width, height] of [
  [360, 780],
  [390, 844],
  [1101, 768],
  [1366, 768],
  [1920, 1080],
] as const) {
  test(`the desk top bar fits and Sign out is reachable at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signIn(page);
    await seedDesk(page);
    await page.goto('/app');
    await page.locator('.topbar').waitFor();
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (width > 720) {
      const box = await page.locator('.sync-bar').getByRole('button', { name: 'Sign out' }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    } else {
      await page.getByRole('button', { name: 'Open menu' }).click();
      const box = await page.locator('.topnav-mobile-actions').getByRole('button', { name: 'Sign out' }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
  });
}

test.describe('in a dark OS', () => {
  test.use({ colorScheme: 'dark' });

  const schemeOf = (page: import('@playwright/test').Page) =>
    page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

  test('a legacy page keeps the default colour scheme', async ({ page }) => {
    await page.goto('/login');
    await page.locator('form').first().waitFor();
    expect(await schemeOf(page)).toBe('normal');
  });

  test('the landing page is dark, and in-app navigation to a legacy page undoes it', async ({ page }) => {
    await page.goto('/');
    await page.locator('.lp').first().waitFor();
    await settle(page);
    expect(await schemeOf(page)).toBe('dark');
    // Client-side, so landing.css stays loaded: the case that would leak.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.locator('form').first().waitFor();
    await expect.poll(() => schemeOf(page)).toBe('normal');
    const input = await page.locator('form input').first().evaluate((el) => getComputedStyle(el).colorScheme);
    expect(input).toBe('normal');
  });
});
