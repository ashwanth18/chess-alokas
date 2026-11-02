import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TITLES: [RegExp, string][] = [
  [/^\/app$/, 'Tournaments'],
  [/^\/player/, 'My page'],
  [/^\/tournaments\/new$/, 'New Tournament'],
  [/^\/tournaments\/[^/]+\/import$/, 'Import Players'],
  [/^\/tournaments\//, 'Tournament'],
  [/^\/certificates/, 'Certificates'],
  [/^\/simulator/, 'Simulator'],
  [/^\/account/, 'Account'],
  [/^\/settings/, 'Settings'],
  [/^\/team/, 'Team'],
  [/^\/invite\//, 'Team invite'],
  [/^\/admin/, 'Admin'],
  [/^\/login/, 'Sign in'],
  [/^\/signup/, 'Create account'],
  [/^\/discover/, 'Explore Events'],
  [/^\/register\//, 'Event Registration'],
  [/^\/t\//, 'Table Scoring'],
  [/^\/live\/[^/]+\/tv/, 'Venue TV'],
  [/^\/live\//, 'Live Pairings'],
];

/** Gives each screen its own browser-tab title, which is what screen readers announce first. */
export default function RouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const match = TITLES.find(([re]) => re.test(pathname));
    document.title = match ? `${match[1]} · Chess Alokas` : 'Chess Alokas';
  }, [pathname]);
  return null;
}
