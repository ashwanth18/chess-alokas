import { useEffect, type ReactNode } from 'react';

export type SurfaceName = 'desk' | 'family' | 'floor' | 'hall';
export type SurfaceTheme = 'light' | 'dark' | 'sun' | 'tv';

/**
 * The root of every new page. It marks `<html>` so the shell layer repaints the green legacy body, sets
 * density for the surface, and undoes index.css's global type inside `.ui-root`. Undone on unmount, so
 * moving back to a legacy page restores it. Without a `theme`, the page follows the system light or dark.
 */
export function Surface({
  name,
  theme,
  density,
  children,
}: {
  name: SurfaceName;
  theme?: SurfaceTheme;
  density?: 'roomy';
  children: ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = name;
    if (theme) root.dataset.theme = theme;
    if (density) root.dataset.density = density;
    return () => {
      delete root.dataset.surface;
      delete root.dataset.theme;
      delete root.dataset.density;
    };
  }, [name, theme, density]);

  return <div className="ui-root ui-surface">{children}</div>;
}
