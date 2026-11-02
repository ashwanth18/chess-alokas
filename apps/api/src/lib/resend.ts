import { DEMO_EMAIL_BLOCKED_MESSAGE, isDemoEmailAddress } from '../demo/constants.js';

export const MAX_EMAIL_PDF_BYTES = 8 * 1024 * 1024;

export async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  pdf?: Uint8Array;
  fileName?: string;
  requirePdf?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['RESEND_FROM'] ?? 'Chess Alokas <onboarding@resend.dev>';
  if (isDemoEmailAddress(opts.to)) {
    return { ok: false, error: DEMO_EMAIL_BLOCKED_MESSAGE };
  }
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }

  if (opts.requirePdf) {
    if (!opts.pdf) return { ok: false, error: 'PDF file missing' };
    if (opts.pdf.byteLength > MAX_EMAIL_PDF_BYTES) {
      return { ok: false, error: 'PDF is too large to email (over 8 MB)' };
    }
    if (!opts.fileName) return { ok: false, error: 'PDF file missing' };
  }

  const attachments =
    opts.pdf && opts.pdf.byteLength <= MAX_EMAIL_PDF_BYTES && opts.fileName
      ? [
          {
            filename: opts.fileName,
            content: Buffer.from(opts.pdf).toString('base64'),
          },
        ]
      : undefined;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      attachments,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text.slice(0, 300) || `Resend HTTP ${res.status}` };
  }
  return { ok: true };
}
