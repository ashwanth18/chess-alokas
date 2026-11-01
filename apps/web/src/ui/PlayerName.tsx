import { useLayoutEffect, useMemo, useRef } from 'react';
import { MIN_STRETCH, nameParts, stretchToFit } from './names';

/**
 * The only way to show a player's name. It never truncates. To fit, it narrows along Archivo's width
 * axis from 100% to 62%, then wraps at the patronym, and it never reduces the font size.
 *
 * Give it a container with a definite width, such as a `table-layout: fixed` cell or a grid track.
 * In a shrink-to-fit parent there is nothing to fit against, and it just stays at 100%.
 */
export type PlayerNameProps = {
  /** The name as stored. Display casing happens here, and the stored value is never changed. */
  name: string;
  /** `formatDisambiguator({ no, section })`. Show it when `findLookalikes` flags this player. */
  disambiguator?: string | null;
  /** Off for places with room to spare, such as a hero line. */
  fit?: boolean;
  className?: string;
};

/* A table can hold hundreds of names, so they share one observer and one read-then-write pass. */
const dirty = new Set<HTMLElement>();
let frame = 0;
let observer: ResizeObserver | null = null;

function fitAll() {
  frame = 0;
  const items = [...dirty].filter((el) => el.isConnected);
  dirty.clear();
  // Write everything to the measuring state, then read, then write: one layout, not one per name.
  for (const el of items) {
    el.classList.add('is-measuring');
    el.classList.remove('is-wrapped');
    el.style.removeProperty('font-stretch');
  }
  const measured = items.map((el) => {
    const given = el.querySelector<HTMLElement>('.ui-name__given');
    const rest = el.querySelector<HTMLElement>('.ui-name__rest');
    const line = el.querySelector<HTMLElement>('.ui-name__line');
    return {
      el,
      available: el.clientWidth,
      natural: line?.getBoundingClientRect().width ?? 0,
      longestPart: Math.max(given?.getBoundingClientRect().width ?? 0, rest?.getBoundingClientRect().width ?? 0),
      hasRest: Boolean(rest),
    };
  });
  for (const { el, available, natural, longestPart, hasRest } of measured) {
    el.classList.remove('is-measuring');
    if (available <= 0) continue;
    const oneLine = stretchToFit(natural, available);
    if (oneLine != null) {
      if (oneLine < 100) el.style.setProperty('font-stretch', `${oneLine}%`);
      continue;
    }
    // Too long for one line even at 62%: break at the patronym, narrowing only as much as still needed.
    if (hasRest) el.classList.add('is-wrapped');
    const parts = stretchToFit(hasRest ? longestPart : natural, available);
    el.style.setProperty('font-stretch', `${parts ?? MIN_STRETCH}%`);
  }
}

function schedule(el: HTMLElement) {
  dirty.add(el);
  if (!frame) frame = requestAnimationFrame(fitAll);
}

function watch(el: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) schedule(entry.target as HTMLElement);
    });
    // Widths change once Archivo has loaded, so measure again then.
    void document.fonts?.ready.then(() => {
      document.querySelectorAll<HTMLElement>('.ui-name[data-fit]').forEach(schedule);
    });
  }
  const current = observer;
  current.observe(el);
  return () => {
    current.unobserve(el);
    dirty.delete(el);
  };
}

export function PlayerName({ name, disambiguator, fit = true, className }: PlayerNameProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const parts = useMemo(() => nameParts(name), [name]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fit) return;
    const stop = watch(el);
    schedule(el);
    return stop;
  }, [fit, parts.display]);

  return (
    <span ref={ref} className={`ui-name${className ? ` ${className}` : ''}`} data-fit={fit ? '' : undefined}>
      <span className="ui-name__line">
        <span className="ui-name__given">{parts.given}</span>
        {parts.rest && (
          <>
            {' '}
            <span className="ui-name__rest">{parts.rest}</span>
          </>
        )}
      </span>
      {disambiguator ? <span className="ui-name__dis">{disambiguator}</span> : null}
    </span>
  );
}
