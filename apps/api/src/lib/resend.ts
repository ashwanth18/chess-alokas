import { DEMO_EMAIL_BLOCKED_MESSAGE, isDemoEmailAddress } from '../demo/constants.js';

export const MAX_EMAIL_PDF_BYTES = 8 * 1024 * 1024;

export async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  pdf?: Uint8Array;
  fileName?: string;
  requirePdf?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string; reached: boolean }> {
  // `reached` is false when the message never got to Resend, so it shouldn't count against a cap.
  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['RESEND_FROM'] ?? 'Chess Alokas <onboarding@resend.dev>';
  if (isDemoEmailAddress(opts.to)) {
    return { ok: false, error: DEMO_EMAIL_BLOCKED_MESSAGE, reached: false };
  }
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured', reached: false };
  }

  if (opts.requirePdf) {
    if (!opts.pdf) return { ok: false, error: 'PDF file missing', reached: false };
    if (opts.pdf.byteLength > MAX_EMAIL_PDF_BYTES) {
      return { ok: false, error: 'PDF is too large to email (over 8 MB)', reached: false };
    }
    if (!opts.fileName) return { ok: false, error: 'PDF file missing', reached: false };
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

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
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
  } catch {
    return { ok: false, error: "Couldn't reach the mail service", reached: false };
  }

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text.slice(0, 300) || `Resend HTTP ${res.status}`, reached: true };
  }
  return { ok: true };
}
