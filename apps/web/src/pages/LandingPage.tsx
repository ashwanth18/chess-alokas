import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useAuth } from '../auth/AuthContext';

type PlatformKey = 'windows' | 'linux' | 'macos';

type OptionId =
  | 'win-setup'
  | 'win-portable'
  | 'mac-arm64'
  | 'mac-x64'
  | 'linux-appimage';

const RELEASES_API =
  import.meta.env.VITE_GITHUB_RELEASES_API ??
  'https://api.github.com/repos/ashwanth18/chess-alokas/releases/latest';

const RELEASE_BASE =
  import.meta.env.VITE_DOWNLOAD_RELEASE_BASE ??
  'https://github.com/ashwanth18/chess-alokas/releases/download/v0.1.5';

interface DownloadOptionDef {
  id: OptionId;
  platform: PlatformKey;
  label: string;
  detail: string;
  /** Used when GitHub API is unavailable */
  fallbackUrl: string;
  match: (assetName: string) => boolean;
}

const DOWNLOAD_OPTIONS: DownloadOptionDef[] = [
  {
    id: 'win-setup',
    platform: 'windows',
    label: 'Installer',
    detail: 'Recommended · Windows 10/11',
    fallbackUrl: `${RELEASE_BASE}/Chess-Alokas-Setup-win-x64.exe`,
    match: (n) => n.includes('setup') && n.includes('win') && n.endsWith('.exe'),
  },
  {
    id: 'win-portable',
    platform: 'windows',
    label: 'Portable',
    detail: 'No install · run from a folder',
    fallbackUrl: `${RELEASE_BASE}/Chess-Alokas-Portable-win-x64.exe`,
    match: (n) => n.includes('portable') && n.includes('win') && n.endsWith('.exe'),
  },
  {
    id: 'mac-arm64',
    platform: 'macos',
    label: 'Apple Silicon',
    detail: 'M1, M2, M3, M4',
    fallbackUrl: `${RELEASE_BASE}/Chess-Alokas-mac-arm64.dmg`,
    match: (n) =>
      (n.includes('mac') || n.includes('darwin')) &&
      n.includes('arm64') &&
      n.endsWith('.dmg') &&
      !n.includes('blockmap'),
  },
  {
    id: 'mac-x64',
    platform: 'macos',
    label: 'Intel',
    detail: 'Intel Macs',
    fallbackUrl: `${RELEASE_BASE}/Chess-Alokas-mac-x64.dmg`,
    match: (n) =>
      (n.includes('mac') || n.includes('darwin')) &&
      (n.includes('x64') || n.includes('x86_64') || n.includes('intel')) &&
      n.endsWith('.dmg') &&
      !n.includes('blockmap') &&
      !n.includes('arm64'),
  },
  {
    id: 'linux-appimage',
    platform: 'linux',
    label: 'AppImage',
    detail: 'Most distributions · x86_64',
    fallbackUrl: `${RELEASE_BASE}/Chess-Alokas-linux-x86_64.AppImage`,
    match: (n) => n.includes('appimage') || (n.includes('linux') && n.endsWith('.appimage')),
  },
];

interface ResolvedOption {
  id: OptionId;
  platform: PlatformKey;
  label: string;
  detail: string;
  url: string | null;
  available: boolean;
}

function detectClientHints(): { platform: PlatformKey | null; preferArm: boolean } {
  if (typeof navigator === 'undefined') return { platform: null, preferArm: false };
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() ?? '';
  const arch = (
    navigator as Navigator & { userAgentData?: { architecture?: string } }
  ).userAgentData?.architecture?.toLowerCase();
  const preferArm = arch === 'arm' || ua.includes('arm64') || ua.includes('aarch64');

  if (ua.includes('win')) return { platform: 'windows', preferArm: false };
  if (ua.includes('linux') && !ua.includes('android')) {
    return { platform: 'linux', preferArm };
  }
  if (ua.includes('mac') || platform.includes('mac')) {
    // Most Mac browsers still report "MacIntel"; default to Apple Silicon when unknown.
    return { platform: 'macos', preferArm: arch ? preferArm : true };
  }
  return { platform: null, preferArm: false };
}

