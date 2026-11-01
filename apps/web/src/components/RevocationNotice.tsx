import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { useAuth } from '../auth/AuthContext';
import { db } from '../db/local';
import { TOURNAMENTS_REVOKED_EVENT, revocationNoticeKey } from '../sync/revocation';
import { noticeMessages, type RevocationNoticeData } from '../sync/revocationPlan';

/** Stored, not just shown, so a reload or a sync with no screen open can't lose it. Per account. */
export default function RevocationNotice() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const [notice, setNotice] = useState<RevocationNoticeData | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // The tournament page would otherwise wait forever for a row that is gone.
  useEffect(() => {
    const onRevoked = (e: Event) => {
      const removed = (e as CustomEvent<string[]>).detail;
      if (removed.some((id) => pathname.startsWith(`/tournaments/${id}`))) {
        navigate('/app', { replace: true });
      }
    };
    window.addEventListener(TOURNAMENTS_REVOKED_EVENT, onRevoked);
    return () => window.removeEventListener(TOURNAMENTS_REVOKED_EVENT, onRevoked);
  }, [pathname, navigate]);

  useEffect(() => {
    if (!userId) {
      setNotice(null);
      return;
    }
    const sub = liveQuery(() => db.meta.get(revocationNoticeKey(userId))).subscribe({
      next(row) {
        try {
          setNotice(row ? (JSON.parse(row.value) as RevocationNoticeData) : null);
        } catch {
          setNotice(null);
        }
      },
      error: (err) => console.warn('[sync] could not read the access notice', err),
    });
    return () => sub.unsubscribe();
  }, [userId]);

  if (!notice || !userId) return null;
  const messages = noticeMessages(notice);
  if (messages.length === 0) return null;

  return (
    // Fixed: this renders above the page, and someone may be scrolled far down a tournament.
    <div
      className="sync-rejections"
      role="alert"
      data-testid="revocation-notice"
      style={{
        position: 'fixed',
        left: '1rem',
        right: '1rem',
        bottom: '1rem',
        zIndex: 1000,
        maxWidth: '44rem',
        margin: '0 auto',
        background: '#3a1512',
        color: '#fff',
      }}
    >
      <strong>Your access changed</strong>
      <ul>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => void db.meta.delete(revocationNoticeKey(userId))}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
