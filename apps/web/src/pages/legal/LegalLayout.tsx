import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Surface } from '../../ui/Surface';
import {
  LEGAL_BM_VERSION_URL,
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_LAST_UPDATED_ISO,
  NO_CONTACT_TEXT,
} from './legalConfig';
import './legal.css';

const SITE = 'https://chess-manager.alokas.com';

export type LegalSection = { id: string; title: string; body: ReactNode };

/** The contact address, or neutral text until one is set in legalConfig.ts. */
export function LegalContact({ email = LEGAL_CONTACT_EMAIL }: { email?: string }) {
  const value = email.trim();
  if (!value) return <>{NO_CONTACT_TEXT}</>;
  return (
    <>
      Email: <a href={`mailto:${value}`}>{value}</a>
    </>
  );
}

/** Hairline table that reads as labelled rows on a phone. */
export function LegalTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <table className="lg-table">
      <caption className="lg-vh">{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) =>
              c === 0 ? (
                <th key={c} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={c} data-label={head[c]}>
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LegalLayout({
  title,
  path,
  summary,
  sections,
}: {
  title: string;
  path: '/privacy' | '/terms';
  summary: ReactNode;
  sections: LegalSection[];
}) {
  const { hash } = useLocation();

  useEffect(() => {
    document.title = `${title} · Chess Alokas`;
  }, [title]);

  // The page loads lazily and comes from another route, so the browser can't do this by itself.
  // Section links go through the router too: a bare #id would be a route change under HashRouter.
  useEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) target.scrollIntoView({ behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, [path, hash]);

  const bmUrl = LEGAL_BM_VERSION_URL.trim();

  return (
    <Surface name="family">
      <div className="lg">
        <meta property="og:title" content={`${title} · Chess Alokas`} />
        <link rel="canonical" href={`${SITE}${path}`} />

        <Link className="lg-skip" to={{ pathname: path, hash: 'lg-main' }}>
          Skip to content
        </Link>
        <header className="lg-top">
          <div className="lg-wrap lg-top-in">
            <Link className="lg-mark" to="/">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="1" y="1" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M2 2h8v16H2z" fill="currentColor" />
              </svg>
              Chess Alokas
            </Link>
            <nav aria-label="Legal pages">
              <Link to="/privacy" aria-current={path === '/privacy' ? 'page' : undefined}>
                Privacy
              </Link>
              <Link to="/terms" aria-current={path === '/terms' ? 'page' : undefined}>
                Terms
              </Link>
            </nav>
          </div>
        </header>

        <main id="lg-main" className="lg-wrap">
          <div className="lg-head">
            <h1>{title}</h1>
            <p className="lg-date">
              Last updated <time dateTime={LEGAL_LAST_UPDATED_ISO}>{LEGAL_LAST_UPDATED}</time>
            </p>
            <p className="lg-date">
              {bmUrl ? (
                <a href={bmUrl} lang="ms">
                  Baca dalam Bahasa Malaysia
                </a>
              ) : (
                <>
                  A Bahasa Malaysia version will be added here.{' '}
                  <span lang="ms">Versi Bahasa Malaysia akan ditambah di sini.</span>
                </>
              )}
            </p>
          </div>

          <div className="lg-summary">{summary}</div>

          <div className="lg-grid">
            <nav className="lg-toc" aria-label="On this page">
              <h2>On this page</h2>
              <ol>
                {sections.map((s) => (
                  <li key={s.id}>
                    <Link to={{ pathname: path, hash: s.id }}>{s.title}</Link>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="lg-body">
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
                  <h2 id={`${s.id}-h`}>
                    <span className="lg-n" aria-hidden="true">
                      {i + 1}
                    </span>
                    {s.title}
                  </h2>
                  {s.body}
                </section>
              ))}
            </div>
          </div>
        </main>

        <footer className="lg-foot">
          <div className="lg-wrap lg-foot-in">
            <span>Chess Alokas</span>
            <nav aria-label="Footer">
              <Link to="/">Home</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
            </nav>
          </div>
        </footer>
      </div>
    </Surface>
  );
}
