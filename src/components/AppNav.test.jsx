import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import * as authApi from '../api/auth';
import * as ticketsApi from '../api/tickets';

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  createAccount: vi.fn(),
  listChildAccounts: vi.fn(),
  setInitialPassword: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

vi.mock('../api/tickets', () => ({
  listMyTickets: vi.fn(),
  listAgencyTickets: vi.fn(),
  listEscalatedTickets: vi.fn(),
  listTicketsForAgency: vi.fn(),
  getTicket: vi.fn(),
  createTicket: vi.fn(),
  updateTicketStatus: vi.fn(),
  escalateTicket: vi.fn(),
  listTicketMessages: vi.fn(),
  postTicketMessage: vi.fn(),
  markTicketRead: vi.fn(),
  reopenTicket: vi.fn(),
  TicketError: class TicketError extends Error {},
}));

const user = (role) => ({
  id: `${role}-1`,
  email: `${role}@email.com`,
  fullName: `${role} user`,
  role,
  parentId: role === 'admin' ? null : 'parent-1',
  mustChangePassword: false,
  createdAt: '2026-07-28T09:00:00.000Z',
});

function signedInAs(role, path = '/tickets') {
  authApi.getCurrentUser.mockResolvedValue(user(role));
  window.history.pushState({}, '', path);
}

// The nav's role changes to `dialog` while the drawer is open, which one test
// below asserts directly. Everything else just wants the element either way.
const nav = () =>
  screen.queryByRole('dialog', { name: /main/i }) ??
  screen.getByRole('navigation', { name: /main/i });
// The drawer has a close button of its own, so the header's toggle is scoped to
// the banner — which is exactly what rendering the drawer outside it buys.
const toggle = () => within(screen.getByRole('banner')).getByRole('button', { name: /menu/i });

beforeEach(() => {
  vi.clearAllMocks();
  authApi.listChildAccounts.mockResolvedValue([]);
  ticketsApi.listMyTickets.mockResolvedValue([]);
  ticketsApi.listAgencyTickets.mockResolvedValue([]);
  ticketsApi.listEscalatedTickets.mockResolvedValue([]);
  ticketsApi.listTicketsForAgency.mockResolvedValue([]);
  ticketsApi.listTicketMessages.mockResolvedValue([]);
  document.body.style.overflow = '';
});

/*
 * jsdom applies no CSS, so the desktop/drawer split — which is entirely a media
 * query — is not observable here. These cover the JavaScript half: what the
 * toggle does, and the modal behaviours that have to be right for the drawer to
 * be usable with a keyboard.
 */
