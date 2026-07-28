/**
 * Renders the loading, empty and error states of a `useAsync` result so no list
 * has to remember all three.
 *
 * `empty` is a required prop rather than an optional one: forgetting the empty
 * state is the failure this whole pattern exists to prevent, so it has to be an
 * explicit decision at every call site.
 */
export default function AsyncBoundary({
  state,
  empty,
  children,
  loadingLabel = 'Loading…',
}) {
  const { status, data, error, retry } = state;

  if (status === 'idle') return null;

  if (status === 'loading') {
    return (
      <p className="async-loading" role="status">
        {loadingLabel}
      </p>
    );
  }

  if (status === 'error') {
    return (
      <div className="async-error">
        <p className="alert" role="alert">
          {error?.message ?? 'Something went wrong.'}
        </p>
        <button className="button button-ghost" type="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }

  if (status === 'empty') return empty;

  return children(data);
}
