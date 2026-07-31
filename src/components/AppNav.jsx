import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, canCreateAccounts } from '../../shared/roles.js';
import { canCreateTickets } from '../../shared/tickets.js';

/**
 * The small-screen navigation drawer.
 *
 * **Exclusively for narrow viewports.** Above 900px this whole component is
 * `display: none` and the header carries identity, page actions and sign-out
 * exactly as it always did. Nothing here changes the desktop layout.
 *
 * 900 rather than the 640 used elsewhere in the stylesheet: 640 would leave
 * portrait tablets with a header too cramped to hold the actions, so they get
 * the drawer too.
 *
 * `open` is owned by `AppHeader`, because the button that sets it is a header
 * control while this panel is a full-page overlay.
 */

/**
 * Nav destinations for a role, in the order they are shown.
 *
 * Resolved is deliberately *not* here. It is a filter of the ticket list, not a
 * place — sitting it beside "Raise a ticket" and "Accounts", styled identically
 * to them, made a sub-view look like a fourth destination. The segmented
 * control on the list itself says what it actually is, and can show both counts
 * at once, which two nav links never could.
 */
function linksFor(role) {
  const links = [{ to: '/tickets', label: 'Tickets' }];

  if (canCreateTickets(role)) {
    links.push({ to: '/tickets/new', label: 'Raise a ticket' });
  }

  if (canCreateAccounts(role)) {
    links.push({ to: '/accounts', label: 'Accounts' });
  }

  return links;
}

/**
 * Which item is the page you are on.
 *
 * Done here rather than with `NavLink` because a ticket you are *reading*
 * still belongs to the Tickets section, while `/tickets/new` is its own
 * destination and must not light both.
 */
function isCurrent(link, location) {
  const { pathname } = location;
  if (pathname === link.to) return true;

  return (
    link.to === '/tickets' && pathname.startsWith('/tickets/') && pathname !== '/tickets/new'
  );
}

export default function AppNav({ open, onClose, returnFocusTo }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const panelRef = useRef(null);

  /*
   * Navigating is the end of the drawer's job — but only an actual change of
   * destination. Closing on mount too would write state on every page load for
   * a drawer that was never open.
   */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onClose();
    // Only the destination should close it — not a new onClose identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  /*
   * Focus moves in on open and back to the menu button on close, so a keyboard
   * user is never left tabbing through the page behind the drawer.
   *
   * `wasOpen` is what stops the close branch running on mount and stealing
   * focus to the menu button the moment any page loads.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      panelRef.current?.querySelector('a, button')?.focus();
      return;
    }

    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (document.activeElement === document.body) returnFocusTo?.current?.focus();
  }, [open, returnFocusTo]);

  // The page behind must not scroll under the drawer.
  useEffect(() => {
    if (!open) return undefined;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /*
   * Resizing past the breakpoint turns the drawer back into the desktop header,
   * so the open state has to go with it — otherwise the scroll lock above would
   * stay applied to a page with no drawer on it.
   */
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;

    const wide = window.matchMedia('(min-width: 900px)');
    const onChange = (event) => {
      if (event.matches) onClose();
    };

    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, [onClose]);

  /** Escape closes; Tab cycles inside the panel rather than escaping behind it. */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !open) return;

    const focusable = panelRef.current?.querySelectorAll('a[href], button:not([disabled])');
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const links = linksFor(user.role);

  return (
    <>
      {/* Click-away. Hidden above the breakpoint, where nothing is modal. */}
      <div
        className={`nav-scrim${open ? ' nav-scrim-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <nav
        id="app-nav"
        ref={panelRef}
        className={`app-nav${open ? ' app-nav-open' : ''}`}
        aria-label="Main"
        // Only a dialog while it is actually covering the page.
        aria-modal={open ? 'true' : undefined}
        role={open ? 'dialog' : undefined}
        onKeyDown={onKeyDown}
      >
        <div className="nav-brand">
          <span className="nav-brand-mark" aria-hidden="true" />
          Ticket System
          {/*
           * Tapping away and Escape both close it, but neither is discoverable
           * on a touch screen — so there is a control that says so.
           */}
          <button className="nav-close" type="button" onClick={onClose}>
            <span aria-hidden="true">×</span>
            <span className="visually-hidden">Close menu</span>
          </button>
        </div>

        <ul className="nav-links">
          {links.map((link) => {
            const current = isCurrent(link, location);

            return (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className={current ? 'nav-link nav-link-current' : 'nav-link'}
                  aria-current={current ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="nav-foot">
          <p className="nav-identity">
            <span className="nav-identity-name">{user.fullName}</span>
            <span className="muted">{ROLE_LABELS[user.role]}</span>
          </p>

          <button className="button button-ghost nav-signout" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </nav>
    </>
  );
}
