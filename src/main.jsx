import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import FullPageError from './components/FullPageError';
import { configError } from './lib/supabase';
import './index.css';

// A missing .env is a developer problem, not a user one, so it gets its own
// screen naming the fix rather than being funnelled through the generic
// boundary. Checked before <App /> because every page would fail identically.
const root = configError ? (
  <FullPageError
    title="Configuration problem"
    message="The app cannot reach its database because it has not been configured."
    detail={configError}
  />
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>{root}</ErrorBoundary>
  </React.StrictMode>
);
