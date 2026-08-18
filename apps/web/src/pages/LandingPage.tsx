import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useAuth } from '../auth/AuthContext';
import { trackPageView } from '../lib/pageAnalytics';
import { trackProductEvent } from '../lib/productTelemetry';

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
  'https://github.com/ashwanth18/chess-alokas/releases/download/v0.1.7';

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
    body: 'Run full tournaments with zero internet. Every pairing, result, and standing lives on the device — sync is a bonus, not a dependency.',
    glyph: '♟',
  },
  {
    title: 'Swiss & FIDE Dutch',
    body: 'Your own Swiss engine for everyday events, plus official FIDE Dutch boards from bbpPairings v6 — the 2026 handbook pairing program — when it counts.',
    glyph: '♞',
  },
  {
    title: 'Certificates',
    body: 'Design once, issue hundreds. Print packs or send signed digital PDFs straight from the standings you just finalized.',
    glyph: '📜',
  },
  {
    title: 'One account, everywhere',
    body: 'Sign in once. Start a round on the tournament hall desktop, check standings from your phone browser — same data, always in sync.',
    glyph: '♛',
  },
];

const STEPS = [
  {
    title: 'Sign up',
    body: 'Email magic link, a password, or Google / GitHub. Thirty seconds, no card required.',
  },
  {
    title: 'Build the field',
    body: 'Import a CSV or add players by hand. Categories, ratings, and byes all fall into place.',
  },
  {
    title: 'Run the rounds',
    body: 'Pair with one click, enter results at the board, watch standings update live.',
  },
  {
    title: 'Wrap it up',
    body: 'Issue certificates, export final standings, sync to the cloud whenever you’re back online.',
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

/** Scroll-triggered reveal — fires once, and no-ops (renders visible immediately)
 * when the visitor has asked for reduced motion. */
function useReveal<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, visible];
}

const FLOATING_GLYPHS = ['♜', '♝', '♞', '♟', '♚'];

