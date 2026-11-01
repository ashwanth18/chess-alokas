/** Parameters that can place a person or say what they looked for. */
const SENSITIVE_PARAMS = new Set(['lat', 'lng', 'latitude', 'longitude', 'search', 'q', 'query']);

/** Path segments that act as credentials: anyone holding one can open the page. */
const SECRET_PATH = /\/(live|tables|t|invite)\/[^/?#]+/g;

/** A path with its link secrets replaced. Keeps the rest, so it can still be grouped and read. */
export function redactPath(path: string): string {
  return path.replace(SECRET_PATH, '/$1/[redacted]');
}

/** For page statistics: no query string or fragment at all, and no link secrets. */
export function redactPagePath(path: string): string {
  return redactPath(path.replace(/[?#].*$/, ''));
}

/** For logs and error reports. Other parameters stay, as they help diagnose a failed request. */
export function redactUrl(url: string): string {
  const mark = url.indexOf('?');
  if (mark < 0) return redactPath(url);
  const kept = url
    .slice(mark + 1)
    .split('&')
    .map((pair) => {
      const name = decodeName(pair.split('=', 1)[0] ?? '');
      return SENSITIVE_PARAMS.has(name.toLowerCase()) ? `${name}=[redacted]` : pair;
    })
    .join('&');
  return `${redactPath(url.slice(0, mark))}?${kept}`;
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Fastify's logger options. Without the `req` serializer, the full URL is written to the log. */
export function apiLoggerOptions() {
  return {
    serializers: {
      req(request: {
        method: string;
        url: string;
        host?: string;
        ip?: string;
        socket?: { remotePort?: number };
      }) {
        return {
          method: request.method,
          url: redactUrl(request.url),
          host: request.host,
          remoteAddress: request.ip,
          remotePort: request.socket?.remotePort,
        };
      },
    },
  };
}
