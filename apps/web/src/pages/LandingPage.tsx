import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

const RELEASES_API =
  import.meta.env.VITE_GITHUB_RELEASES_API ??
  'https://api.github.com/repos/ashwanth18/chess-alokas/releases/latest';

const RELEASES_FALLBACK =
  import.meta.env.VITE_DESKTOP_RELEASES_BASE ??
  'https://github.com/ashwanth18/chess-alokas/releases/latest';

type PlatformKey = 'windows' | 'linux' | 'macos';

interface PlatformDownload {
  key: PlatformKey;
  label: string;
  hint: string;
  url: string | null;
  filenameHint: string;
}

function matchAsset(name: string, platform: PlatformKey): boolean {
  const n = name.toLowerCase();
  if (platform === 'windows') {
    return (n.includes('setup') || n.includes('nsis') || n.endsWith('.exe')) && n.includes('win');
  }
  if (platform === 'linux') {
    return n.includes('appimage') || (n.includes('linux') && (n.endsWith('.appimage') || n.endsWith('.deb')));
  }
  return n.includes('mac') || n.includes('darwin') || n.endsWith('.dmg');
}

function preferSetup(a: string, b: string): number {
  const score = (n: string) => {
    const x = n.toLowerCase();
    if (x.includes('setup') || x.includes('nsis')) return 0;
    if (x.includes('portable')) return 2;
    if (x.endsWith('.dmg') && x.includes('arm64')) return 0;
    return 1;
  };
  return score(a) - score(b);
}

export default function LandingPage() {
  const auth = useAuth();
  const [downloads, setDownloads] = useState<PlatformDownload[]>([
    {
      key: 'windows',
      label: 'Windows',
      hint: 'Installer (.exe)',
      url: null,
      filenameHint: 'Setup win-x64',
    },
    {
      key: 'linux',
      label: 'Linux',
      hint: 'AppImage',
      url: null,
      filenameHint: 'linux AppImage',
    },
    {
      key: 'macos',
      label: 'macOS',
      hint: 'Unsigned DMG — right-click → Open',
      url: null,
      filenameHint: 'mac dmg',
    },
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          assets?: { name: string; browser_download_url: string }[];
          html_url?: string;
        };
        const assets = body.assets ?? [];
        if (cancelled || assets.length === 0) return;

        setDownloads((prev) =>
          prev.map((p) => {
            const matches = assets
              .filter((a) => matchAsset(a.name, p.key))
              .sort((a, b) => preferSetup(a.name, b.name));
            const best = matches[0];
            return best
              ? { ...p, url: best.browser_download_url, hint: best.name }
              : { ...p, url: body.html_url ?? RELEASES_FALLBACK };
          }),
        );
      } catch {
        /* keep fallbacks */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const appCta = auth.user ? (
    <Link to="/app" className="btn btn-primary btn-lg">
      Open app
    </Link>
  ) : (
    <>
      <Link to="/login" className="btn btn-primary btn-lg">
        Sign in
      </Link>
      <Link to="/signup" className="btn btn-outline btn-lg">
        Create account
      </Link>
    </>
  );

  return (
    <div className="landing-page">
      <header className="landing-top">
        <span className="landing-logo">
          <span className="landing-queen" aria-hidden>
            ♕
          </span>
          Chess Alokas
        </span>
        <nav className="landing-nav">
          {auth.user ? (
            <Link to="/app" className="btn btn-sm btn-primary">
              Dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-sm btn-ghost">
                Sign in
              </Link>
              <Link to="/signup" className="btn btn-sm btn-outline">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-board" aria-hidden />
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">Tournament manager</p>
          <h1 className="landing-brand">Chess Alokas</h1>
          <p className="landing-lede">
            Offline-first pairing for clubs and academies — Swiss rounds, certificates, and cloud
            sync when you need it.
          </p>
          <div className="landing-cta">
            {appCta}
            <a href="#download" className="btn btn-ghost btn-lg">
              Download desktop
            </a>
          </div>
        </div>
        <div className="landing-hero-piece" aria-hidden>
          <span className="landing-queen-hero">♕</span>
        </div>
      </section>

      <section className="landing-downloads" id="download">
        <h2>Desktop apps</h2>
        <p className="landing-section-lede">
          Run locally with the same cloud account. Installers publish on GitHub Releases.
        </p>
        <div className="landing-download-grid">
          {downloads.map((d) => (
            <a
              key={d.key}
              className="landing-download-card"
              href={d.url ?? RELEASES_FALLBACK}
              target="_blank"
              rel="noreferrer"
            >
              <span className="landing-download-os">{d.label}</span>
              <span className="landing-download-hint">{d.url ? d.hint : 'View releases'}</span>
            </a>
          ))}
        </div>
        <p className="landing-footnote">
          macOS builds are unsigned until notarization is set up — open via Finder → right-click →
          Open.
        </p>
      </section>

      <footer className="landing-footer">
        <span>© Chess Alokas</span>
        <a href={RELEASES_FALLBACK} target="_blank" rel="noreferrer">
          All releases
        </a>
      </footer>
    </div>
  );
}
