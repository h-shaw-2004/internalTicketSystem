import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../../shared/roles.js';
import AppNav from './AppNav';

/**
 * The signed-in page header: title, who you are, page-specific actions, sign
 * out. Shared so the identity line and sign-out don't drift between pages.
 *
 * **This is the desktop design, unchanged.** The leading control and `AppNav`
 * are `display: none` above 900px, so nothing about the layout at desktop
 * widths differs from before the drawer existed.
 *
 * `backTo` marks a page as a sub-page and is the single declaration of where
 * "back" goes. It drives two things: the desktop **Back to tickets** button in
 * the actions row, and — below 900px — a back chevron *in place of* the menu
 * button.
 *
 * One control rather than two, because a sub-page has nothing to navigate to
 * that its back destination does not also reach. The trade: the drawer cannot
 * be opened from a sub-page, so signing out from `/accounts` on a phone is
 * back-then-menu. That is the conventional hierarchy on a small screen, and
 * two controls competing for the top-left corner is worse.
 *
 * The open state lives here because the button that sets it is a header
 * control, while the drawer itself is a full-page overlay and so is rendered as
 * a sibling — a fixed panel covering the viewport has no business inside the
 * banner landmark.
 */
export default function AppHeader({ title, action = null, backTo = null }) {
  const { user, logout } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef(null);

  return (
    <>
      <header className="app-header">
        {backTo ? (
          // Named "Back" rather than "Back to tickets": it is an icon control,
          // and the button beside it already carries the long form.
          <Link className="nav-toggle nav-back" to={backTo}>
            <span className="nav-back-chevron" aria-hidden="true" />
            <span className="visually-hidden">Back</span>
          </Link>
        ) : (
          <button
            ref={toggleRef}
            className="nav-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="app-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="nav-toggle-bars" aria-hidden="true" />
            <span className="visually-hidden">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        )}

        <div className="header-title">
          <h1>{title}</h1>
          <p className="muted header-identity">
            {user.fullName} · <span className="badge">{ROLE_LABELS[user.role]}</span>
          </p>
        </div>

        <div className="header-actions">
          {backTo && (
            <Link className="button button-ghost" to={backTo}>
              Back to tickets
            </Link>
          )}
          {action}
          <button className="button button-ghost" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <AppNav open={menuOpen} onClose={() => setMenuOpen(false)} returnFocusTo={toggleRef} />
    </>
  );
}
