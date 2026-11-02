import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ACCOUNT_CHANGED_EVENT,
  apiGetMe,
  apiListOrganizations,
  apiListPlayerProfiles,
  type UserOrganization,
} from '../api/client';
import { useAuth } from './AuthContext';
import { isDesktop, isOrganizer, type WorkspaceFacts, type WorkspaceView } from './workspace';

const FACTS_KEY = 'alokas:workspace';
const VIEW_KEY = 'alokas:view';
/** Landing never waits longer than this on a slow connection: the desk has to open at the venue. */
const LANDING_WAIT_MS = 5_000;

function readFacts(userId: string): WorkspaceFacts | null {
  try {
    const raw = localStorage.getItem(FACTS_KEY);
    const saved = raw ? (JSON.parse(raw) as { userId?: string; facts?: WorkspaceFacts }) : null;
    return saved?.userId === userId && saved.facts ? saved.facts : null;
  } catch {
    return null;
  }
}

function writeFacts(userId: string, facts: WorkspaceFacts) {
  try {
    localStorage.setItem(FACTS_KEY, JSON.stringify({ userId, facts }));
  } catch {
    /* Private window: the API is asked again next time. */
  }
}

function readView(userId: string | null): WorkspaceView | null {
  if (!userId) return null;
  try {
    const saved = localStorage.getItem(`${VIEW_KEY}:${userId}`);
    return saved === 'player' || saved === 'organizer' ? saved : null;
  } catch {
    return null;
  }
}

interface WorkspaceValue {
  /** This device's last answer until the API gives a new one. Null if it has never answered. */
  facts: WorkspaceFacts | null;
  /** Null until the API answers on this visit. Offline, "none yet" would be a false claim. */
  organizations: UserOrganization[] | null;
  /** Landing has to wait: the answer could send this person somewhere else. */
  resolving: boolean;
  preferredView: WorkspaceView | null;
  chooseView: (view: WorkspaceView) => void;
  refresh: () => Promise<void>;
  /** Called by useWorkspace, so pages that never ask (the floor, the hall) cost no requests. */
  start: () => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

type Loaded = {
  userId: string | null;
  facts: WorkspaceFacts | null;
  organizations: UserOrganization[] | null;
  settled: boolean;
};

const NOTHING: Loaded = { userId: null, facts: null, organizations: null, settled: false };

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const hasSession = Boolean(auth.session);
  const [loaded, setLoaded] = useState<Loaded>(NOTHING);
  const [views, setViews] = useState<Record<string, WorkspaceView>>({});
  const wanted = useRef(false);
  const latestRun = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const currentUser = useRef(userId);
  currentUser.current = userId;

  const load = useCallback((uid: string) => {
    const run = ++latestRun.current;
    const known = readFacts(uid);
    setLoaded((prev) =>
      prev.userId === uid
        ? { ...prev, settled: false }
        : { userId: uid, facts: known, organizations: null, settled: false },
    );
    const cap = window.setTimeout(() => {
      if (latestRun.current === run) setLoaded((prev) => ({ ...prev, settled: true }));
    }, LANDING_WAIT_MS);

    const finished = Promise.all([apiListOrganizations(), apiGetMe(), apiListPlayerProfiles()]).then(
      ([orgs, me, profiles]) => {
        window.clearTimeout(cap);
        if (latestRun.current !== run) return;
        inFlight.current = null;
        if (!orgs.ok) {
          setLoaded((prev) => ({ ...prev, settled: true }));
          return;
        }
        const facts: WorkspaceFacts = {
          memberRoles: orgs.data.organizations.map((o) => o.memberRole),
          accountRole: me.ok ? (me.data.accountRole ?? null) : (known?.accountRole ?? null),
          hasPlayerProfile: profiles.ok ? profiles.data.profiles.length > 0 : (known?.hasPlayerProfile ?? false),
        };
        writeFacts(uid, facts);
        setLoaded({ userId: uid, facts, organizations: orgs.data.organizations, settled: true });
      },
    );
    inFlight.current = finished;
    return finished;
  }, []);

  useEffect(() => {
    if (!userId) {
      latestRun.current += 1;
      inFlight.current = null;
      setLoaded(NOTHING);
      return;
    }
    // hasSession: coming back online turns a saved sign-in into a real one, and the API can answer.
    if (wanted.current) void load(userId);
  }, [userId, hasSession, load]);

  useEffect(() => {
    const onChanged = () => {
      if (wanted.current && currentUser.current) void load(currentUser.current);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
  }, [load]);

  const start = useCallback(() => {
    if (wanted.current) return;
    wanted.current = true;
    if (currentUser.current) void load(currentUser.current);
  }, [load]);

  const refresh = useCallback(async () => {
    if (!currentUser.current) return;
    await (inFlight.current ?? load(currentUser.current));
  }, [load]);

  const chooseView = useCallback((view: WorkspaceView) => {
    const uid = currentUser.current;
    if (!uid) return;
    setViews((prev) => ({ ...prev, [uid]: view }));
    try {
      localStorage.setItem(`${VIEW_KEY}:${uid}`, view);
    } catch {
      /* Private window: the choice lasts this visit. */
    }
  }, []);

  const value = useMemo<WorkspaceValue>(() => {
    const mine = loaded.userId === userId ? loaded : { ...NOTHING, userId };
    // An organizer's desk opens straight away and checks in the background. A redirect is what must
    // wait, so someone who just became an organizer isn't bounced on old news. Desktop never bounces.
    const confident = mine.facts !== null && (isDesktop || isOrganizer(mine.facts));
    return {
      facts: mine.facts,
      organizations: mine.organizations,
      resolving: !mine.settled && !confident,
      preferredView: userId ? (views[userId] ?? readView(userId)) : null,
      chooseView,
      refresh,
      start,
    };
  }, [loaded, userId, views, chooseView, refresh, start]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Omit<WorkspaceValue, 'start'> {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  const { start } = ctx;
  useEffect(() => start(), [start]);
  return ctx;
}
