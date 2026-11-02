import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../auth/WorkspaceContext';
import { isDesktop, workspaceLinks, type MenuPlace } from '../auth/workspace';
import { IconChevronDown } from '../ui/icons';

/** The links and Sign out. The same list in the drop-down and in the phone menu. */
export function AccountMenuItems({ place, onChoose }: { place: MenuPlace; onChoose?: () => void }) {
  const auth = useAuth();
  const workspace = useWorkspace();
  const links = workspaceLinks(workspace.facts, { desktop: isDesktop, place });
  return (
    <>
      {links.map((link) => (
        <Link
          key={link.id}
          to={link.to}
          className="am-item"
          onClick={() => {
            if (link.remember) workspace.chooseView(link.remember);
            onChoose?.();
          }}
        >
          {link.label}
        </Link>
      ))}
      <Link to="/account" className="am-item" onClick={onChoose}>
        Account
      </Link>
      <Link to="/settings" className="am-item" onClick={onChoose}>
        Settings
      </Link>
      <button
        type="button"
        className="am-item"
        onClick={() => {
          onChoose?.();
          void auth.signOut('local');
        }}
      >
        Sign out
      </button>
    </>
  );
}

/** `collapses`: the top bar's phone menu takes over below its breakpoint. */
export default function AccountMenu({ place, collapses = false }: { place: MenuPlace; collapses?: boolean }) {
  const auth = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`am${collapses ? ' am-collapses' : ''}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="am-button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        Account
        <IconChevronDown size={16} />
      </button>
      {open && (
        <div className="am-panel" id={panelId}>
          <p className="am-who">
            {auth.displayName && <strong>{auth.displayName}</strong>}
            <span>{auth.user?.email}</span>
          </p>
          <AccountMenuItems place={place} onChoose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