describe('navigation', () => {
  it('gives a client their four destinations and no others', async () => {
    signedInAs('client');

    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

    const links = within(nav())
      .getAllByRole('link')
      .map((link) => link.textContent);

    // Resolved is deliberately absent: it is a filter on the list, not a place.
    expect(links).toEqual(['Tickets', 'Raise a ticket']);
    // Clients cannot create accounts, so the item is absent rather than disabled.
    expect(within(nav()).queryByRole('link', { name: /accounts/i })).not.toBeInTheDocument();
  });

  it('swaps raising a ticket for accounts on an agency', async () => {
    signedInAs('agency');

    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

    const links = within(nav())
      .getAllByRole('link')
      .map((link) => link.textContent);

    expect(links).toEqual(['Tickets', 'Accounts']);
  });

  /*
   * The desktop design is unchanged, and these guard that. jsdom applies no
   * CSS, so both the header controls and the drawer are in the DOM at once —
   * what matters is that the header still *has* the things a desktop user
   * reaches for, rather than having handed them to the drawer.
   */
  it('leaves identity, page actions and sign out in the header', async () => {
    signedInAs('agency');

    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(header.getByText(/agency user/)).toBeInTheDocument();
    expect(header.getByRole('link', { name: /manage accounts/i })).toBeInTheDocument();
  });

  it('carries sign out, so it is not stuck in the header on a phone', async () => {
    signedInAs('client');

    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

    expect(within(nav()).getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(within(nav()).getByText('client user')).toBeInTheDocument();
  });

  it('keeps Tickets marked while reading one, but not on Raise a ticket', async () => {
    signedInAs('client', '/tickets/t1');
    ticketsApi.getTicket.mockResolvedValue({
      id: 't1',
      subject: 'Laptop will not boot',
      description: 'x',
      department: 'hardware',
      urgency: 'high',
      status: 'open',
      clientId: 'client-1',
      agencyId: 'agency-1',
      escalatedAt: null,
      escalatedTo: null,
      reopenedAt: null,
      createdAt: '2026-07-28T09:00:00.000Z',
      updatedAt: '2026-07-28T09:00:00.000Z',
      client: { id: 'client-1', fullName: 'Client', email: 'c@e.com' },
    });

    render(<App />);
    await screen.findByRole('heading', { name: /laptop will not boot/i });

    // A ticket you are reading still belongs to the Tickets section...
    expect(within(nav()).getByRole('link', { name: 'Tickets' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    // ...but /tickets/new is its own destination and must not light both.
    expect(within(nav()).getByRole('link', { name: /raise a ticket/i })).not.toHaveAttribute(
      'aria-current'
    );
  });

  /*
   * On a sub-page the menu button becomes a back chevron in the same corner.
   * One control rather than two, because a sub-page has nothing to reach that
   * its back destination does not.
   */
  describe('the back chevron', () => {
    it('replaces the menu button on a sub-page', async () => {
      signedInAs('client', '/tickets/new');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /raise a ticket/i });

      const header = within(screen.getByRole('banner'));
      expect(header.queryByRole('button', { name: /menu/i })).not.toBeInTheDocument();
      expect(header.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/tickets');
    });

    it('is absent on the ticket list, which is where the menu belongs', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      const header = within(screen.getByRole('banner'));
      expect(header.getByRole('button', { name: /menu/i })).toBeInTheDocument();
      expect(header.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
    });

    it('goes where the desktop button goes, from one declaration', async () => {
      signedInAs('agency', '/accounts');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^accounts$/i });

      const header = within(screen.getByRole('banner'));
      expect(header.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/tickets');
      expect(header.getByRole('link', { name: /back to tickets/i })).toHaveAttribute(
        'href',
        '/tickets'
      );
    });
  });

  describe('the mobile drawer', () => {
    it('starts closed and opens from the menu button', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      expect(nav()).not.toHaveClass('app-nav-open');

      fireEvent.click(toggle());

      expect(toggle()).toHaveAttribute('aria-expanded', 'true');
      expect(nav()).toHaveClass('app-nav-open');
    });

    it('is only a dialog while it is actually covering the page', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      // Closed it is merely off-canvas, and must not be announced as a dialog.
      expect(nav()).not.toHaveAttribute('aria-modal');

      fireEvent.click(toggle());
      expect(nav()).toHaveAttribute('aria-modal', 'true');
      expect(nav()).toHaveAttribute('role', 'dialog');
    });

    it('offers a close control, since tapping away is not discoverable', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      fireEvent.click(toggle());
      fireEvent.click(within(nav()).getByRole('button', { name: /close menu/i }));

      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes when the scrim behind it is tapped', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      fireEvent.click(toggle());
      fireEvent.click(document.querySelector('.nav-scrim'));

      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes on Escape', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      fireEvent.click(toggle());
      fireEvent.keyDown(nav(), { key: 'Escape' });

      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('locks the page behind it and releases on close', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      fireEvent.click(toggle());
      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.keyDown(nav(), { key: 'Escape' });
      expect(document.body.style.overflow).toBe('');
    });

    it('moves focus into the drawer when it opens', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      fireEvent.click(toggle());

      // Otherwise a keyboard user tabs through the page behind it.
      expect(nav().contains(document.activeElement)).toBe(true);
    });

    it('closes itself once you navigate', async () => {
      signedInAs('client');

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i });

      fireEvent.click(toggle());
      fireEvent.click(within(nav()).getByRole('link', { name: /raise a ticket/i }));

      await screen.findByRole('heading', { level: 1, name: /raise a ticket/i });
      // Asserted on the panel, not the toggle: the destination is a sub-page,
      // where the menu button has been replaced by the back chevron.
      expect(nav()).not.toHaveClass('app-nav-open');
    });
  });
});
