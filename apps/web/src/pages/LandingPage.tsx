import { Link } from 'react-router-dom';
import { useEffect, useState, type ReactElement } from 'react';
import { useAuth } from '../auth/AuthContext';

type PlatformKey = 'windows' | 'linux' | 'macos';

const RELEASES_API =
  import.meta.env.VITE_GITHUB_RELEASES_API ??
  'https://api.github.com/repos/ashwanth18/chess-alokas/releases/latest';

/** Direct download links shown as normal “Download” buttons (not branded as GitHub). */
const DIRECT_DOWNLOADS: Partial<Record<PlatformKey, string>> = {
  windows:
    import.meta.env.VITE_DOWNLOAD_WINDOWS_URL ??
    'https://github.com/ashwanth18/chess-alokas/releases/download/v0.1.2/Chess-Alokas-Setup-win-x64.exe',
  linux: import.meta.env.VITE_DOWNLOAD_LINUX_URL || undefined,
  macos: import.meta.env.VITE_DOWNLOAD_MACOS_URL || undefined,
};

interface PlatformDownload {
  key: PlatformKey;
  label: string;
  hint: string;
  url: string | null;
  available: boolean;
}

function matchAsset(name: string, platform: PlatformKey): boolean {
  const n = name.toLowerCase().replace(/\s+/g, '-');
  if (platform === 'windows') {
    return n.endsWith('.exe') && (n.includes('win') || n.includes('setup') || n.includes('portable'));
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

function WindowsIcon() {
  return (
    <svg className="landing-os-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M3 5.5 10.5 4.4v7.1H3V5.5Zm0 13 7.5 1.1v-7.2H3v6.1ZM11.5 4.25 21 3v8.5h-9.5V4.25ZM11.5 21 21 21.75V12.5h-9.5V21Z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="landing-os-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M16.4 12.7c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.8-.7-1.4 0-2.8.9-3.5 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.1 1.1 0 1.5-.7 2.8-.7s1.6.7 2.8.7c1.2 0 1.9-1 2.6-2 .8-1.2 1.1-2.3 1.1-2.4-.1 0-2.2-.8-2.2-3.7Zm-2-6.2c.6-.7 1-1.7.9-2.7-0.9.1-1.9.6-2.5 1.3-.6.6-1.1 1.7-.9 2.6 1 .1 1.9-.4 2.5-1.2Z"
      />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg className="landing-os-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12.5 2.2c-1.4 0-2.4 1.5-2.2 3 .1.8.4 1.5.4 2.3 0 .4-.3.6-.7.8-1.7.7-3.1 2.2-3.1 4.3 0 1.3.6 2.4 1.4 3.2l-.4 1.4c-.4 1.4.2 2.4 1.4 2.8.5.2 1 .1 1.4-.1.5.8 1.3 1.4 2.3 1.4s1.8-.6 2.3-1.4c.4.2.9.3 1.4.1 1.2-.4 1.8-1.4 1.4-2.8l-.4-1.4c.8-.8 1.4-1.9 1.4-3.2 0-2.1-1.4-3.6-3.1-4.3-.4-.2-.7-.4-.7-.8 0-.8.3-1.5.4-2.3.2-1.5-.8-3-2.2-3Zm-1.8 4.6c.3 0 .6.3.6.6s-.3.6-.6.6-.6-.3-.6-.6.3-.6.6-.6Zm3.6 0c.3 0 .6.3.6.6s-.3.6-.6.6-.6-.3-.6-.6.3-.6.6-.6Zm-4.2 3.1c.8.4 1.6.6 2.4.6s1.6-.2 2.4-.6c.2 1.1-.3 2.1-1.1 2.6-.4.2-.8.4-1.3.4s-.9-.1-1.3-.4c-.8-.5-1.3-1.5-1.1-2.6Z"
      />
    </svg>
  );
}

const PLATFORM_META: Record<
  PlatformKey,
  { label: string; defaultHint: string; Icon: () => ReactElement }
> = {
  windows: { label: 'Windows', defaultHint: 'Installer for Windows 10/11', Icon: WindowsIcon },
  macos: { label: 'macOS', defaultHint: 'App for Apple Silicon & Intel', Icon: AppleIcon },
  linux: { label: 'Linux', defaultHint: 'AppImage for most distributions', Icon: LinuxIcon },
};

const FEATURES = [
  {
    title: 'Offline-first',
    body: 'Run pairings without internet. Sync when you’re back online.',
    glyph: ' downstream',
  },
  {
    title: 'FIDE Swiss',
    body: 'Score groups, color balance, and rematch avoidance built in.',
    glyph: '⚔',
  },
  {
    title: 'Certificates',
    body: 'Design templates, print packs, and issue digital PDFs.',
    glyph: '📜',
  },
  {
    title: 'Your account',
    body: 'Sign in once — web and desktop share the same tournaments.',
    glyph: '♛',
  },
];

export default function LandingPage() {
  const auth = useAuth();
  const [downloads, setDownloads] = useState<PlatformDownload[]>(() =>
    (['windows', 'macos', 'linux'] as PlatformKey[]).map((key) => {
      const direct = DIRECT_DOWNLOADS[key];
      return {
        key,
        label: PLATFORM_META[key].label,
        hint: direct
          ? key === 'windows'
            ? 'Windows installer'
            : key === 'macos'
              ? 'macOS disk image'
              : 'Linux AppImage'
          : PLATFORM_META[key].defaultHint,
        url: direct ?? null,
        available: Boolean(direct),
      };
    }),
  );
  const [loadingDownloads, setLoadingDownloads] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) {
          if (!cancelled) setLoadingDownloads(false);
          return;
        }
        const body = (await res.json()) as {
          assets?: { name: string; browser_download_url: string }[];
        };
        const assets = body.assets ?? [];
        if (cancelled) return;

        setDownloads((prev) =>
          prev.map((p) => {
            if (p.available && p.url) return p;
            const matches = assets
              .filter((a) => matchAsset(a.name, p.key))
              .sort((a, b) => preferSetup(a.name, b.name));
            const best = matches[0];
            if (!best) {
              return { ...p, available: false, hint: 'Coming soon', url: null };
            }
            const friendly =
              p.key === 'windows'
                ? 'Windows installer'
                : p.key === 'macos'
                  ? 'macOS disk image'
                  : 'Linux AppImage';
            return { ...p, url: best.browser_download_url, hint: friendly, available: true };
          }),
        );
      } catch {
        /* keep direct links / coming soon */
      } finally {
        if (!cancelled) setLoadingDownloads(false);
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
          <a href="#features" className="btn btn-sm btn-ghost">
            Features
          </a>
          <a href="#download" className="btn btn-sm btn-ghost">
            Download
          </a>
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
          <p className="landing-eyebrow">Chess tournament manager</p>
          <h1 className="landing-brand">Chess Alokas</h1>
          <p className="landing-lede">
            Pair rounds, track standings, and print certificates — in the browser or as a desktop
            app. Works offline; syncs when you connect.
          </p>
          <div className="landing-cta">
            {appCta}
            <a href="#download" className="btn btn-ghost btn-lg">
              Get the desktop app
            </a>
          </div>
        </div>
        <div className="landing-hero-piece" aria-hidden>
          <span className="landing-queen-hero">♕</span>
        </div>
      </section>

      <section className="landing-features" id="features">
        <h2>Built for tournament day</h2>
        <p className="landing-section-lede">
          Everything directors need at the boards — without fighting spreadsheets.
        </p>
        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="landing-feature-card">
              <span className="landing-feature-glyph" aria-hidden>
                {f.glyph}
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-downloads" id="download">
        <h2>Download for your computer</h2>
        <p className="landing-section-lede">
          Same sign-in as the website. Choose your system — install and go.
        </p>
        <div className="landing-download-grid">
          {downloads.map((d) => {
            const meta = PLATFORM_META[d.key];
            const Icon = meta.Icon;
            const disabled = !d.available || !d.url;
            const className = `landing-download-card${disabled ? ' is-disabled' : ''}`;
            const content = (
              <>
                <span className="landing-download-icon-wrap">
                  <Icon />
                </span>
                <span className="landing-download-os">{d.label}</span>
                <span className="landing-download-hint">
                  {loadingDownloads ? 'Checking…' : d.hint}
                </span>
                <span className="landing-download-cta">
                  {disabled ? (loadingDownloads ? '…' : 'Coming soon') : 'Download'}
                </span>
              </>
            );
            return disabled ? (
              <div key={d.key} className={className} aria-disabled="true">
                {content}
              </div>
            ) : (
              <a key={d.key} className={className} href={d.url!} download>
                {content}
              </a>
            );
          })}
        </div>
        <p className="landing-footnote">
          Prefer the browser? <Link to="/signup">Create a free account</Link> and run everything at
          chess-manager.alokas.com — no install required.
        </p>
        <p className="landing-footnote">
          On Mac, if the app is blocked the first time: Finder → right-click the app → Open.
        </p>
      </section>

      <section className="landing-howto">
        <h2>How it works</h2>
        <ol className="landing-steps">
          <li>
            <strong>Sign up</strong> — email magic link, password, or Google / GitHub.
          </li>
          <li>
            <strong>Create a tournament</strong> — import players, pair Swiss rounds, enter results.
          </li>
          <li>
            <strong>Sync</strong> — push to the cloud or keep working offline on desktop.
          </li>
        </ol>
      </section>

      <footer className="landing-footer">
        <span>© Chess Alokas</span>
        <div className="landing-footer-links">
          <Link to="/login">Sign in</Link>
          <a href="#download">Downloads</a>
        </div>
      </footer>
    </div>
  );
}
