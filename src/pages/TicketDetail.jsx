import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { escalateTicket, getTicket, updateTicketStatus } from '../api/tickets';
import {
  DEPARTMENT_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  URGENCY_LABELS,
  canEscalate,
  canManageTickets,
} from '../../shared/tickets.js';
import useAsync from '../lib/useAsync';
import AsyncBoundary from '../components/AsyncBoundary';
import AppHeader from '../components/AppHeader';

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
    <section className="panel">
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

export default function TicketDetail() {
  const { id } = useParams();
  const { user } = useAuth();

  const task = useCallback(() => getTicket(id), [id]);
  const state = useAsync(task);

  // Keeps the page in step after an action without a second round trip; the
  // write already returns the updated row.
  const [override, setOverride] = useState(null);

  return (
    <div className="app-layout">
      <AppHeader
        title="Ticket"
        action={
          <Link className="button button-ghost" to="/tickets">
            Back to tickets
          </Link>
        }
      />

      <main className="app-main app-main-stack">
        <AsyncBoundary state={state} empty={<p className="muted">That ticket is no longer available.</p>}>
          {(loaded) => {
            const ticket = override ?? loaded;

            return (
              <>
                <section className="panel">
                  <div className="panel-head">
                    <h2>{ticket.subject}</h2>
                    <span className={`status status-${ticket.status.replace(/_/g, '-')}`}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </div>

                  <dl className="detail-grid">
                    <dt>Raised by</dt>
                    <dd>
                      {ticket.client?.fullName ?? 'Unknown'}
                      {ticket.client?.email ? ` (${ticket.client.email})` : ''}
                    </dd>

                    <dt>Department</dt>
                    <dd>{DEPARTMENT_LABELS[ticket.department] ?? ticket.department}</dd>

                    <dt>Urgency</dt>
                    <dd>
                      <span className={`urgency urgency-${ticket.urgency}`}>
                        {URGENCY_LABELS[ticket.urgency] ?? ticket.urgency}
                      </span>
                    </dd>

                    <dt>Raised</dt>
                    <dd>{formatDateTime(ticket.createdAt)}</dd>

                    <dt>Last updated</dt>
                    <dd>{formatDateTime(ticket.updatedAt)}</dd>

                    {ticket.escalatedAt && (
                      <>
                        <dt>Escalated</dt>
                        <dd>
                          <span className="badge badge-escalated">Escalated</span>{' '}
                          {formatDateTime(ticket.escalatedAt)}
                        </dd>
                      </>
                    )}
                  </dl>

                  <h3 className="detail-subhead">Description</h3>
                  <p className="detail-description">{ticket.description}</p>
                </section>

                {canManageTickets(user.role) && (
                  <TicketActions ticket={ticket} role={user.role} onChanged={setOverride} />
                )}
              </>
            );
          }}
        </AsyncBoundary>
      </main>
    </div>
  );
}
