import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listChildAccounts } from '../api/auth';
import {
  listAgencyTickets,
  listEscalatedTickets,
  listMyTickets,
  listTicketsForAgency,
} from '../api/tickets';
import { ROLES, canCreateAccounts } from '../../shared/roles.js';
import { isArchived } from '../../shared/tickets.js';
import useAsync from '../lib/useAsync';
import AsyncBoundary from '../components/AsyncBoundary';
import TicketTable from '../components/TicketTable';
import TicketSummary from '../components/TicketSummary';
import AppHeader from '../components/AppHeader';

/*
 * Work queues refresh themselves so an unread badge turns up without anyone
 * reloading. Slower than the conversation's ten seconds — a reply landing on a
 * list you are scanning is not as urgent as one landing in a thread you are
 * reading, and this fetches every ticket rather than one.
 *
 * "Browse by agency" deliberately does not poll: it is an ad-hoc oversight
 * query an admin runs on purpose, not a queue they sit in front of.
 */
const LIST_POLL_MS = 30_000;

/**
 * Open / Resolved, as a filter rather than two nav destinations.
 *
 * Small screens only: desktop keeps the collapsed archive underneath the table,
 * which already reads as "same list, sub-view". This is that idea in a shape
 * that survives having no room for a disclosure.
 *
 * Both counts are always shown, so you can see there *is* resolved work without
 * navigating to find out — the thing two identical nav links could never do.
 */
function ViewFilter({ openCount, resolvedCount, resolvedView }) {
  const segment = (to, label, count, current) => (
    <Link
      to={to}
      className={`view-filter-option${current ? ' view-filter-option-current' : ''}`}
      aria-current={current ? 'page' : undefined}
    >
      {label} <span className="view-filter-count">{count}</span>
    </Link>
  );

  return (
    <div className="view-filter narrow-only" role="group" aria-label="Show">
      {segment('/tickets', 'Open', openCount, !resolvedView)}
      {segment('/tickets?view=resolved', 'Resolved', resolvedCount, resolvedView)}
    </div>
  );
}

/**
 * Counts plus the table — every list on this page shows both.
 *
 * Resolved tickets drop into a collapsed archive rather than disappearing.
 * A client who thinks the problem *isn't* actually fixed still needs to reach
 * the ticket to say so, and hiding it outright would strand them.
 *
 * The split happens here, after the fetch, rather than in the API on purpose:
 * TicketSummary derives every count from the list it is handed, so a server
 * that filtered resolved tickets out would leave its Resolved tile reading 0
 * forever. It keeps the whole list; only the tables are split.
 */
function TicketResults({
  tickets,
  showClient = false,
  resolvedView = false,
  showViewFilter = false,
}) {
  const { active, archived } = useMemo(
    () => ({
      active: tickets.filter((ticket) => !isArchived(ticket)),
      archived: tickets.filter(isArchived),
    }),
    [tickets]
  );

  const filter = showViewFilter ? (
    <ViewFilter
      openCount={active.length}
      resolvedCount={archived.length}
      resolvedView={resolvedView}
    />
  ) : null;

  // The resolved half of the filter, which only exists below 900px.
  if (resolvedView) {
    return (
      <>
        {filter}
        <TicketSummary tickets={tickets} />

        {archived.length > 0 ? (
          <TicketTable tickets={archived} showClient={showClient} />
        ) : (
          <p className="muted">Nothing has been resolved here yet.</p>
        )}
      </>
    );
  }

  return (
    <>
      {filter}
      <TicketSummary tickets={tickets} />

      {active.length > 0 ? (
        <TicketTable tickets={active} showClient={showClient} />
      ) : (
        <p className="muted">Nothing outstanding — everything here has been resolved.</p>
      )}

      {archived.length > 0 && (
        <details className="archive wide-only">
          <summary>Resolved ({archived.length})</summary>
          <TicketTable tickets={archived} showClient={showClient} />
        </details>
      )}
    </>
  );
}

function ClientTickets({ resolvedView }) {
  const task = useCallback(() => listMyTickets(), []);
  const state = useAsync(task, { pollMs: LIST_POLL_MS });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{resolvedView ? 'Your resolved tickets' : 'Your tickets'}</h2>
        {/* The menu carries this on a phone, so the page doesn't repeat it. */}
        <Link className="button wide-only" to="/tickets/new">
          Raise a ticket
        </Link>
      </div>

      <AsyncBoundary
        state={state}
        empty={
          /*
           * The link is inline rather than pointing at the button above, which
           * is hidden on a phone. An empty state has to carry its own call to
           * action at every width.
           */
          <p className="muted">
            You haven&apos;t raised any tickets yet.{' '}
            <Link to="/tickets/new">Raise a ticket</Link> and your agency will pick it up.
          </p>
        }
      >
        {(tickets) => (
          <TicketResults tickets={tickets} resolvedView={resolvedView} showViewFilter />
        )}
      </AsyncBoundary>
    </section>
  );
}

