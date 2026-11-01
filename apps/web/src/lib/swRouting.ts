export type SwRoute = 'passthrough' | 'navigate' | 'asset';

/**
 * Decides what the service worker may touch. Everything that can carry personal or authenticated
 * data goes straight to the network: other origins (Supabase, Sentry), non-GET requests, requests
 * with credentials in headers, and anything under /api. The 2026-08 incident was a worker
 * intercepting /api and failing Sync with "Failed to fetch", so those are never answered here.
 */
export function classifyRequest(input: {
  url: string;
  origin: string;
  method: string;
  mode: string;
  hasAuthHeader?: boolean;
}): SwRoute {
  if (input.method !== 'GET' || input.hasAuthHeader) return 'passthrough';
  const url = new URL(input.url);
  if (url.origin !== input.origin) return 'passthrough';
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return 'passthrough';
  if (input.mode === 'navigate') return 'navigate';
  if (url.pathname.startsWith('/assets/')) return 'asset';
  return 'passthrough';
}
