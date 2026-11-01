import { Link } from 'react-router-dom';
import { BrandCrown } from '../ui/BrandCrown';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** Shared chrome for login/signup/reset — always offers a clear path home. */
export default function AuthShell({ title, subtitle, children }: AuthShellProps) {
  const isDesktop =
    typeof window !== 'undefined' &&
    (Boolean(window.desktop?.isDesktop) || import.meta.env.VITE_DESKTOP === '1');
  const homeTo = isDesktop ? '/login' : '/';
  return (
    <div className="auth-page">
      <div className="auth-frame">
        <div className="auth-topbar">
          {!isDesktop ? (
            <Link to="/" className="auth-home-link">
              <span aria-hidden>←</span> Home
            </Link>
          ) : (
            <span className="auth-top-spacer" aria-hidden />
          )}
          <Link to={homeTo} className="auth-top-brand" title="Chess Alokas">
            <span className="landing-queen" aria-hidden>
              <BrandCrown />
            </span>
            Chess Alokas
          </Link>
          <span className="auth-top-spacer" aria-hidden />
        </div>

        <div className="auth-card">
          <div className="auth-brand">
            <Link to={homeTo} className="auth-brand-mark" aria-label="Chess Alokas">
              <span className="brand-knight" aria-hidden>
                <BrandCrown />
              </span>
            </Link>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
