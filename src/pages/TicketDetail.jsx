import { useCallback, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { escalateTicket, getTicket, reopenTicket, updateTicketStatus } from '../api/tickets';
import {
  DEPARTMENT_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  URGENCY_LABELS,
  canEscalate,
  canManageTickets,
  canReopen,
  hasOpenEscalation,
} from '../../shared/tickets.js';
import useAsync from '../lib/useAsync';
import AsyncBoundary from '../components/AsyncBoundary';
import AppHeader from '../components/AppHeader';
import TicketChat from '../components/TicketChat';

const formatDateTime = (value) => new Date(value).toLocaleString();

function TicketActions({ ticket, role, onChanged }) {
  const [status, setStatus] = useState(ticket.status);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function run(action, label, work) {
    setBusy(action);
    setError(null);
    setNotice(null);

    try {
      const updated = await work();
      setNotice(label);
      onChanged(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const statusChanged = status !== ticket.status;

  return (
    <section className="panel panel-actions">
      <h2>Actions</h2>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="action-row">
        <label className="field field-inline" htmlFor="status">
          <span>Status</span>
          <select
            id="status"
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <button
          className="button"
          type="button"
          disabled={!statusChanged || busy !== null}
          onClick={() =>
            run('status', `Status set to ${STATUS_LABELS[status]}.`, () =>
              updateTicketStatus(ticket.id, status)
            )
          }
        >
          {busy === 'status' ? 'Saving…' : 'Update status'}
        </button>
      </div>

      {canEscalate(role, ticket) && (
        <div className="action-row action-row-stacked">
          <p className="muted">
            Can&apos;t resolve this? Escalate it to your admin. You keep working the ticket
            either way — escalating asks for help rather than handing it over.
          </p>
          <button
            className="button button-ghost"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              run('escalate', 'Escalated to your admin.', () => escalateTicket(ticket.id))
            }
          >
            {busy === 'escalate' ? 'Escalating…' : 'Escalate to admin'}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * A client refusing a resolution.
 *
 * The reason is required rather than optional: "this isn't fixed" with nothing
 * after it gives the agency nothing to pick up, and the text goes straight into
 * the conversation where they will read it.
 */
function ReopenPanel({ ticket, onReopened }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();

    if (!reason.trim()) {
      setError('Say what is still wrong, so your agency knows what to pick up.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      onReopened(await reopenTicket(ticket.id, reason.trim()));
    } catch (err) {
      // The text stays put — a failed send must never eat what was typed.
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="panel panel-reopen">
      <h2>Not fixed?</h2>
      <p className="muted panel-intro">
        Your agency marked this resolved. If the problem is still there, say what&apos;s
        still wrong and it goes back to them with your note added to the conversation.
      </p>

      <form className="reopen-form" onSubmit={submit}>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <label className="field" htmlFor="reason">
          <span>What&apos;s still wrong?</span>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="The laptop still won't boot after the replacement charger arrived…"
          />
        </label>

        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Reopening…' : 'Reopen this ticket'}
        </button>
      </form>
    </section>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();

  /*
   * Back to the list as it was — which for an admin means with their chosen
   * agency still selected. Falls back to a bare /tickets when the ticket was
   * reached by URL rather than from a list.
   *
   * Guarded to a /tickets path so a stale or hand-edited history entry can only
   * ever send you back into the list, never somewhere unexpected.
   */
  const from = location.state?.from;
  const backTo = typeof from === 'string' && from.startsWith('/tickets') ? from : '/tickets';

  const task = useCallback(() => getTicket(id), [id]);
  const state = useAsync(task);

  // Keeps the page in step after an action without a second round trip; the
  // write already returns the updated row.
  const [override, setOverride] = useState(null);

  // Reopening posts a message as a side effect, so the thread has to refetch
  // rather than wait out its poll. Bumping this changes TicketChat's task
  // identity, which is what re-runs the fetch.
  const [chatReload, setChatReload] = useState(0);

  const handleReopened = useCallback((updated) => {
    setOverride(updated);
    setChatReload((n) => n + 1);
  }, []);

  return (
    <div className="app-layout">
      <AppHeader title="Ticket" backTo={backTo} />

      <main className="app-main app-main-stack">
        <AsyncBoundary state={state} empty={<p className="muted">That ticket is no longer available.</p>}>
          {(loaded) => {
            const ticket = override ?? loaded;

            return (
              <>
                <section className="panel panel-ticket">
                  <div className="panel-head">
                    <h2>{ticket.subject}</h2>
                    <span className={`status status-${ticket.status.replace(/_/g, '-')}`}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </div>

                  {/*
                   * Each pair is wrapped so it cannot break across lines when
                   * the grid becomes an inline strip on a phone. `display:
                   * contents` hands the dt and dd straight back to the grid at
                   * desktop widths, so the two-column layout is unchanged.
                   */}
                  <dl className="detail-grid">
                    <div>
                      <dt>Raised by</dt>
                      <dd>
                        {ticket.client?.fullName ?? 'Unknown'}
                        {ticket.client?.email ? ` (${ticket.client.email})` : ''}
                      </dd>
                    </div>

                    <div>
                      <dt>Department</dt>
                      <dd>{DEPARTMENT_LABELS[ticket.department] ?? ticket.department}</dd>
                    </div>

                    <div>
                      <dt>Urgency</dt>
                      <dd>
                        <span className={`urgency urgency-${ticket.urgency}`}>
                          {URGENCY_LABELS[ticket.urgency] ?? ticket.urgency}
                        </span>
                      </dd>
                    </div>

                    <div>
                      <dt>Raised</dt>
                      <dd>{formatDateTime(ticket.createdAt)}</dd>
                    </div>

                    <div>
                      <dt>Last updated</dt>
                      <dd>{formatDateTime(ticket.updatedAt)}</dd>
                    </div>

                    {ticket.escalatedAt && (
                      <div>
                        <dt>Escalated</dt>
                        <dd>
                          <span
                            className={`badge ${
                              hasOpenEscalation(ticket)
                                ? 'badge-escalated'
                                : 'badge-escalated-past'
                            }`}
                          >
                            Escalated
                          </span>{' '}
                          {formatDateTime(ticket.escalatedAt)}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <h3 className="detail-subhead">Description</h3>
                  <p className="detail-description">{ticket.description}</p>
                </section>

                {canManageTickets(user.role) && (
                  <TicketActions ticket={ticket} role={user.role} onChanged={setOverride} />
                )}

                {canReopen(user.role, ticket, user.id) && (
                  <ReopenPanel ticket={ticket} onReopened={handleReopened} />
                )}

                <TicketChat ticket={ticket} user={user} reloadKey={chatReload} />
              </>
            );
          }}
        </AsyncBoundary>
      </main>
    </div>
  );
}
