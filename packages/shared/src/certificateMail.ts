export const DEFAULT_CERT_SERIAL_PREFIX = 'ARCC';
export const DEFAULT_CERT_SERIAL_PAD = 3;

export const DEFAULT_CERT_EMAIL_SUBJECT =
  'Your {{certType}} certificate — {{tournament}}';

export const DEFAULT_CERT_EMAIL_BODY = `Dear {{playerName}},

Please find attached your {{certType}} certificate for {{tournament}}.

Certificate serial: {{serial}}

Congratulations,
The organising team`;

export function certificateYear(date: string | null | undefined, fallback = new Date()): number {
  if (date && /^\d{4}/.test(date)) {
    const y = Number(date.slice(0, 4));
    if (y >= 1990 && y <= 2100) return y;
  }
  return fallback.getFullYear();
}

export function formatCertificateSerial(
  prefix: string,
  sequence: number,
  pad: number,
  year: number,
): string {
  const cleanPrefix = prefix.trim().replace(/\/+$/, '') || DEFAULT_CERT_SERIAL_PREFIX;
  const width = Math.min(8, Math.max(1, Math.floor(pad) || DEFAULT_CERT_SERIAL_PAD));
  const seq = String(Math.max(1, Math.floor(sequence))).padStart(width, '0');
  return `${cleanPrefix}/${seq}/${year}`;
}

export type CertEmailVars = {
  playerName: string;
  tournament: string;
  certType: string;
  serial: string;
};

export function renderCertTemplate(template: string, vars: CertEmailVars): string {
  const map: Record<string, string> = {
    playerName: vars.playerName,
    tournament: vars.tournament,
    certType: vars.certType,
    serial: vars.serial,
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => map[key] ?? '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text → simple HTML paragraphs; pass through if it already looks like HTML. */
export function certBodyToHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '<p></p>';
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

export function certTypeLabel(type: string): string {
  return type === 'winner' ? 'winner' : 'participation';
}
