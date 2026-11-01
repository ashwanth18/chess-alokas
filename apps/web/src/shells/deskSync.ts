import { createContext, useContext } from 'react';
// Type-only: this file is imported by shared chrome, so it must never pull in Dexie or the sync code.
import type { ShownRejection } from '../sync/sync';

/** The desk's sync state. Provided by OrganizerShell, so it is null everywhere else. */
export type DeskSync = {
  /** Can the API be reached? */
  online: boolean;
  syncing: boolean;
  /** Short message from the last manual sync, or its error. */
  message: string | null;
  failed: boolean;
  lastSync: string | null;
  /** Changes the cloud refused. They stay on this device and retry at every sync. */
  rejections: ShownRejection[];
  /** Local rows the cloud doesn't have yet, rejected ones included. Null until first counted. */
  pendingCount: number | null;
  sync: () => void;
};

export const DeskSyncContext = createContext<DeskSync | null>(null);

/** Null outside the desk: family, floor and hall pages have no local database and no sync. */
export function useDeskSync(): DeskSync | null {
  return useContext(DeskSyncContext);
}
