import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trackProductEvent } from '../../lib/productTelemetry';

type PlatformKey = 'windows' | 'macos' | 'linux';
type OptionId = 'win-setup' | 'win-portable' | 'mac-arm64' | 'mac-x64' | 'linux-appimage';

const RELEASES_API =
  import.meta.env.VITE_GITHUB_RELEASES_API ??
  'https://api.github.com/repos/ashwanth18/chess-alokas/releases/latest';

const RELEASE_BASE =
  import.meta.env.VITE_DOWNLOAD_RELEASE_BASE ??
  'https://github.com/ashwanth18/chess-alokas/releases/latest/download';

const RELEASES_PAGE = 'https://github.com/ashwanth18/chess-alokas/releases/latest';

interface DownloadOption {
  id: OptionId;
  platform: PlatformKey;
  label: string;
  detail: string;
  /** Used when the GitHub API is unavailable. File names must match deploy/PIPELINE.md. */
  fallbackUrl: string;
  match: (assetName: string) => boolean;
}

const OPTIONS: DownloadOption[] = [
  {
    id: 'win-setup',
    platform: 'windows',
    label: 'Installer',
    detail: 'Windows 10 or 11, 64-bit. Offers in-app updates.',
    fallbackUrl: `${RELEASE_BASE}/Chess-Alokas-Setup-win-x64.exe`,
    match: (n) => n.includes('setup') && n.includes('win') && n.endsWith('.exe'),
  },
  {
    id: 'win-portable',
    platform: 'windows',
    label: 'Portable',
    detail: 'No install. Run it from a folder.',
    fallbackUrl: `${RELEASE_BASE}/Chess-Alokas-Portable-win-x64.exe`,
    match: (n) => n.includes('portable') && n.includes('win') && n.endsWith('.exe'),
  },
  {
    id: 'mac-arm64',
    platform: 'macos',
    label: 'Apple Silicon',
    detail: 'M-series Macs. FIDE Dutch pairing needs a connection.',
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
    detail: 'Intel Macs. FIDE Dutch pairing needs a connection.',
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
    detail: 'Most distributions, x86_64. Offers in-app updates.',
    fallbackUrl: `${RELEASE_BASE}/Chess-Alokas-linux-x86_64.AppImage`,
    match: (n) => n.endsWith('.appimage') && !n.includes('blockmap'),
  },
];

const PLATFORMS: { key: PlatformKey; label: string }[] = [
  { key: 'windows', label: 'Windows' },
  { key: 'macos', label: 'macOS' },
  { key: 'linux', label: 'Linux' },
];

type Hints = { platform: PlatformKey | null; preferArm: boolean };

function detectClient(): Hints {
  if (typeof navigator === 'undefined') return { platform: null, preferArm: false };
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() ?? '';
  const arch = (
    navigator as Navigator & { userAgentData?: { architecture?: string } }
  ).userAgentData?.architecture?.toLowerCase();
  const preferArm = arch === 'arm' || ua.includes('arm64') || ua.includes('aarch64');
  if (ua.includes('win')) return { platform: 'windows', preferArm: false };
  if (ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
    return { platform: null, preferArm: false };
  }
  if (ua.includes('linux')) return { platform: 'linux', preferArm };
  if (ua.includes('mac') || platform.includes('mac')) {
    // Most Mac browsers still report "MacIntel"; default to Apple Silicon when unknown.
    return { platform: 'macos', preferArm: arch ? preferArm : true };
  }
  return { platform: null, preferArm: false };
}

function isRecommended(id: OptionId, hints: Hints): boolean {
  if (id === 'win-setup') return hints.platform === 'windows';
  if (id === 'linux-appimage') return hints.platform === 'linux';
  if (id === 'mac-arm64') return hints.platform === 'macos' && hints.preferArm;
  if (id === 'mac-x64') return hints.platform === 'macos' && !hints.preferArm;
  return false;
}

type LookupState = 'checking' | 'ok' | 'failed';

export default function Downloads() {
  const hints = useMemo(detectClient, []);
  const [urls, setUrls] = useState<Partial<Record<OptionId, string>>>({});
  const [tag, setTag] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupState>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) {
          if (!cancelled) setLookup('failed');
          return;
        }
        const body = (await res.json()) as {
          tag_name?: string;
          assets?: { name: string; browser_download_url: string }[];
        };
        if (cancelled) return;
        const assets = body.assets ?? [];
        const next: Partial<Record<OptionId, string>> = {};
        for (const def of OPTIONS) {
          const hit = assets.find((a) => def.match(a.name.toLowerCase()));
          if (hit) next[def.id] = hit.browser_download_url;
        }
        setUrls(next);
        setTag(body.tag_name ?? null);
        setLookup('ok');
      } catch {
        // Offline, rate-limited or blocked: the fallback links below still work when online.
        if (!cancelled) setLookup('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = useMemo(
    () =>
      [...PLATFORMS].sort(
        (a, b) => Number(b.key === hints.platform) - Number(a.key === hints.platform),
      ),
    [hints],
  );

  return (
    <section className="lp-band" id="download" aria-labelledby="lp-h-download">
      <div className="lp-wrap lp-split lp-split-5-7">
        <div>
          <h2 id="lp-h-download">A desktop app for the hall.</h2>
          <p className="lp-lede">
            The same tournament and the same account as the website, in its own window. On Windows
            and Linux it carries bbpPairings, so FIDE Dutch rounds pair without a connection. It
            also keeps automatic local backups.
          </p>
          <p className="lp-small" role="status">
            {lookup === 'checking' && 'Checking the latest release.'}
            {lookup === 'ok' && (tag ? `Latest release: ${tag}.` : 'Latest release.')}
            {lookup === 'failed' && (
              <>
                Could not check the latest release just now. These links still point to it, or open
                the <a href={RELEASES_PAGE}>releases page</a>.
              </>
            )}
          </p>
        </div>
        <div>
          {ordered.map((p) => (
            <div key={p.key} className="lp-dl-os">
              <h3>
                {p.label}
                {p.key === hints.platform ? <span className="lp-dl-you">Your system</span> : null}
              </h3>
              <ul className="lp-dl-list">
                {OPTIONS.filter((o) => o.platform === p.key).map((opt) => (
                  <li key={opt.id}>
                    <a
                      className="lp-dl"
                      href={urls[opt.id] ?? opt.fallbackUrl}
                      download
                      onClick={() =>
                        trackProductEvent({
                          name: 'download_click',
                          assetId: opt.id,
                          os: opt.platform,
                        })
                      }
                    >
                      <span className="lp-dl-text">
                        <span className="lp-dl-label">
                          {opt.label}
                          {isRecommended(opt.id, hints) ? (
                            <span className="lp-dl-rec">Recommended</span>
                          ) : null}
                        </span>
                        <span className="lp-dl-detail">{opt.detail}</span>
                      </span>
                      <span className="lp-dl-cta">Download</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="lp-small">
            The builds are not code-signed yet. On Windows, SmartScreen may warn on first run:
            choose More info, then Run anyway. On a Mac, if the app is blocked the first time, go to
            Finder, right-click the app and choose Open.
          </p>
          <p className="lp-small">
            Prefer the browser? <Link to="/signup">Create an account</Link> and run everything at
            chess-manager.alokas.com with nothing to install.
          </p>
        </div>
      </div>
    </section>
  );
}
