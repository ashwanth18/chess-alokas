import { Outlet } from 'react-router-dom';

/**
 * Family: `/`, `/discover`, `/register/:slug`, `/live/:token`, `/live/:token/p/:id`, `/player`,
 * `/invite/:token`, and sign-in. Warm, roomy, sentences. No Dexie and no sync, ever:
 * e2e/shells.spec.ts fails if one of these routes requests that code.
 *
 * New pages inside it wrap themselves in `<Surface name="family">` from src/ui/Surface.
 */
export default function ParticipantShell() {
  return <Outlet />;
}
