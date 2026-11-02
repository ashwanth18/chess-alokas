import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** The first page of a PDF, drawn to fit its box. For "this is what they'll get". */
export function PdfPreview({ bytes, label }: { bytes: Uint8Array | null; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'idle' | 'drawing' | 'done' | 'error'>('idle');

  useEffect(() => {
    if (!bytes) {
      setState('idle');
      return;
    }
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    setState('drawing');
    void (async () => {
      try {
        task = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 1200 / base.width });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No canvas');
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setState('done');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [bytes]);

  return (
    <figure className="cw-preview">
      <div className="cw-preview__paper">
        <canvas ref={canvasRef} role="img" aria-label={label} hidden={state !== 'done'} />
        {state === 'drawing' && <p className="cw-preview__msg">Drawing the certificate...</p>}
        {state === 'error' && <p className="cw-preview__msg">This PDF could not be shown here.</p>}
        {state === 'idle' && <p className="cw-preview__msg">No certificate to show yet.</p>}
      </div>
      <figcaption className="cw-small">{label}</figcaption>
    </figure>
  );
}