export default function LandingPage() {
  const auth = useAuth();
  const clientHints = useMemo(() => detectClientHints(), []);
  const [options, setOptions] = useState<ResolvedOption[]>(fallbackOptions);
  const [loadingDownloads, setLoadingDownloads] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    trackPageView({ routeKey: 'landing', path: '/' });
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  const floaters = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        glyph: FLOATING_GLYPHS[i % FLOATING_GLYPHS.length]!,
        left: `${(i * 37 + 6) % 100}%`,
        top: `${(i * 53 + 12) % 100}%`,
        size: 1.1 + ((i * 7) % 5) * 0.35,
        duration: 14 + ((i * 11) % 9),
        delay: -((i * 3) % 12),
      })),
    [],
  );

  const [mockRef, mockVisible] = useReveal<HTMLDivElement>();
  const [engineRef, engineVisible] = useReveal<HTMLElement>();
  const [featuresRef, featuresVisible] = useReveal<HTMLElement>();
  const [stepsRef, stepsVisible] = useReveal<HTMLElement>();
  const [downloadRef, downloadVisible] = useReveal<HTMLElement>();
  const [ctaRef, ctaVisible] = useReveal<HTMLElement>();

  const appCta = auth.user ? (
    <Link to="/app" className="btn btn-primary btn-lg landing-shine">
      Open app
    </Link>
  ) : (
    <>
      <Link to="/signup" className="btn btn-primary btn-lg landing-shine">
        Create free account
      </Link>
      <Link to="/login" className="btn btn-outline btn-lg">
        Sign in
      </Link>
    </>
  );

  return (
    <div className="landing-page">
      <header className={`landing-top${scrolled ? ' is-scrolled' : ''}`}>
        <span className="landing-logo">
          <span className="landing-queen" aria-hidden>
            ♕
          </span>
          Chess Alokas
        </span>
        <nav className="landing-nav">
          <a href="#engine" className="btn btn-sm btn-ghost landing-nav-link">
            Pairing engine
          </a>
          <a href="#features" className="btn btn-sm btn-ghost landing-nav-link">
            Features
          </a>
          <a href="#download" className="btn btn-sm btn-ghost landing-nav-link">
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
        <div className="landing-hero-aurora" aria-hidden />
        <div className="landing-hero-board" aria-hidden />
        <div className="landing-hero-floaters" aria-hidden>
          {floaters.map((f, i) => (
            <span
              key={i}
              className="landing-floater"
              style={{
                left: f.left,
                top: f.top,
                fontSize: `${f.size}rem`,
                animationDuration: `${f.duration}s`,
                animationDelay: `${f.delay}s`,
              }}
            >
              {f.glyph}
            </span>
          ))}
        </div>

        <div className="landing-hero-copy">
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-dot" aria-hidden />
            Now pairing with bbpPairings&nbsp;v6 — the 2026 FIDE handbook engine
          </p>
          <h1 className="landing-brand">
            Run the tournament.
            <br />
            <span className="landing-brand-accent">Not the spreadsheet.</span>
          </h1>
          <p className="landing-lede">
            Pair rounds, track standings, and print certificates — in the browser or as a desktop
            app. Built offline-first for the tournament hall, and syncs the moment you’re back
            online.
          </p>
          <div className="landing-cta">{appCta}</div>
          <div className="landing-hero-chips">
            <span className="landing-chip">♜ Swiss &amp; FIDE Dutch</span>
            <span className="landing-chip">⚡ Works with zero internet</span>
            <span className="landing-chip">✓ Free to start</span>
          </div>
        </div>

        <div className="landing-hero-visual" aria-hidden>
          <PairingGlyph />
        </div>
      </section>

      <section className="landing-preview">
        <div
          ref={mockRef}
          className={`landing-mock${mockVisible ? ' is-visible' : ''}`}
        >
          <div className="landing-mock-glow" aria-hidden />
          <div className="landing-mock-card">
            <div className="landing-mock-bar">
              <span className="landing-mock-dot landing-mock-dot--r" />
              <span className="landing-mock-dot landing-mock-dot--y" />
              <span className="landing-mock-dot landing-mock-dot--g" />
              <span className="landing-mock-title">Round 4 · Under-18 Open</span>
              <span className="landing-mock-live">
                <span className="landing-mock-live-dot" /> Live
              </span>
            </div>
            <div className="landing-mock-body">
              <div className="landing-mock-pairings">
                <h4>Pairings</h4>
                {[
                  ['1', 'A. Meyer', 'S. Okafor', '1–0'],
                  ['2', 'R. Castillo', 'T. Nyugen', '½–½'],
                  ['3', 'J. Park', 'L. Novak', '⏳'],
                  ['4', 'D. Haile', 'M. Bianchi', '⏳'],
                ].map(([board, w, b, r]) => (
                  <div className="landing-mock-row" key={board}>
                    <span className="landing-mock-board">{board}</span>
                    <span className="landing-mock-players">
                      {w} <em>vs</em> {b}
                    </span>
                    <span
                      className={`landing-mock-result${r === '⏳' ? ' is-pending' : ''}`}
                    >
                      {r}
                    </span>
                  </div>
                ))}
              </div>
              <div className="landing-mock-standings">
                <h4>Standings</h4>
                {[
                  ['1', 'S. Okafor', '3.5'],
                  ['2', 'A. Meyer', '3.0'],
                  ['3', 'L. Novak', '3.0'],
                  ['4', 'T. Nyugen', '2.5'],
                ].map(([rank, name, score]) => (
                  <div className="landing-mock-row landing-mock-row--standing" key={rank}>
                    <span className="landing-mock-rank">{rank}</span>
                    <span className="landing-mock-players">{name}</span>
                    <span className="landing-mock-score">{score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`landing-engine${engineVisible ? ' is-visible' : ''}`}
        id="engine"
        ref={engineRef as React.RefObject<HTMLElement>}
      >
        <div className="landing-engine-copy">
          <p className="landing-eyebrow">Pairing engine</p>
          <h2>Two engines. One click.</h2>
          <p className="landing-section-lede">
            Everyday club nights run on our own Swiss implementation. When a tournament needs to
            be FIDE-rated, switch categories to Dutch and every board comes straight from
            bbpPairings — the same program national federations use.
          </p>
          <ul className="landing-engine-list">
            <li>Score-group pairing with rematch and colour-balance avoidance</li>
            <li>Automatic byes, floaters, and absence handling</li>
            <li>Buchholz, Sonneborn-Berger, and configurable tiebreak order</li>
          </ul>
        </div>
        <div className="landing-bracket" aria-hidden>
          <BracketDiagram animate={engineVisible} />
        </div>
      </section>

      <section
        className={`landing-features${featuresVisible ? ' is-visible' : ''}`}
        id="features"
        ref={featuresRef as React.RefObject<HTMLElement>}
      >
        <p className="landing-eyebrow landing-eyebrow--center">Built for tournament day</p>
        <h2 className="landing-center-heading">Everything the boards need</h2>
        <p className="landing-section-lede landing-section-lede--center">
          No fighting spreadsheets between rounds — just the tools a director actually reaches
          for.
        </p>
        <div className="landing-feature-grid">
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className="landing-feature-card"
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <span className="landing-feature-glyph" aria-hidden>
                {f.glyph}
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className={`landing-howto${stepsVisible ? ' is-visible' : ''}`}
        ref={stepsRef as React.RefObject<HTMLElement>}
      >
        <p className="landing-eyebrow landing-eyebrow--center">Getting started</p>
        <h2 className="landing-center-heading">From sign-up to standings</h2>
        <ol className="landing-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} style={{ transitionDelay: `${i * 110}ms` }}>
              <span className="landing-step-num">{i + 1}</span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className={`landing-downloads${downloadVisible ? ' is-visible' : ''}`}
        id="download"
        ref={downloadRef as React.RefObject<HTMLElement>}
      >
        <p className="landing-eyebrow landing-eyebrow--center">Take it to the hall</p>
        <h2 className="landing-center-heading">Download for your computer</h2>
        <p className="landing-section-lede landing-section-lede--center">
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
                          <a
                            className={rowClass}
                            href={opt.url!}
                            download
                            onClick={() =>
                              trackProductEvent({
                                name: 'download_click',
                                assetId: opt.id,
                                os: opt.platform,
                              })
                            }
                          >
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

      <section
        className={`landing-final-cta${ctaVisible ? ' is-visible' : ''}`}
        ref={ctaRef as React.RefObject<HTMLElement>}
      >
        <div className="landing-final-cta-glow" aria-hidden />
        <span className="landing-queen-lg" aria-hidden>
          ♕
        </span>
        <h2>Your next event doesn’t need a spreadsheet.</h2>
        <p>Set up your first tournament in the time it takes to brew a coffee.</p>
        <div className="landing-cta landing-cta--center">{appCta}</div>
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

/** Two pieces gliding together and connecting — a small visual pun on "pairing". */
function PairingGlyph() {
  return (
    <div className="landing-pairing-glyph">
      <span className="landing-pairing-piece landing-pairing-piece--a">♞</span>
      <span className="landing-pairing-piece landing-pairing-piece--b">♝</span>
      <svg className="landing-pairing-link" viewBox="0 0 200 60" aria-hidden>
        <path d="M20 30 H180" />
      </svg>
      <span className="landing-pairing-ring" />
    </div>
  );
}

/** Animated bracket: player nodes on the left pair off toward score-group lines on the right. */
function BracketDiagram({ animate }: { animate: boolean }) {
  const pairs: Array<[number, number]> = [
    [20, 40],
    [70, 90],
    [130, 150],
    [180, 200],
  ];
  return (
    <svg viewBox="0 0 260 220" className={`landing-bracket-svg${animate ? ' is-animating' : ''}`}>
      {pairs.map(([y1, y2], i) => (
        <g key={i}>
          <circle cx="18" cy={y1} r="5" className="landing-bracket-node" />
          <circle cx="18" cy={y2} r="5" className="landing-bracket-node" />
          <path
            d={`M23 ${y1} C 90 ${y1}, 90 ${(y1 + y2) / 2}, 130 ${(y1 + y2) / 2}`}
            className="landing-bracket-line"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
          <path
            d={`M23 ${y2} C 90 ${y2}, 90 ${(y1 + y2) / 2}, 130 ${(y1 + y2) / 2}`}
            className="landing-bracket-line"
            style={{ animationDelay: `${i * 0.18 + 0.06}s` }}
          />
          <circle
            cx="140"
            cy={(y1 + y2) / 2}
            r="6"
            className="landing-bracket-board"
            style={{ animationDelay: `${i * 0.18 + 0.3}s` }}
          />
        </g>
      ))}
    </svg>
  );
}
