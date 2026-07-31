import { STATUS_LABELS, STATUS_ORDER, hasOpenEscalation } from '../../shared/tickets.js';

/**
 * At-a-glance counts above a ticket list.
 *
 * Deliberately not a chart: five independent magnitudes with no trend and no
 * part-to-whole story read faster as numbers than as bars.
 *
 * Colour repeats the status badge used in the table so the two agree, but it is
 * carried by a small mark rather than the text — every tile is labelled, so
 * identity never depends on colour alone. Counts are derived from the tickets
 * already fetched, so this costs no extra request.
 */
export default function TicketSummary({ tickets }) {
  const byStatus = STATUS_ORDER.map((status) => ({
    key: status,
    label: STATUS_LABELS[status],
    count: tickets.filter((ticket) => ticket.status === status).length,
  }));

  const tiles = [
    ...byStatus,
    {
      key: 'escalated',
      label: 'Escalated',
      /*
       * Outstanding escalations, not every escalation that ever happened.
       * The status tiles above are a snapshot of where work sits, and this one
       * reads the same way — in red — so counting resolved tickets here would
       * claim an admin still owed something on work that is finished.
       */
      count: tickets.filter(hasOpenEscalation).length,
      markClass: 'badge-escalated',
    },
  ];

  return (
    <dl className="summary-row" aria-label="Ticket counts">
      {tiles.map(({ key, label, count, markClass }) => (
        <div className="summary-tile" key={key}>
          <dt>
            <span
              className={`summary-mark ${markClass ?? `status-${key.replace(/_/g, '-')}`}`}
              aria-hidden="true"
            />
            {label}
          </dt>
          <dd>{count}</dd>
        </div>
      ))}
    </dl>
  );
}
