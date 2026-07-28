import { Link, useNavigate } from 'react-router-dom';
import { DEPARTMENT_LABELS, STATUS_LABELS, URGENCY_LABELS } from '../../shared/tickets.js';
import { clickableRow } from '../lib/clickableRow';

const formatDate = (value) => new Date(value).toLocaleDateString();

/**
 * Shared summary table. `showClient` is off for a client's own list, where every
 * row would name them.
 */
export default function TicketTable({ tickets, showClient = false }) {
  const navigate = useNavigate();

  return (
    <div className="table-scroll">
      <table className="account-table">
        <thead>
          <tr>
            <th scope="col">Subject</th>
            {showClient && <th scope="col">Client</th>}
            <th scope="col">Department</th>
            <th scope="col">Urgency</th>
            <th scope="col">Status</th>
            <th scope="col">Raised</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id} {...clickableRow(() => navigate(`/tickets/${ticket.id}`))}>
              <td>
                <Link to={`/tickets/${ticket.id}`}>{ticket.subject}</Link>
                {ticket.escalatedAt && (
                  <span className="badge badge-escalated" title="Escalated to admin">
                    Escalated
                  </span>
                )}
              </td>
              {showClient && <td>{ticket.client?.fullName ?? '—'}</td>}
              <td>{DEPARTMENT_LABELS[ticket.department] ?? ticket.department}</td>
              <td>
                <span className={`urgency urgency-${ticket.urgency}`}>
                  {URGENCY_LABELS[ticket.urgency] ?? ticket.urgency}
                </span>
              </td>
              <td>
                <span className={`status status-${ticket.status.replace(/_/g, '-')}`}>
                  {STATUS_LABELS[ticket.status] ?? ticket.status}
                </span>
              </td>
              <td>{formatDate(ticket.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
