import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

const ticket = (overrides = {}) => ({
  id: 't1',
  subject: 'Laptop will not boot',
  description: 'Nothing on screen after the login chime.',
  department: 'hardware',
  urgency: 'high',
  status: 'open',
  clientId: 'client-1',
  agencyId: 'agency-1',
  escalatedAt: null,
  escalatedTo: null,
  createdAt: '2026-07-28T09:00:00.000Z',
  updatedAt: '2026-07-28T09:00:00.000Z',
  client: { id: 'client-1', fullName: 'Client Test User', email: 'client@email.com' },
  ...overrides,
});

function open(role, overrides = {}) {
  authApi.getCurrentUser.mockResolvedValue(user(role));
  ticketsApi.getTicket.mockResolvedValue(ticket(overrides));
  window.history.pushState({}, '', '/tickets/t1');
}

const message = (overrides = {}) => ({
  id: 'm1',
  ticketId: 't1',
  body: 'Have you tried a hard reset?',
  createdAt: '2026-07-28T10:00:00.000Z',
  authorId: 'agency-1',
  authorRole: 'agency',
  author: { id: 'agency-1', fullName: 'Agency Test User', email: 'agency@email.com' },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  ticketsApi.listAgencyTickets.mockResolvedValue([]);
  ticketsApi.listMyTickets.mockResolvedValue([]);
  ticketsApi.listTicketMessages.mockResolvedValue([]);
  // Async in real life, so the mock has to resolve rather than return undefined.
  ticketsApi.markTicketRead.mockResolvedValue(undefined);
});

