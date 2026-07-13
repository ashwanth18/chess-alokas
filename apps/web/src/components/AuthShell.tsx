import { Link } from 'react-router-dom';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** Shared chrome for login/signup/reset — always offers a clear path home. */
export default function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className="auth-page">
      <div className="auth-frame">
        <div className="auth-topbar">
          <Link to="/" className="auth-home-link">
            <span aria-hidden>←</span> Home
          </Link>
          <Link to="/" className="auth-top-brand" title="Chess Alokas home">
            <span className="landing-queen" aria-hidden>
              ♕
            </span>
            Chess Alokas
          </Link>
          <span className="auth-top-spacer" aria-hidden />
        </div>

        <div className="auth-card">
          <div className="auth-brand">
            <Link to="/" className="auth-brand-mark" aria-label="Chess Alokas home">
              <span className="brand-knight" aria-hidden>
                ♕
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
