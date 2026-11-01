import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LegalContact } from './LegalLayout';
import {
  DEFAULT_OPERATOR,
  NO_CONTACT_TEXT,
  NO_LOCATION_TEXT,
  listBlankLegalFields,
  operatorName,
  providerLocation,
} from './legalConfig';
import PrivacyPage from './PrivacyPage';
import TermsPage from './TermsPage';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

const EMPTY_LOCATIONS = { supabase: '', hostinger: '', resend: '', sentry: '', github: '' };

describe('legal details', () => {
  it('prints what is still blank', () => {
    const blank = listBlankLegalFields();
    // Not a failure: this is the to-do list before these pages can be called finished.
    console.info(blank.length ? `Legal details still blank:\n  ${blank.join('\n  ')}` : 'No legal details blank.');
    expect(Array.isArray(blank)).toBe(true);
  });

  it('names each blank field and drops it once filled', () => {
    expect(
      listBlankLegalFields({
        contactEmail: ' ',
        entityName: '',
        bmVersionUrl: '',
        providerLocations: { ...EMPTY_LOCATIONS, github: 'Somewhere' },
      }),
    ).toEqual([
      'LEGAL_CONTACT_EMAIL',
      'LEGAL_ENTITY_NAME',
      'LEGAL_BM_VERSION_URL',
      'LEGAL_PROVIDER_LOCATIONS.supabase',
      'LEGAL_PROVIDER_LOCATIONS.hostinger',
      'LEGAL_PROVIDER_LOCATIONS.resend',
      'LEGAL_PROVIDER_LOCATIONS.sentry',
    ]);
  });

  it('renders neutral text for blanks and the real value once set', () => {
    expect(operatorName('')).toBe(DEFAULT_OPERATOR);
    expect(operatorName('Example Sdn Bhd')).toBe('Example Sdn Bhd');
    expect(providerLocation('sentry', EMPTY_LOCATIONS)).toBe(NO_LOCATION_TEXT);
    expect(providerLocation('sentry', { ...EMPTY_LOCATIONS, sentry: 'Somewhere' })).toBe('Somewhere');
    expect(render(<LegalContact email="" />)).toBe(NO_CONTACT_TEXT);
    expect(render(<LegalContact email="a@example.com" />)).toContain('mailto:a@example.com');
  });
});

describe.each([
  ['Privacy', <PrivacyPage key="p" />],
  ['Terms', <TermsPage key="t" />],
])('%s page wording', (_name, page) => {
  const text = render(page).replace(/<[^>]+>/g, ' ');

  it('shows the date', () => {
    expect(text).toContain('1 November 2026');
  });

  it('never claims compliance, certification or endorsement', () => {
    expect(text).not.toMatch(/\b(PDPA|GDPR)\b[^.]*\bcompl/i);
    expect(text).not.toMatch(/\bcompliant\b|ISO 27001|SOC 2/i);
    expect(text.replace(/isn&#x27;t endorsed by FIDE/g, '')).not.toMatch(/endorsed by FIDE/i);
  });

  it('does not mention removed sign-in methods, automation or a fake address', () => {
    expect(text).not.toMatch(/sign in with (google|github)|whatsapp/i);
    expect(text).not.toMatch(/@(alokas|example)\./i);
  });
});
