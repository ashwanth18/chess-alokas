import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { CertificateField, CertificateRow } from '@chess-alokas/certificates';
import { certificateColumnLabel } from '../lib/certificateColumns';

// Emit as .js (see vite.config) so nginx MIME is always application/javascript
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface CertificateDesignerCanvasProps {
  templateBytes: Uint8Array;
  pageWidth: number;
  pageHeight: number;
  fields: CertificateField[];
  sampleRow?: CertificateRow;
  selectedColumn: string;
  selectedFieldId?: string | null;
  placeFontSize: number;
  onPlace: (x: number, y: number, column?: string) => void;
  onMoveField: (id: string, x: number, y: number) => void;
  onSelectColumn?: (column: string) => void;
  onSelectField?: (id: string) => void;
  onFontSizeChange?: (id: string, fontSize: number) => void;
}

function previewPx(fontSize: number, pageHeight: number, displayHeight: number): number {
  return Math.max(8, (fontSize / pageHeight) * displayHeight);
}

/** Render page 1 to canvas so overlay % coords match PDF page coords 1:1. */
export default function CertificateDesignerCanvas({
  templateBytes,
  pageWidth,
  pageHeight,
  fields,
  sampleRow,
  selectedColumn,
  selectedFieldId,
  placeFontSize,
  onPlace,
  onMoveField,
  onSelectColumn: _onSelectColumn,
  onSelectField,
  onFontSizeChange,
}: CertificateDesignerCanvasProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [spaceDown, setSpaceDown] = useState(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; column: string } | null>(null);
  const panRef = useRef<{ active: boolean; x: number; y: number; sl: number; st: number } | null>(
    null,
  );
  const viewportRef = useRef<HTMLDivElement>(null);

  // Base display width in CSS px (page then scales with zoom)
  const baseWidth = 720;
  const displayWidth = baseWidth * zoom;
  const displayHeight = displayWidth * (pageHeight / pageWidth);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      setRendering(true);
      setRenderError(null);
      try {
        const copy = new Uint8Array(templateBytes.byteLength);
        copy.set(templateBytes);
        const loadingTask = pdfjs.getDocument({ data: copy });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        // Render at high DPI for clarity; CSS size is separate
        const scale = (baseWidth * 2) / pageWidth;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Failed to render PDF');
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [templateBytes, pageWidth]);

  function clientToNorm(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = pageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(0.98, Math.max(0.02, (clientX - rect.left) / rect.width)),
      y: Math.min(0.98, Math.max(0.02, (clientY - rect.top) / rect.height)),
    };
  }

  function onPageClick(e: React.MouseEvent) {
    if (spaceDown || panRef.current?.active) return;
    const norm = clientToNorm(e.clientX, e.clientY);
    if (!norm) return;
    onPlace(norm.x, norm.y);
  }

  function onFieldMouseDown(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (spaceDown) return;
    onSelectField?.(id);

    const move = (ev: MouseEvent) => {
      const norm = clientToNorm(ev.clientX, ev.clientY);
      if (!norm) return;
      onMoveField(id, norm.x, norm.y);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function onViewportMouseDown(e: React.MouseEvent) {
    if (!spaceDown && e.button !== 1) return;
    const vp = viewportRef.current;
    if (!vp) return;
    e.preventDefault();
    panRef.current = {
      active: true,
      x: e.clientX,
      y: e.clientY,
      sl: vp.scrollLeft,
      st: vp.scrollTop,
    };
    const move = (ev: MouseEvent) => {
      const pan = panRef.current;
      if (!pan?.active || !viewportRef.current) return;
      viewportRef.current.scrollLeft = pan.sl - (ev.clientX - pan.x);
      viewportRef.current.scrollTop = pan.st - (ev.clientY - pan.y);
    };
    const up = () => {
      panRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function fitWidth() {
    const vp = viewportRef.current;
    if (!vp) {
      setZoom(1);
      return;
    }
    const available = Math.max(280, vp.clientWidth - 32);
    setZoom(available / baseWidth);
  }

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(3, Math.max(0.35, Math.round((z + delta) * 100) / 100)));
  }

  function fieldSample(column: string): string {
    return sampleRow?.[column] != null ? String(sampleRow[column]) : `[${column}]`;
  }

  function renderMarker(
    column: string,
    fontSize: number,
    opts: { selected?: boolean; ghost?: boolean; sizeLabel?: boolean },
  ) {
    const px = previewPx(fontSize, pageHeight, displayHeight);
    return (
      <>
        <span className="cert-field-sample" style={{ fontSize: px }}>
          {fieldSample(column)}
        </span>
        {opts.sizeLabel && (
          <span className="cert-field-size-badge">
            {certificateColumnLabel(column)} · {fontSize} pt
          </span>
        )}
      </>
    );
  }

  return (
    <div className="cert-designer">
      <div className="cert-zoom-bar">
        <button type="button" className="btn btn-sm btn-outline" onClick={() => setZoom((z) => Math.max(0.35, z - 0.15))}>
          −
        </button>
        <span className="cert-zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => setZoom((z) => Math.min(3, z + 0.15))}>
          +
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={fitWidth}>
          Fit width
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom(1)}>
          100%
        </button>
        <span className="form-hint cert-zoom-hint">
          Drag a column onto the page to preview its size · click a field to resize
        </span>
      </div>

      <div
        ref={viewportRef}
        className={`cert-viewport ${spaceDown ? 'panning' : ''}`}
        onMouseDown={onViewportMouseDown}
        onWheel={onWheel}
      >
        <div
          className="cert-page-stage"
          style={{ width: displayWidth, height: displayHeight }}
        >
          <div
            ref={pageRef}
            className="cert-page"
            style={{ width: displayWidth, height: displayHeight }}
            onClick={onPageClick}
            onDragOver={(e) => {
              e.preventDefault();
              const col = e.dataTransfer.getData('text/plain') || selectedColumn;
              const norm = clientToNorm(e.clientX, e.clientY);
              if (norm) setGhost({ x: norm.x, y: norm.y, column: col });
            }}
            onDragLeave={(e) => {
              if (!pageRef.current?.contains(e.relatedTarget as Node)) setGhost(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setGhost(null);
              const col = e.dataTransfer.getData('text/plain') || selectedColumn;
              const norm = clientToNorm(e.clientX, e.clientY);
              if (norm) onPlace(norm.x, norm.y, col);
            }}
          >
            <canvas ref={canvasRef} className="cert-page-canvas" />
            {rendering && <div className="cert-page-loading">Rendering template…</div>}
            {renderError && <div className="form-error cert-page-error">{renderError}</div>}

            <div className="cert-overlay">
              {fields.map((f) => {
                const selected = selectedFieldId === f.id;
                const px = previewPx(f.fontSize, pageHeight, displayHeight);
                return (
                  <div
                    key={f.id}
                    className={`cert-field-marker${selected ? ' is-selected' : ''}`}
                    style={{
                      left: `${f.x * 100}%`,
                      top: `${f.y * 100}%`,
                      transform:
                        f.align === 'center'
                          ? 'translate(-50%, -50%)'
                          : f.align === 'right'
                            ? 'translate(-100%, -50%)'
                            : 'translate(0, -50%)',
                      textAlign: f.align,
                    }}
                    onMouseDown={(e) => onFieldMouseDown(f.id, e)}
                    onClick={(e) => e.stopPropagation()}
                    title="Drag to move · use the slider to resize"
                  >
                    <span className="cert-field-sample" style={{ fontSize: px }}>
                      {fieldSample(f.sourceColumn)}
                    </span>
                    <span className="cert-field-size-badge">
                      {certificateColumnLabel(f.sourceColumn)} · {f.fontSize} pt
                    </span>
                    {selected && onFontSizeChange && (
                      <div
                        className="cert-field-resize"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => onFontSizeChange(f.id, Math.max(8, f.fontSize - 2))}
                        >
                          −
                        </button>
                        <input
                          type="range"
                          min={8}
                          max={72}
                          value={f.fontSize}
                          aria-label={`${certificateColumnLabel(f.sourceColumn)} font size`}
                          onChange={(e) => onFontSizeChange(f.id, Number(e.target.value))}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => onFontSizeChange(f.id, Math.min(72, f.fontSize + 2))}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {ghost && (
                <div
                  className="cert-field-marker is-ghost"
                  style={{
                    left: `${ghost.x * 100}%`,
                    top: `${ghost.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                  }}
                >
                  {renderMarker(ghost.column, placeFontSize, { ghost: true, sizeLabel: true })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
