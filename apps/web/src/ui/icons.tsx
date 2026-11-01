/**
 * Icons copied from Lucide 0.460 (ISC License, Copyright (c) Lucide Contributors, https://lucide.dev)
 * so there is no runtime dependency. The mark and the two status squares are our own.
 * Decorative by default: put the meaning in text next to the icon, or pass `title`.
 */
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { title?: string; size?: number };

function icon(body: ReactNode) {
  return function Icon({ title, size = 16, ...rest }: IconProps) {
    return (
      <svg
        className="ui-icon"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        role={title ? 'img' : undefined}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        {...rest}
      >
        {body}
      </svg>
    );
  };
}

export const IconChevronRight = icon(<path d="m9 18 6-6-6-6" />);
export const IconChevronLeft = icon(<path d="m15 18-6-6 6-6" />);
export const IconChevronDown = icon(<path d="m6 9 6 6 6-6" />);
export const IconClose = icon(
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);
export const IconPrint = icon(
  <>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </>,
);
export const IconCheck = icon(<path d="M20 6 9 17l-5-5" />);
export const IconPlus = icon(
  <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </>,
);
export const IconSearch = icon(
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>,
);
export const IconUndo = icon(
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
  </>,
);
export const IconWifiOff = icon(
  <>
    <path d="M12 20h.01" />
    <path d="M8.5 16.429a5 5 0 0 1 7 0" />
    <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
    <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
    <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
    <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
    <path d="m2 2 20 20" />
  </>,
);
export const IconMenu = icon(
  <>
    <line x1="4" x2="20" y1="12" y2="12" />
    <line x1="4" x2="20" y1="6" y2="6" />
    <line x1="4" x2="20" y1="18" y2="18" />
  </>,
);
export const IconDownload = icon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </>,
);
export const IconQr = icon(
  <>
    <rect width="5" height="5" x="3" y="3" rx="1" />
    <rect width="5" height="5" x="16" y="3" rx="1" />
    <rect width="5" height="5" x="3" y="16" rx="1" />
    <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
    <path d="M21 21v.01" />
    <path d="M12 7v3a2 2 0 0 1-2 2H7" />
    <path d="M3 12h.01" />
    <path d="M12 3h.01" />
    <path d="M12 16v.01" />
    <path d="M16 12h1" />
    <path d="M21 12v.01" />
    <path d="M12 21v-1" />
  </>,
);
export const IconHelp = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </>,
);
export const IconAlert = icon(
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>,
);
export const IconSignOut = icon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" x2="9" y1="12" y2="12" />
  </>,
);

/** The brand mark: a split square. Replaces the old Unicode queen. */
export function Mark({ size = 16 }: { size?: number }) {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect x=".75" y=".75" width="14.5" height="14.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8" y="1" width="7" height="7" fill="currentColor" />
      <rect x="1" y="8" width="7" height="7" fill="currentColor" />
    </svg>
  );
}
