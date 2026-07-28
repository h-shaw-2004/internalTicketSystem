import { Component } from 'react';
import FullPageError from './FullPageError';

/**
 * Last line of defence. Without this, any throw during render unmounts the whole
 * tree and leaves a blank white page with the reason only in the console —
 * which is indistinguishable from a build or network failure.
 *
 * Has to be a class: there is still no hook equivalent of componentDidCatch.
 * Note it does NOT catch errors thrown in event handlers or async callbacks;
 * those are handled where they happen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReload = () => window.location.reload();
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keeps the stack somewhere findable once the UI has replaced the tree.
    console.error('Unhandled render error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <FullPageError
        title="Something went wrong"
        message="The page could not be displayed. Reloading usually clears it."
        detail={import.meta.env.DEV ? String(error?.message ?? error) : null}
        onRetry={this.handleReload}
        retryLabel="Reload"
      />
    );
  }
}
