/**
 * The only place the browser talks to the network.
 *
 * The session lives in an httpOnly cookie the browser attaches itself, so
 * nothing here handles tokens — there is no token for JavaScript to read, which
 * is the point.
 */

const BASE = '/api';

export class HttpError extends Error {
  constructor(message, { field = null, status = 0 } = {}) {
    super(message);
    this.name = 'HttpError';
    this.field = field;
    this.status = status;
  }
}

/**
 * Builds a request function that reports failures as `ErrorClass`, so each API
 * module keeps its own error type and the pages carry on reading `.message`
 * and `.field` exactly as before.
 */
export function createClient(ErrorClass) {
  return async function request(path, { method = 'GET', body } = {}) {
    let response;

    try {
      response = await fetch(`${BASE}${path}`, {
        method,
        // Sends the session cookie. Same-origin in dev via the Vite proxy.
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      // fetch only rejects when the request never completed.
      throw new ErrorClass('Could not reach the server. Please try again.');
    }

    if (response.status === 204) return null;

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new ErrorClass(payload?.error?.message ?? 'Something went wrong. Please try again.', {
        field: payload?.error?.field ?? null,
        status: response.status,
      });
    }

    return payload;
  };
}
