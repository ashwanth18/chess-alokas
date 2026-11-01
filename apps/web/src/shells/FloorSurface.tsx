import { Outlet } from 'react-router-dom';

/**
 * Floor: `/t/:slug`. One purpose, thumb first. No nav and no account: the arbiter session and its own
 * offline queue live in the page (localStorage key `alokas-floor-offline-queue`), never in Dexie.
 *
 * The rebuilt page wraps itself in `<Surface name="floor">`, which gives 44 px minimum controls.
 */
export default function FloorSurface() {
  return <Outlet />;
}
