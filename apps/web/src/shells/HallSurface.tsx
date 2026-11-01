import { Outlet } from 'react-router-dom';

/**
 * Hall: `/live/:token/tv`. Read-only, no chrome, read from across a room.
 *
 * The rebuilt page wraps itself in `<Surface name="hall" theme="tv">`, which turns off page scrolling
 * and provides `--u`, the unit the whole stage scales from.
 */
export default function HallSurface() {
  return <Outlet />;
}