function AgencyTickets({ resolvedView }) {
  const task = useCallback(() => listAgencyTickets(), []);
  const state = useAsync(task, { pollMs: LIST_POLL_MS });

  return (
    <section className="panel">
      <h2>{resolvedView ? 'Resolved client tickets' : 'Client tickets'}</h2>
      <p className="muted panel-intro">
        Everything raised by your clients. Open one to change its status, or escalate it to
        your admin if you can&apos;t resolve it.
      </p>

      <AsyncBoundary
        state={state}
        empty={
          <p className="muted">
            None of your clients have raised a ticket yet. They&apos;ll appear here as soon
            as they do.
          </p>
        }
      >
        {(tickets) => (
          <TicketResults tickets={tickets} showClient resolvedView={resolvedView} showViewFilter />
        )}
      </AsyncBoundary>
    </section>
  );
}

function AdminTickets({ resolvedView }) {
  const escalatedTask = useCallback(() => listEscalatedTickets(), []);
  const escalated = useAsync(escalatedTask, { pollMs: LIST_POLL_MS });

  // GET /accounts returns an admin's agencies *and* the clients beneath them,
  // so this has to narrow it — otherwise clients show up as pickable agencies.
  // Filtered inside the task rather than at render, so `empty` still means
  // "no agencies" rather than "no accounts of any kind".
  const agenciesTask = useCallback(
    async () => (await listChildAccounts()).filter((account) => account.role === ROLES.AGENCY),
    []
  );
  const agencies = useAsync(agenciesTask);

  /*
   * The chosen agency lives in the URL, not in component state.
   *
   * Opening a ticket unmounts this page, so component state would be gone by
   * the time the admin came back and they would have to pick the agency again
   * after every ticket. In the URL the selection survives both the browser's
   * back button and the page's own "Back to tickets" link, and a filtered view
   * becomes something you can link someone to.
   *
   * `replace` so that changing the picker does not stack a history entry per
   * selection — going back should leave the list, not step through the
   * agencies you tried.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const agencyId = searchParams.get('agency') ?? '';
  const chooseAgency = (value) =>
    setSearchParams(value ? { agency: value } : {}, { replace: true });

  // Only fires once an agency is picked; until then the panel sits idle rather
  // than fetching something nobody asked for.
  const agencyTicketsTask = useCallback(() => listTicketsForAgency(agencyId), [agencyId]);
  const agencyTickets = useAsync(agencyTicketsTask, { enabled: Boolean(agencyId) });

  return (
    <>
      <section className="panel">
        <h2>Escalated to you</h2>
        <p className="muted panel-intro">
          Tickets an agency could not resolve. They keep working them too — escalating asks
          for help, it doesn&apos;t hand the ticket over.
        </p>

        <AsyncBoundary
          state={escalated}
          empty={<p className="muted">Nothing has been escalated to you. </p>}
        >
          {(tickets) => (
            <TicketResults
              tickets={tickets}
              showClient
              resolvedView={resolvedView}
              showViewFilter
            />
          )}
        </AsyncBoundary>
      </section>

      <section className="panel">
        <h2>Browse by agency</h2>

        <AsyncBoundary
          state={agencies}
          loadingLabel="Loading agencies…"
          empty={
            <p className="muted">
              You have no agency accounts yet. Create one from{' '}
              <Link to="/accounts">Accounts</Link> before there are tickets to browse.
            </p>
          }
        >
          {(list) => (
            <>
              <label className="field field-inline" htmlFor="agencyId">
                <span>Agency</span>
                <select
                  id="agencyId"
                  name="agencyId"
                  value={agencyId}
                  onChange={(event) => chooseAgency(event.target.value)}
                >
                  <option value="">Select an agency…</option>
                  {list.map((agency) => (
                    <option key={agency.id} value={agency.id}>
                      {agency.fullName} ({agency.email})
                    </option>
                  ))}
                </select>
              </label>

              {agencyId && (
                <AsyncBoundary
                  state={agencyTickets}
                  empty={<p className="muted">That agency has no tickets yet.</p>}
                >
                  {(tickets) => (
                    <TicketResults tickets={tickets} showClient resolvedView={resolvedView} />
                  )}
                </AsyncBoundary>
              )}
            </>
          )}
        </AsyncBoundary>
      </section>
    </>
  );
}

export default function Tickets() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  /*
   * Resolved work sits in a collapsed section at the foot of the list — that is
   * the desktop design and it stays that way.
   *
   * `?view=resolved` exists for the drawer's Resolved item, because below 900px
   * that section is hidden: a collapsed archive under a full list is a long
   * scroll on a phone. Same tickets, same fetch, different presentation.
   */
  const resolvedView = searchParams.get('view') === 'resolved';

  return (
    <div className="app-layout">
      <AppHeader
        title={resolvedView ? 'Resolved' : 'Tickets'}
        action={
          canCreateAccounts(user.role) && (
            <Link className="button button-ghost" to="/accounts">
              Manage accounts
            </Link>
          )
        }
      />

      <main className="app-main app-main-stack">
        {user.role === ROLES.CLIENT && <ClientTickets resolvedView={resolvedView} />}
        {user.role === ROLES.AGENCY && <AgencyTickets resolvedView={resolvedView} />}
        {user.role === ROLES.ADMIN && <AdminTickets resolvedView={resolvedView} />}
      </main>
    </div>
  );
}
