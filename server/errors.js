/**
 * Errors the client is allowed to see.
 *
 * `field` mirrors what the forms already expect, so an API validation failure
 * can highlight the offending input exactly as the old in-browser checks did.
 */
export class ApiError extends Error {
  constructor(status, message, field = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

export const badRequest = (message, field = null) => new ApiError(400, message, field);

export const unauthorised = (message = 'Your session has expired. Please sign in again.') =>
  new ApiError(401, message);

export const forbidden = (message = 'You do not have access to that.') =>
  new ApiError(403, message);

export const notFound = (message = 'That could not be found.') => new ApiError(404, message);

/**
 * Anything that isn't an ApiError is a bug, so it is logged in full and
 * reported to the client as a flat 500 — internals never cross the wire.
 */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: { message: error.message, field: error.field },
    });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, error);

  return res.status(500).json({
    error: { message: 'Something went wrong. Please try again.', field: null },
  });
}
