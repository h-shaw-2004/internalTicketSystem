/**
 * Whole-screen failure state, for the cases where there is no useful page left
 * to render around the error: the session could not be resolved, the app is
 * misconfigured, or a render threw.
 *
 * `detail` is the raw message. It is only ever passed in development — a user
 * cannot act on it, and it tends to leak internals.
 */
export default function FullPageError({
  title,
  message,
  detail = null,
  onRetry = null,
  retryLabel = 'Try again',
}) {
  return (
    <div className="auth-layout">
      <div className="auth-card" role="alert">
        <header className="auth-header">
          <h1>{title}</h1>
        </header>

        <p className="error-message">{message}</p>

        {detail && <pre className="error-detail">{detail}</pre>}

        {onRetry && (
          <button className="button" type="button" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