describe('ticket detail', () => {
  it('shows the full ticket to the client who raised it', async () => {
    open('client');

    render(<App />);

    expect(await screen.findByRole('heading', { name: /laptop will not boot/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing on screen after the login chime/i)).toBeInTheDocument();
    expect(screen.getByText('Hardware')).toBeInTheDocument();
  });

  it('gives a client no way to change the status', async () => {
    open('client');

    render(<App />);
    await screen.findByRole('heading', { name: /laptop will not boot/i });

    expect(screen.queryByRole('heading', { name: /actions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update status/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /escalate/i })).not.toBeInTheDocument();
  });

  it('lets an agency move the status', async () => {
    open('agency');
    ticketsApi.updateTicketStatus.mockResolvedValue(ticket({ status: 'in_progress' }));

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    // Nothing to save until something actually changes.
    expect(screen.getByRole('button', { name: /update status/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'in_progress' } });
    fireEvent.click(screen.getByRole('button', { name: /update status/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/in progress/i);
    expect(ticketsApi.updateTicketStatus).toHaveBeenCalledWith('t1', 'in_progress');
  });

  it('lets an agency escalate an unescalated ticket', async () => {
    open('agency');
    ticketsApi.escalateTicket.mockResolvedValue(
      ticket({ escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'parent-1' })
    );

    render(<App />);
    const button = await screen.findByRole('button', { name: /escalate to admin/i });
    fireEvent.click(button);

    expect(await screen.findByRole('status')).toHaveTextContent(/escalated to your admin/i);
    expect(ticketsApi.escalateTicket).toHaveBeenCalledWith('t1');
    // Reflects the new state without a reload, and cannot be escalated twice.
    expect(screen.queryByRole('button', { name: /escalate to admin/i })).not.toBeInTheDocument();
  });

  it('does not offer escalation on an already escalated ticket', async () => {
    open('agency', { escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'parent-1' });

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    expect(screen.queryByRole('button', { name: /escalate to admin/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update status/i })).toBeInTheDocument();
  });

  it('lets an admin change status but not escalate further', async () => {
    open('admin', { escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'admin-1' });

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    expect(screen.getByRole('button', { name: /update status/i })).toBeInTheDocument();
    // Top of the hierarchy — nobody above to escalate to.
    expect(screen.queryByRole('button', { name: /escalate/i })).not.toBeInTheDocument();
  });

  it('tones the escalation badge down on a resolved ticket', async () => {
    open('agency', {
      status: 'resolved',
      escalatedAt: '2026-07-28T11:00:00.000Z',
      escalatedTo: 'parent-1',
    });

    render(<App />);
    await screen.findByRole('heading', { name: /laptop will not boot/i });

    // Scoped to the span — the detail grid's <dt> label reads "Escalated" too.
    const badge = screen.getByText(/^escalated$/i, { selector: 'span' });
    expect(badge).toHaveClass('badge-escalated-past');
    expect(badge).not.toHaveClass('badge-escalated');
  });

  it('keeps the escalation badge loud while the ticket is still open', async () => {
    open('agency', {
      status: 'in_progress',
      escalatedAt: '2026-07-28T11:00:00.000Z',
      escalatedTo: 'parent-1',
    });

    render(<App />);
    await screen.findByRole('heading', { name: /laptop will not boot/i });

    expect(screen.getByText(/^escalated$/i, { selector: 'span' })).toHaveClass('badge-escalated');
  });

  it('falls back to a bare ticket list when reached by URL rather than from one', async () => {
    open('client');

    render(<App />);
    await screen.findByRole('heading', { name: /laptop will not boot/i });

    // No history state to return to, so both must still go somewhere sane —
    // the desktop button and the mobile chevron read the same declaration.
    expect(screen.getByRole('link', { name: /back to tickets/i })).toHaveAttribute(
      'href',
      '/tickets'
    );
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/tickets');
  });

  /*
   * The phone reorders these panels with CSS `order`, which jsdom cannot see.
   * What it can check is that the hooks that CSS keys off still exist — a
   * rename would silently put the conversation back below the actions.
   */
  it('tags each panel so the phone can reorder them', async () => {
    open('agency', { status: 'resolved' });

    render(<App />);
    await screen.findByRole('heading', { name: /laptop will not boot/i });

    const panel = (heading) =>
      screen.getByRole('heading', { name: heading }).closest('section');

    expect(panel(/laptop will not boot/i)).toHaveClass('panel-ticket');
    expect(panel(/^conversation$/i)).toHaveClass('panel-conversation');
    expect(panel(/^actions$/i)).toHaveClass('panel-actions');
  });

  it('surfaces a refused ticket as an error with a retry', async () => {
    authApi.getCurrentUser.mockResolvedValue(user('agency'));
    ticketsApi.getTicket.mockRejectedValue(new Error('That ticket could not be found.'));
    window.history.pushState({}, '', '/tickets/nope');

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('reports a failed status change without losing the page', async () => {
    open('agency');
    ticketsApi.updateTicketStatus.mockRejectedValue(new Error('Could not update the ticket.'));

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'resolved' } });
    fireEvent.click(screen.getByRole('button', { name: /update status/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not update the ticket/i);
    expect(screen.getByRole('heading', { name: /laptop will not boot/i })).toBeInTheDocument();
  });
});

describe('reopening a resolved ticket', () => {
  it('offers the client a way back when the agency has marked it resolved', async () => {
    open('client', { status: 'resolved' });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /not fixed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reopen this ticket/i })).toBeInTheDocument();
  });

  it('does not offer it on a ticket that is still being worked', async () => {
    open('client', { status: 'in_progress' });

    render(<App />);
    await screen.findByRole('heading', { name: /laptop will not boot/i });

    expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument();
  });

  it('does not offer it to the agency, who can just set the status', async () => {
    open('agency', { status: 'resolved' });

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    expect(screen.queryByRole('button', { name: /reopen this ticket/i })).not.toBeInTheDocument();
  });

  it('insists on a reason before sending it back', async () => {
    open('client', { status: 'resolved' });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /reopen this ticket/i }));

    // "It isn't fixed" with nothing after it gives the agency nothing to act on.
    expect(await screen.findByRole('alert')).toHaveTextContent(/say what is still wrong/i);
    expect(ticketsApi.reopenTicket).not.toHaveBeenCalled();
  });

  it('reopens with the reason and reflects the new status', async () => {
    open('client', { status: 'resolved' });
    ticketsApi.reopenTicket.mockResolvedValue(ticket({ status: 'open' }));

    render(<App />);
    fireEvent.change(await screen.findByLabelText(/what.s still wrong/i), {
      target: { value: 'It started doing it again the next morning.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reopen this ticket/i }));

    await screen.findByText('Open');
    expect(ticketsApi.reopenTicket).toHaveBeenCalledWith(
      't1',
      'It started doing it again the next morning.'
    );
    // Back to open, so there is nothing left to refuse.
    expect(screen.queryByRole('button', { name: /reopen this ticket/i })).not.toBeInTheDocument();
  });

  it('refetches the conversation so the reason appears in it', async () => {
    open('client', { status: 'resolved' });
    ticketsApi.reopenTicket.mockResolvedValue(ticket({ status: 'open' }));

    render(<App />);
    await screen.findByRole('button', { name: /reopen this ticket/i });
    expect(ticketsApi.listTicketMessages).toHaveBeenCalledTimes(1);

    ticketsApi.listTicketMessages.mockResolvedValue([
      message({
        body: 'It started doing it again.',
        authorId: 'client-1',
        authorRole: 'client',
        author: { id: 'client-1', fullName: 'Client Test User', email: 'client@email.com' },
      }),
    ]);

    fireEvent.change(screen.getByLabelText(/what.s still wrong/i), {
      target: { value: 'It started doing it again.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reopen this ticket/i }));

    /*
     * Scoped to the thread deliberately. React syncs a textarea's value into
     * its text content, so an unscoped findByText matches the reason box before
     * the message exists — and then fails, because the box unmounts once the
     * ticket is open again.
     *
     * Waiting for the list to appear is also what proves the refetch landed:
     * an empty thread renders no list at all.
     */
    const thread = await screen.findByRole('list', { name: /conversation/i });
    expect(within(thread).getByText(/it started doing it again/i)).toBeInTheDocument();
    expect(ticketsApi.listTicketMessages).toHaveBeenCalledTimes(2);
  });

  it('keeps the typed reason when the reopen fails', async () => {
    open('client', { status: 'resolved' });
    ticketsApi.reopenTicket.mockRejectedValue(new Error('Could not reopen that ticket.'));

    render(<App />);
    fireEvent.change(await screen.findByLabelText(/what.s still wrong/i), {
      target: { value: 'Still broken' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reopen this ticket/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reopen that ticket/i);
    expect(screen.getByLabelText(/what.s still wrong/i)).toHaveValue('Still broken');
  });
});

describe('ticket conversation', () => {
  it('shows the thread with each author and their role', async () => {
    open('client');
    ticketsApi.listTicketMessages.mockResolvedValue([
      message(),
      message({
        id: 'm2',
        body: 'Yes, twice. Still nothing.',
        authorId: 'client-1',
        authorRole: 'client',
        author: { id: 'client-1', fullName: 'Client Test User', email: 'client@email.com' },
        createdAt: '2026-07-28T10:05:00.000Z',
      }),
    ]);

    render(<App />);

    expect(await screen.findByText(/have you tried a hard reset/i)).toBeInTheDocument();
    expect(screen.getByText(/still nothing/i)).toBeInTheDocument();
    expect(screen.getByText('Agency Test User')).toBeInTheDocument();

    // Scoped to the thread: the header carries the signed-in user's role chip too.
    const thread = within(screen.getByRole('list', { name: /conversation/i }));
    expect(thread.getByText('Agency')).toBeInTheDocument();
    expect(thread.getByText('Client')).toBeInTheDocument();
  });

  /*
   * AsyncBoundary renders `empty` instead of its children, so putting the
   * composer inside it would leave a client unable to send the first message —
   * exactly the state every new ticket starts in.
   */
  it('still offers the composer on an empty thread', async () => {
    open('client');

    render(<App />);

    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('sends a message and shows it without waiting for the next poll', async () => {
    open('client');
    ticketsApi.postTicketMessage.mockResolvedValue(
      message({
        id: 'm9',
        body: 'The screen stays black.',
        authorId: 'client-1',
        authorRole: 'client',
        author: { id: 'client-1', fullName: 'Client Test User', email: 'client@email.com' },
      })
    );

    render(<App />);
    await screen.findByText(/no messages yet/i);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'The screen stays black.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // The refetch still returns nothing; the optimistic append is what shows.
    expect(await screen.findByText(/the screen stays black/i)).toBeInTheDocument();
    expect(ticketsApi.postTicketMessage).toHaveBeenCalledWith('t1', 'The screen stays black.');
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('will not send an empty or whitespace-only message', async () => {
    open('client');

    render(<App />);
    await screen.findByText(/no messages yet/i);

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Real text' } });
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  it('keeps the typed text when a send fails', async () => {
    open('client');
    ticketsApi.postTicketMessage.mockRejectedValue(new Error('Could not send that message.'));

    render(<App />);
    await screen.findByText(/no messages yet/i);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please help' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not send that message/i);
    // Losing what someone typed is worse than the failure itself.
    expect(screen.getByLabelText('Message')).toHaveValue('Please help');
  });

  it('lets an agency post on its own ticket', async () => {
    open('agency');

    render(<App />);
    await screen.findByRole('heading', { name: /conversation/i });

    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });

  it('closes the conversation once the ticket is resolved', async () => {
    open('client', { status: 'resolved' });
    ticketsApi.listTicketMessages.mockResolvedValue([message()]);

    render(<App />);

    // Still readable — the history is the point — but no longer writable.
    expect(await screen.findByText(/have you tried a hard reset/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/conversation is closed/i)).toBeInTheDocument();
  });

  it('closes it for the agency too, not just the client', async () => {
    open('agency', { status: 'resolved' });
    ticketsApi.listTicketMessages.mockResolvedValue([message()]);

    render(<App />);
    await screen.findByRole('heading', { name: /conversation/i });

    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.getByText(/conversation is closed/i)).toBeInTheDocument();
  });

  it('points the client at reopening as the way back', async () => {
    open('client', { status: 'resolved' });

    render(<App />);
    await screen.findByRole('heading', { name: /conversation/i });

    // One route back, and it is the one that actually moves the status.
    expect(screen.getByText(/reopen it above/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reopen this ticket/i })).toBeInTheDocument();
  });

  it('reopens the conversation when the ticket is reopened', async () => {
    open('client', { status: 'resolved' });
    ticketsApi.reopenTicket.mockResolvedValue(ticket({ status: 'open' }));

    render(<App />);
    await screen.findByRole('heading', { name: /conversation/i });
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/what.s still wrong/i), {
      target: { value: 'It came back.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reopen this ticket/i }));

    expect(await screen.findByLabelText('Message')).toBeInTheDocument();
    expect(screen.queryByText(/conversation is closed/i)).not.toBeInTheDocument();
  });

  it('marks a reopen in the thread as an event, not a reply', async () => {
    open('agency', { status: 'open', reopenedAt: '2026-07-29T09:00:00.000Z' });
    ticketsApi.listTicketMessages.mockResolvedValue([
      message(),
      message({
        id: 'm2',
        kind: 'reopen',
        body: 'It came back the next morning.',
        authorId: 'client-1',
        authorRole: 'client',
        author: { id: 'client-1', fullName: 'Client Test User', email: 'client@email.com' },
        createdAt: '2026-07-29T09:00:00.000Z',
      }),
    ]);

    render(<App />);

    // The agency can tell a returning problem from a new one at a glance.
    expect(await screen.findByText(/reopened this ticket/i)).toBeInTheDocument();
    expect(screen.getByText(/said the problem was still there/i)).toBeInTheDocument();
    expect(screen.getByText(/it came back the next morning/i)).toBeInTheDocument();
  });

  it('leaves ordinary messages attributed normally', async () => {
    open('agency');
    ticketsApi.listTicketMessages.mockResolvedValue([message({ kind: 'message' })]);

    render(<App />);
    await screen.findByText(/have you tried a hard reset/i);

    expect(screen.queryByText(/reopened this ticket/i)).not.toBeInTheDocument();
    expect(screen.getByText('Agency Test User')).toBeInTheDocument();
  });

  it('lets an admin read but not post until the ticket is escalated to them', async () => {
    open('admin');
    ticketsApi.listTicketMessages.mockResolvedValue([message()]);

    render(<App />);

    // Browsing by agency is oversight — the thread is readable, not writable.
    expect(await screen.findByText(/have you tried a hard reset/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
    expect(screen.getByText(/escalating the ticket to you is what brings you into it/i)).toBeInTheDocument();
  });

  it('brings an admin into the conversation once it is escalated to them', async () => {
    open('admin', { escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'admin-1' });
    ticketsApi.listTicketMessages.mockResolvedValue([message()]);

    render(<App />);
    await screen.findByText(/have you tried a hard reset/i);

    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('keeps an admin out of another admin\'s escalation', async () => {
    open('admin', { escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'someone-else' });

    render(<App />);
    await screen.findByRole('heading', { name: /conversation/i });

    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  });

  it('picks up new messages on a poll without flashing the loading state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      open('client');
      ticketsApi.listTicketMessages.mockResolvedValue([message()]);

      render(<App />);
      await screen.findByText(/have you tried a hard reset/i);

      ticketsApi.listTicketMessages.mockResolvedValue([
        message(),
        message({ id: 'm2', body: 'Booking you an engineer.', createdAt: '2026-07-28T10:10:00.000Z' }),
      ]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(screen.getByText(/booking you an engineer/i)).toBeInTheDocument();
      // The thread never blinks back to a loading placeholder mid-conversation.
      expect(screen.queryByText(/loading the conversation/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the thread read once it has been shown', async () => {
    open('client');
    ticketsApi.listTicketMessages.mockResolvedValue([message()]);

    render(<App />);
    await screen.findByText(/have you tried a hard reset/i);

    expect(ticketsApi.markTicketRead).toHaveBeenCalledWith('t1');
  });

  it('does not mark an empty thread read', async () => {
    open('client');

    render(<App />);
    await screen.findByText(/no messages yet/i);

    expect(ticketsApi.markTicketRead).not.toHaveBeenCalled();
  });

  it('re-marks read when a reply lands while the thread is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      open('client');
      ticketsApi.listTicketMessages.mockResolvedValue([message()]);

      render(<App />);
      await screen.findByText(/have you tried a hard reset/i);
      expect(ticketsApi.markTicketRead).toHaveBeenCalledTimes(1);

      // A poll that changes nothing must not cost a request.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(ticketsApi.markTicketRead).toHaveBeenCalledTimes(1);

      ticketsApi.listTicketMessages.mockResolvedValue([
        message(),
        message({ id: 'm2', body: 'Engineer booked.', createdAt: '2026-07-28T10:10:00.000Z' }),
      ]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      // Otherwise a reply read on this page is still unread back on the list.
      await screen.findByText(/engineer booked/i);
      expect(ticketsApi.markTicketRead).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the thread on screen when a poll fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      open('client');
      ticketsApi.listTicketMessages.mockResolvedValue([message()]);

      render(<App />);
      await screen.findByText(/have you tried a hard reset/i);

      ticketsApi.listTicketMessages.mockRejectedValue(new Error('Network blip.'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      // Showing it slightly behind beats replacing it with an error screen.
      expect(screen.getByText(/have you tried a hard reset/i)).toBeInTheDocument();
      expect(await screen.findByText(/reconnecting/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
