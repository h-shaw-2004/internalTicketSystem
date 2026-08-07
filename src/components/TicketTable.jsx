import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  DEPARTMENT_LABELS,
  STATUS_LABELS,
  URGENCY_LABELS,
  hasOpenEscalation,
  isReopened,
} from '../../shared/tickets.js';
import { clickableRow } from '../lib/clickableRow';

const formatDate = (value) => new Date(value).toLocaleDateString();

/**
 * Shared summary table. `showClient` is off for a client's own list, where every
 * row would name them.
 */
export default function TicketTable({ tickets, showClient = false }) {
  const navigate = useNavigate();
  const location = useLocation();

  /*
   * Where the list was when the row was clicked, so the ticket's "Back to
   * tickets" link can return to it rather than to a bare /tickets. That is what
   * keeps an admin's chosen agency selected across viewing a ticket.
   *
   * Unrelated to the login redirect CLAUDE.md rules out — this restores a list
   * you were just looking at, not a destination across a change of account.
   */
  const from = `${location.pathname}${location.search}`;

  return (
    /*
     * `table-settle` is the small entrance the panels use, re-run whenever the
     * list is reordered — Tickets.jsx keys this component on the sort, so
     * choosing one remounts the table and the animation plays again.
     *
     * A poll leaves the key alone, so a background refresh never animates. That
     * is the same instinct as `useAsync` not setting `loading` on a re-run: the
     * view should not blink at you for something you did not ask for.
     */
    <div className="table-scroll table-settle">
      <table className="account-table">
        <thead>
          <tr>
            <th scope="col">Subject</th>
            {/*
             * `col-secondary` marks the columns a phone drops. Six of these
             * cannot fit 360px — but nothing is lost, because the same three
             * facts reappear on a second line under the subject. Subject,
             * urgency and status are what a queue is scanned by, so they stay
             * as columns.
             */}
            {showClient && (
              <th scope="col" className="col-secondary">
                Client
              </th>
            )}
            <th scope="col" className="col-secondary">
              Department
            </th>
            <th scope="col" className="col-secondary">
              Urgency
            </th>
            <th scope="col" className="col-secondary">
              Status
            </th>
            <th scope="col" className="col-secondary">
              Raised
            </th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr
              key={ticket.id}
              {...clickableRow(() => navigate(`/tickets/${ticket.id}`, { state: { from } }))}
            >
              <td>
                <Link to={`/tickets/${ticket.id}`} state={{ from }}>
                  {ticket.subject}
                </Link>
                {ticket.unreadCount > 0 && (
                  <span className="badge badge-unread">
                    {ticket.unreadCount} new
                    {/* The count alone reads as a quantity, not as "unread". */}
                    <span className="visually-hidden">
                      {' '}
                      {ticket.unreadCount === 1 ? 'unread reply' : 'unread replies'}
                    </span>
                  </span>
                )}
                {isReopened(ticket) && (
                  // Work that has come back is usually a smaller job than a new
                  // ticket, so it says so rather than blending in with them.
                  <span
                    className="badge badge-reopened"
                    title="The client reopened this after it was resolved"
                  >
                    Reopened
                  </span>
                )}
                {ticket.escalatedAt &&
                  (hasOpenEscalation(ticket) ? (
                    <span className="badge badge-escalated" title="Escalated to admin">
                      Escalated
                    </span>
                  ) : (
                    // Still worth recording, but it is history now, not a flag.
                    <span
                      className="badge badge-escalated-past"
                      title="Was escalated to admin before it was resolved"
                    >
                      Escalated
                    </span>
                  ))}

                {/*
                 * Status and urgency return as their own marks rather than as
                 * text in the line below: the status dot and the urgency's
                 * weight are the fastest things in a row to scan by, and
                 * flattening them into a sentence would throw that away.
                 */}
                <span className="cell-state">
                  <span className={`status status-${ticket.status.replace(/_/g, '-')}`}>
                    {STATUS_LABELS[ticket.status] ?? ticket.status}
                  </span>
                  <span className={`urgency urgency-${ticket.urgency}`}>
                    {URGENCY_LABELS[ticket.urgency] ?? ticket.urgency}
                  </span>
                </span>

                {/*
                 * The dropped columns, returned as one line under the subject.
                 * Joined into a single string rather than separate nodes so an
                 * exact-text query still finds only the real cell.
                 */}
                <span className="cell-sub">
                  {[
                    showClient ? ticket.client?.fullName : null,
                    DEPARTMENT_LABELS[ticket.department] ?? ticket.department,
                    formatDate(ticket.createdAt),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </td>
              {showClient && <td className="col-secondary">{ticket.client?.fullName ?? '—'}</td>}
              <td className="col-secondary">
                {DEPARTMENT_LABELS[ticket.department] ?? ticket.department}
              </td>
              <td className="col-secondary">
                <span className={`urgency urgency-${ticket.urgency}`}>
                  {URGENCY_LABELS[ticket.urgency] ?? ticket.urgency}
                </span>
              </td>
              <td className="col-secondary">
                <span className={`status status-${ticket.status.replace(/_/g, '-')}`}>
                  {STATUS_LABELS[ticket.status] ?? ticket.status}
                </span>
              </td>
              <td className="col-secondary">{formatDate(ticket.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
