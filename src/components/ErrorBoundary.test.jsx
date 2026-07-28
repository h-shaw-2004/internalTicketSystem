import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

function Boom() {
  throw new Error('render exploded');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error itself; silenced so a passing run stays clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes children through when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('all fine')).toBeInTheDocument();
  });

  it('replaces a blank page with a real screen when a render throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('keeps the underlying error findable in the console', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(console.error).toHaveBeenCalledWith(
      'Unhandled render error:',
      expect.objectContaining({ message: 'render exploded' }),
      expect.anything()
    );
  });
});
