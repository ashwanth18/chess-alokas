import { useEffect, useState } from 'react';
import { Button, IconQr, Sheet, buttonClass } from '../../ui';
import { whatsappHref } from './formLogic';

/** The one link parents need: no app and no account. */
export function ShareLink({ link, eventName, live }: { link: string; eventName: string; live: boolean }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!qrOpen) return;
    let stale = false;
    void import('qrcode')
      .then((mod) => mod.toDataURL(link, { margin: 2, width: 320 }))
      .then((url) => {
        if (!stale) setQr(url);
      });
    return () => {
      stale = true;
    };
  }, [qrOpen, link]);

  return (
    <div className="rf-share">
      <p className="rf-share__link" data-testid="registration-link">
        {link}
      </p>
      {!live && <p className="rf-note">The link opens once you accept entries and save.</p>}
      <div className="rf-share__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <a
          className={buttonClass({ size: 'sm' })}
          href={whatsappHref(eventName, link)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on WhatsApp
        </a>
        <Button size="sm" onClick={() => setQrOpen(true)}>
          <IconQr /> QR code
        </Button>
      </div>
      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title="Registration QR code" variant="modal">
        <div className="rf-qr">
          {qr ? <img src={qr} alt={`QR code for ${link}`} width={320} height={320} /> : <p>Drawing the code…</p>}
          <p className="rf-note">Print it or put it on a slide. It opens the same link.</p>
          {qr && (
            <a className={buttonClass({ size: 'sm' })} href={qr} download="registration-qr.png">
              Download image
            </a>
          )}
        </div>
      </Sheet>
    </div>
  );
}
