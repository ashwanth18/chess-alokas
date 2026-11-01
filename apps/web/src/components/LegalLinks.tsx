import { Link } from 'react-router-dom';

const isDesktop = () =>
  Boolean(typeof window !== 'undefined' && window.desktop?.isDesktop) ||
  import.meta.env.VITE_DESKTOP === '1';

/**
 * Router links, so they work under the desktop app's HashRouter as well as on the web.
 * In a form, the link opens a new tab so nothing typed is lost. The desktop app refuses new windows
 * for its own pages, so there it stays in the same window.
 */
export function PrivacyLink({ children = 'Privacy Policy' }: { children?: string }) {
  return (
    <Link to="/privacy" target={isDesktop() ? undefined : '_blank'} rel="noreferrer">
      {children}
    </Link>
  );
}

export function TermsLink({ children = 'Terms' }: { children?: string }) {
  return (
    <Link to="/terms" target={isDesktop() ? undefined : '_blank'} rel="noreferrer">
      {children}
    </Link>
  );
}

export function SignupAgreement() {
  return (
    <p className="form-hint" data-testid="signup-agreement">
      By creating an account you agree to the <TermsLink /> and <PrivacyLink />.
    </p>
  );
}

/** Shown by the submit button. Submitting is the acceptance, which the server records. */
export function GuardianConsentNotice() {
  return (
    <p className="form-hint" data-testid="guardian-consent-notice">
      By submitting, you confirm you’re the parent or guardian, or have their permission, and agree to
      our <PrivacyLink />.
    </p>
  );
}

export function RosterConsentNotice() {
  return (
    <p className="form-hint" data-testid="roster-consent-notice">
      By importing, you confirm you have permission to upload these players’ details, including a
      parent or guardian’s consent for anyone under 18, and agree to our <PrivacyLink />.
    </p>
  );
}
