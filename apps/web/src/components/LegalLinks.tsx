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

/** The required tick for a player who is, or may be, under 18. The server enforces it too. */
export function GuardianConsentField({
  checked,
  onChange,
  ageKnown,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** False when no age was given, so the box applies only if the player is in fact under 18. */
  ageKnown: boolean;
}) {
  return (
    <label className="late-confirm" data-testid="guardian-consent">
      <input
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />{' '}
      <span>
        {ageKnown ? '' : 'If this player is under 18: '}I am the parent or guardian, or have their
        permission, and consent to these details being used as described in the <PrivacyLink />.
      </span>
    </label>
  );
}