function isRecommended(option: ResolvedOption, hints: ReturnType<typeof detectClientHints>): boolean {
  if (!hints.platform || option.platform !== hints.platform) return false;
  if (option.id === 'win-setup') return true;
  if (option.id === 'linux-appimage') return true;
  if (option.id === 'mac-arm64') return hints.preferArm;
  if (option.id === 'mac-x64') return !hints.preferArm;
  return false;
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
  { label: string; Icon: () => ReactElement }
> = {
  windows: { label: 'Windows', Icon: WindowsIcon },
  macos: { label: 'macOS', Icon: AppleIcon },
  linux: { label: 'Linux', Icon: LinuxIcon },
};

const PLATFORM_ORDER: PlatformKey[] = ['windows', 'macos', 'linux'];

const FEATURES = [
  {
    title: 'Offline-first',
    body: 'Run pairings without internet. Sync when you’re back online.',
    glyph: '♟',
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

function fallbackOptions(): ResolvedOption[] {
  return DOWNLOAD_OPTIONS.map((o) => ({
    id: o.id,
    platform: o.platform,
    label: o.label,
    detail: o.detail,
    url: o.fallbackUrl,
    available: Boolean(o.fallbackUrl),
  }));
}

export default function LandingPage() {
  const auth = useAuth();
  const clientHints = useMemo(() => detectClientHints(), []);
  const [options, setOptions] = useState<ResolvedOption[]>(fallbackOptions);
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

        setOptions(
          DOWNLOAD_OPTIONS.map((def) => {
            const hit = assets.find((a) => def.match(a.name.toLowerCase()));
            return {
              id: def.id,
              platform: def.platform,
              label: def.label,
              detail: def.detail,
              url: hit?.browser_download_url ?? def.fallbackUrl,
              available: Boolean(hit?.browser_download_url || def.fallbackUrl),
            };
          }),
        );
      } catch {
        /* keep fallbacks */
      } finally {
        if (!cancelled) setLoadingDownloads(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const platforms = PLATFORM_ORDER.map((key) => ({
    key,
    ...PLATFORM_META[key],
    options: options.filter((o) => o.platform === key),
    isClientOs: clientHints.platform === key,
  })).sort((a, b) => Number(b.isClientOs) - Number(a.isClientOs));

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
          Same sign-in as the website. Pick your system and the build that fits.
        </p>
        <div className="landing-download-grid">
          {platforms.map((p) => {
            const Icon = p.Icon;
            return (
              <div
                key={p.key}
                className={`landing-download-card${p.isClientOs ? ' is-current-os' : ''}`}
              >
                <div className="landing-download-card-head">
                  <span className="landing-download-icon-wrap">
                    <Icon />
                  </span>
                  <div>
                    <span className="landing-download-os">{p.label}</span>
                    {p.isClientOs ? (
                      <span className="landing-download-detected">Your system</span>
                    ) : null}
                  </div>
                </div>
                <ul className="landing-download-options">
                  {p.options.map((opt) => {
                    const recommended = isRecommended(opt, clientHints);
                    const disabled = !opt.available || !opt.url;
                    const rowClass = [
                      'landing-download-option',
                      recommended ? 'is-recommended' : '',
                      disabled ? 'is-disabled' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const inner = (
                      <>
                        <span className="landing-download-option-text">
                          <span className="landing-download-option-label">
                            {opt.label}
                            {recommended ? (
                              <span className="landing-download-badge">Recommended</span>
                            ) : null}
                          </span>
                          <span className="landing-download-option-detail">
                            {loadingDownloads ? 'Checking latest…' : opt.detail}
                          </span>
                        </span>
                        <span className="landing-download-option-cta">
                          {disabled ? (loadingDownloads ? '…' : 'Soon') : 'Download'}
                        </span>
                      </>
                    );
                    return (
                      <li key={opt.id}>
                        {disabled ? (
                          <div className={rowClass} aria-disabled="true">
                            {inner}
                          </div>
                        ) : (
                          <a className={rowClass} href={opt.url!} download>
                            {inner}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="landing-footnote">
          Prefer the browser? <Link to="/signup">Create a free account</Link> and run everything at
          chess-manager.alokas.com — no install required.
        </p>
        <p className="landing-footnote">
          On Mac, if the app is blocked the first time: Finder → right-click the app → Open. On
          Windows, SmartScreen may warn until the app builds reputation — choose More info → Run
          anyway.
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
