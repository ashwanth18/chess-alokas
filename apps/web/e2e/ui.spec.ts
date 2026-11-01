import AxeBuilder from '@axe-core/playwright';
import { test, expect, settle } from './fixtures/mockApi';

/** The component sheet at /__ui: every component, measured in a real browser with the real font. */

const open = async (page: import('@playwright/test').Page, query = '') => {
  await page.goto(`/__ui${query}`);
  await page.locator('[data-testid="names"]').waitFor();
  await settle(page);
  // Let the fit pass that runs after fonts load finish.
  await page.waitForTimeout(100);
};

test('Archivo has its width axis, so narrowing is real', async ({ page }) => {
  await open(page);
  const widths = await page.evaluate(() => {
    const s = document.createElement('span');
    s.textContent = 'Puteri Alekhine Damia binti Queen Gambit';
    s.style.cssText = 'font:400 100px Archivo;white-space:nowrap;position:absolute;';
    document.body.appendChild(s);
    const at = (v: string) => {
      s.style.fontStretch = v;
      return s.getBoundingClientRect().width;
    };
    const out = [at('100%'), at('62%')];
    s.remove();
    return out;
  });
  expect(widths[1]!).toBeLessThan(widths[0]! * 0.8);
});

for (const width of [480, 320, 240, 160]) {
  test(`no name is cut at ${width} px, and the size never shrinks`, async ({ page }) => {
    await open(page);
    const box = page.getByTestId(`names-${width}`);
    const report = await box.locator('.ui-name').evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const parent = el.parentElement!.getBoundingClientRect();
        return {
          text: el.textContent,
          ellipsis: s.textOverflow,
          fontSize: s.fontSize,
          stretch: s.fontStretch,
          overflowsParent: r.right > parent.right + 0.5,
          clipped: el.scrollWidth > el.clientWidth + 1,
          wrapped: el.classList.contains('is-wrapped'),
        };
      }),
    );
    expect(report.length).toBe(9);
    for (const item of report) {
      expect(item.ellipsis, item.text!).toBe('clip');
      expect(item.fontSize, item.text!).toBe('16px');
      expect(item.overflowsParent, item.text!).toBe(false);
      expect(item.clipped, item.text!).toBe(false);
      expect(parseFloat(item.stretch), item.text!).toBeGreaterThanOrEqual(62);
    }
  });
}

test('a long name narrows first, then breaks at the patronym', async ({ page }) => {
  await open(page);
  const name = (w: number) =>
    page.getByTestId(`names-${w}`).locator('.ui-name', { hasText: 'Kavitha Zugzwang' });
  // Fits outright, or nearly, at the widest.
  expect(parseFloat(await name(480).evaluate((el) => getComputedStyle(el).fontStretch))).toBeGreaterThan(90);
  await expect(name(480)).not.toHaveClass(/is-wrapped/);
  // Too long for one line even at 62%: the given name and patronym take a line each.
  await expect(name(160)).toHaveClass(/is-wrapped/);
  const heights = await name(160).evaluate((el) => {
    const g = el.querySelector('.ui-name__given')!.getBoundingClientRect();
    const r = el.querySelector('.ui-name__rest')!.getBoundingClientRect();
    return { givenBottom: g.bottom, restTop: r.top };
  });
  expect(heights.restTop).toBeGreaterThanOrEqual(heights.givenBottom - 1);
});

test('the patronym reads one step quieter than the given name', async ({ page }) => {
  await open(page);
  const name = page.getByTestId('names-480').locator('.ui-name', { hasText: 'Arjun Pirc' });
  await expect(name.locator('.ui-name__given')).toHaveText('Arjun Pirc');
  await expect(name.locator('.ui-name__rest')).toHaveText('a/l Grunfeld Subramaniam');
  expect(await name.locator('.ui-name__given').evaluate((e) => getComputedStyle(e).fontWeight)).toBe('600');
  expect(await name.locator('.ui-name__rest').evaluate((e) => getComputedStyle(e).fontWeight)).toBe('400');
});

test('the two near-identical children are told apart', async ({ page }) => {
  await open(page);
  const box = page.getByTestId('names-480');
  await expect(box.locator('.ui-name', { hasText: 'Queen Gambit' }).locator('.ui-name__dis')).toHaveText('#1 · U12');
  await expect(box.locator('.ui-name', { hasText: 'Queen Indian' }).locator('.ui-name__dis')).toHaveText('#2 · U12');
  await expect(box.locator('.ui-name', { hasText: 'Tan Zwischen' }).locator('.ui-name__dis')).toHaveCount(0);
});

test('the pairing table stacks at its own narrow width and keeps every name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const display = await page.locator('.ui-pt__row').first().evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe('grid');
  await expect(page.locator('.ui-pt thead')).toBeHidden();
});

test('the table shows as a table on a laptop, with White left of Black', async ({ page }) => {
  await open(page);
  const row = page.locator('.ui-pt__row').first();
  expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe('table-row');
  const white = await row.locator('.ui-pt__w').boundingBox();
  const res = await row.locator('.ui-pt__res').boundingBox();
  const black = await row.locator('.ui-pt__b').boundingBox();
  expect(white!.x).toBeLessThan(res!.x);
  expect(res!.x).toBeLessThan(black!.x);
});

test('legacy globals do not leak into new components', async ({ page }) => {
  await open(page);
  const btn = page.getByRole('button', { name: 'Print', exact: true });
  const style = await btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return { font: s.fontFamily, radius: s.borderRadius, h: el.getBoundingClientRect().height };
  });
  expect(style.font).toContain('Archivo');
  expect(style.radius).toBe('3px');
  expect(style.h).toBeGreaterThanOrEqual(36);
  const bg = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toBe('none');
  const h1 = await page.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(h1).toContain('Archivo');
});

test('leaving the sheet restores the legacy page', async ({ page }) => {
  await open(page, '?theme=dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => {
    window.history.pushState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.locator('form').first().waitFor();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-surface');
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient');
});

test('the sheet opens as a real modal dialog and closes with Esc', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Open sheet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Board 4' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Open modal' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

for (const theme of ['light', 'dark', 'sun', 'tv']) {
  test(`axe finds nothing on the sheet in ${theme}`, async ({ page }) => {
    await open(page, `?theme=${theme}`);
    const results = await new AxeBuilder({ page }).include('.ui-root').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

test('no console errors or outside requests on the sheet', async ({ page, mocks }) => {
  await open(page);
  expect(mocks.errors).toEqual([]);
  expect(mocks.external).toEqual([]);
});

for (const [label, query] of [
  ['light', '?theme=light'],
  ['dark', '?theme=dark'],
  ['sun', '?theme=sun'],
] as const) {
  for (const width of [390, 1366]) {
    test(`screenshot ${label} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await open(page, query);
      await expect(page).toHaveScreenshot(`ui-${label}-${width}.png`, { fullPage: true });
    });
  }
}
