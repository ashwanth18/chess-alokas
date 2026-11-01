/**
 * What `StatusLine` says, as a pure function of separate facts (DESIGN_PLAN section 2, "Offline and
 * sync: honest and calm"). Three questions, always in this order:
 *   1. Where is my work?     2. Who else has it?     3. Who is affected?
 *
 * Rules enforced here and pinned by tests:
 * - Never "Online" on its own. Never "Synced" while anything is outstanding or rejected.
 * - Offline is amber with a hollow marker, never red. Red is only for what needs a person.
 * - Solid marker means delivered. Hollow marker means on this device.
 */

export type SyncFacts = {
  /** Which words to use for this machine. */
  device: 'laptop' | 'phone' | 'device';
  /** Can we reach the API right now? Null while we don't know yet. */
  connected: boolean | null;
  /** A sync is running now. */
  syncing?: boolean;
  /** Local changes the cloud doesn't have yet, rejections included. */
  pending: number;
  /** Changes the cloud refused. Each one needs a person. */
  rejected: number;
  /** Last sync attempt failed, with no rejections to explain it. */
  failed?: boolean;
  /** ISO time of the last sync that delivered everything. */
  cloudAsOf: string | null;
  /** What this page affects. Off for a device with no floor or parents depending on it. */
  showAudience?: boolean;
};

export type SyncTone = 'go' | 'wait' | 'flag' | 'plain';

export type SyncLine = {
  key: 'where' | 'cloud' | 'audience';
  text: string;
  tone: SyncTone;
  /** solid = delivered, hollow = only on this device, none = no marker. */
  marker: 'solid' | 'hollow' | 'none';
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function describeSync(facts: SyncFacts): SyncLine[] {
  const { device, connected, pending, rejected, cloudAsOf } = facts;
  const asOf = cloudAsOf ? formatClock(cloudAsOf) : null;
  const lines: SyncLine[] = [
    // True offline too, and always first: this is what a director checks before anything else.
    { key: 'where', text: `Everything saved on this ${device}`, tone: 'go', marker: 'solid' },
  ];

  const waiting = pending - rejected;

  if (rejected > 0) {
    lines.push({
      key: 'cloud',
      text: `${plural(rejected, 'change')} refused by the cloud. Needs you.`,
      tone: 'flag',
      marker: 'hollow',
    });
  } else if (connected === false) {
    lines.push({
      key: 'cloud',
      text:
        waiting > 0
          ? `No connection. ${plural(waiting, 'change')} will go to the cloud when it returns.`
          : asOf
            ? `No connection. Cloud had everything as of ${asOf}.`
            : 'No connection.',
      tone: 'wait',
      marker: 'hollow',
    });
  } else if (facts.syncing) {
    lines.push({ key: 'cloud', text: 'Sending to the cloud…', tone: 'wait', marker: 'hollow' });
  } else if (facts.failed) {
    lines.push({
      key: 'cloud',
      text:
        waiting > 0
          ? `Could not reach the cloud. ${plural(waiting, 'change')} will try again.`
          : 'Could not reach the cloud. It will try again.',
      tone: 'wait',
      marker: 'hollow',
    });
  } else if (waiting > 0) {
    lines.push({
      key: 'cloud',
      text: `${plural(waiting, 'change')} waiting to go to the cloud.`,
      tone: 'wait',
      marker: 'hollow',
    });
  } else if (asOf) {
    lines.push({ key: 'cloud', text: `Cloud has everything, as of ${asOf}.`, tone: 'go', marker: 'solid' });
  } else {
    lines.push({ key: 'cloud', text: 'Not sent to the cloud yet.', tone: 'plain', marker: 'hollow' });
  }

  const behind = rejected > 0 || waiting > 0 || connected === false || facts.failed === true;
  if (facts.showAudience && behind) {
    lines.push({
      key: 'audience',
      text: asOf
        ? `Floor phones keep their own results until then. The parents' page stays at ${asOf}.`
        : "Floor phones keep their own results until then. The parents' page doesn't have this yet.",
      tone: 'plain',
      marker: 'none',
    });
  }

  return lines;
}

/** Used on parent and hall pages, which always show how old their data is and never blank out. */
export function describeAsOf(asOf: string | null, connected: boolean | null): string {
  const time = asOf ? formatClock(asOf) : null;
  if (connected === false) return time ? `No connection. Showing the list as of ${time}.` : 'No connection.';
  return time ? `As of ${time}` : '';
}
