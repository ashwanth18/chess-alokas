import { describe, expect, it } from 'vitest';
import { isFideRefreshDue } from './importList.js';
import type { FideImportStatus } from './types.js';

function status(
  partial: Partial<Pick<FideImportStatus, 'status' | 'importedAt' | 'playerCount'>>,
): Pick<FideImportStatus, 'status' | 'importedAt' | 'playerCount'> {
  return {
    status: partial.status ?? 'ok',
    importedAt: partial.importedAt ?? null,
    playerCount: partial.playerCount ?? 0,
  };
}

describe('isFideRefreshDue', () => {
  it('is due when catalog is empty', () => {
    const now = new Date('2026-08-03T12:00:00.000Z');
    expect(isFideRefreshDue(status({ playerCount: 0, importedAt: null }), now)).toBe(true);
    expect(
      isFideRefreshDue(status({ playerCount: 0, importedAt: '2026-07-10T00:00:00.000Z' }), now),
    ).toBe(true);
  });

  it('is not due before the 8th when catalog is loaded', () => {
    const now = new Date('2026-08-05T12:00:00.000Z');
    expect(
      isFideRefreshDue(
        status({ playerCount: 1000, importedAt: '2026-07-12T00:00:00.000Z', status: 'ok' }),
        now,
      ),
    ).toBe(false);
  });

  it('is due on/after the 8th when last import was a previous month', () => {
    const now = new Date('2026-08-12T12:00:00.000Z');
    expect(
      isFideRefreshDue(
        status({ playerCount: 1000, importedAt: '2026-07-11T00:00:00.000Z', status: 'ok' }),
        now,
      ),
    ).toBe(true);
  });

  it('is not due when already imported this calendar month', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    expect(
      isFideRefreshDue(
        status({ playerCount: 1000, importedAt: '2026-08-11T00:00:00.000Z', status: 'ok' }),
        now,
      ),
    ).toBe(false);
  });

  it('is not due while status is running', () => {
    const now = new Date('2026-08-12T12:00:00.000Z');
    expect(
      isFideRefreshDue(
        status({
          status: 'running',
          playerCount: 1000,
          importedAt: '2026-07-11T00:00:00.000Z',
        }),
        now,
      ),
    ).toBe(false);
  });
});
