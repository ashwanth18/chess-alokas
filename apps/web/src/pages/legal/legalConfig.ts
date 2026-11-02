/**
 * The one place to fill in legal details. Each blank renders neutral text on /privacy and /terms,
 * never a made-up value, so filling one in is a one-line change here.
 * `pnpm --filter @chess-alokas/web test legalConfig` prints what is still blank.
 */

/** Public contact address for privacy requests, complaints and legal notices. */
export const LEGAL_CONTACT_EMAIL = '';

/** Registered name of the business or person that runs Chess Alokas, for example with its SSM number. */
export const LEGAL_ENTITY_NAME = '';

/** Link to the reviewed Bahasa Malaysia version of these pages, once it exists. */
export const LEGAL_BM_VERSION_URL = '';

/** Where each provider stores data, as confirmed from its dashboard. Never guess these. */
export const LEGAL_PROVIDER_LOCATIONS = {
  supabase: '',
  hostinger: '',
  resend: '',
  sentry: '',
  github: '',
};

export type ProviderKey = keyof typeof LEGAL_PROVIDER_LOCATIONS;

export const LEGAL_LAST_UPDATED_ISO = '2026-11-02';
export const LEGAL_LAST_UPDATED = '2 November 2026';

export const NO_CONTACT_TEXT = 'Contact details will be added here.';
export const NO_LOCATION_TEXT = 'Location to be added here.';
export const DEFAULT_OPERATOR = 'the operator of Chess Alokas';

export function operatorName(entity: string = LEGAL_ENTITY_NAME): string {
  return entity.trim() || DEFAULT_OPERATOR;
}

export function providerLocation(
  key: ProviderKey,
  locations: Record<ProviderKey, string> = LEGAL_PROVIDER_LOCATIONS,
): string {
  return locations[key].trim() || NO_LOCATION_TEXT;
}

type LegalFields = {
  contactEmail: string;
  entityName: string;
  bmVersionUrl: string;
  providerLocations: Record<ProviderKey, string>;
};

const CURRENT: LegalFields = {
  contactEmail: LEGAL_CONTACT_EMAIL,
  entityName: LEGAL_ENTITY_NAME,
  bmVersionUrl: LEGAL_BM_VERSION_URL,
  providerLocations: LEGAL_PROVIDER_LOCATIONS,
};

/** Names every detail that is still blank. */
export function listBlankLegalFields(fields: LegalFields = CURRENT): string[] {
  const blank: string[] = [];
  if (!fields.contactEmail.trim()) blank.push('LEGAL_CONTACT_EMAIL');
  if (!fields.entityName.trim()) blank.push('LEGAL_ENTITY_NAME');
  if (!fields.bmVersionUrl.trim()) blank.push('LEGAL_BM_VERSION_URL');
  for (const [key, value] of Object.entries(fields.providerLocations)) {
    if (!value.trim()) blank.push(`LEGAL_PROVIDER_LOCATIONS.${key}`);
  }
  return blank;
}
