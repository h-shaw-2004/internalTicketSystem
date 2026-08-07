import { useCallback, useId, useMemo } from 'react';
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
import {
  DEFAULT_SORT,
  SORT_LABELS,
  SORT_ORDER,
  isArchived,
  isSort,
  sortTickets,
} from '../../shared/tickets.js';
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
 * One query string, three controls writing to it — the sort select, the
 * Open/Resolved tabs and the admin's agency picker.
 *
 * Every one of them merges into what is already there rather than handing
 * `setSearchParams` a fresh object. Replacing wholesale is how picking an agency
 * silently reset the sort, and how switching to Resolved dropped the agency.
 *
 * An empty value removes the key, so a default never appears in the URL.
 */
function withParam(params, key, value) {
  const next = new URLSearchParams(params);

  if (value) next.set(key, value);
  else next.delete(key);

  return next;
}

/** The sort in force, falling back to the default for anything hand-typed. */
const readSort = (params) => {
  const value = params.get('sort');
  return isSort(value) ? value : DEFAULT_SORT;
};

/**
 * How the list is ordered. A select rather than sortable column headers,
 * because below 640px there are no columns left to click — the table narrows to
 * subject alone — and two controls that have to agree with each other is the
 * trade `backTo` already refused elsewhere.
 *
 * It writes to the URL like every other view choice on this page, so an order
 * survives opening a ticket and coming back (TicketTable hands the detail page
 * the full path *and* query as `location.state.from`) and a sorted list is
 * something you can send to someone.
 *
 * `useId` because an admin's page renders two of these, one per panel. They
 * share the query param on purpose: it is a preference about how you read
 * ticket lists, not a property of one list, so both tables answer to it.
 */
function TicketSort({ sort, onChange }) {
  const id = useId();

  return (
    <div className="list-tools">
      <label className="field field-row" htmlFor={id}>
        <span>Sort</span>
        <select id={id} value={sort} onChange={(event) => onChange(event.target.value)}>
          {SORT_ORDER.map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

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
  const [searchParams] = useSearchParams();

  // Switching halves keeps the sort — and, for an admin on a phone, the chosen
  // agency. Only `view` changes.
  const segment = (view, label, count, current) => {
    const search = withParam(searchParams, 'view', view).toString();

    return (
      <Link
        to={{ pathname: '/tickets', search: search ? `?${search}` : '' }}
        className={`view-filter-option${current ? ' view-filter-option-current' : ''}`}
        aria-current={current ? 'page' : undefined}
      >
        {label} <span className="view-filter-count">{count}</span>
      </Link>
    );
  };

  return (
    <div className="view-filter narrow-only" role="group" aria-label="Show">
      {segment('', 'Open', openCount, !resolvedView)}
      {segment('resolved', 'Resolved', resolvedCount, resolvedView)}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = readSort(searchParams);

  /*
   * Sorted once, then split. Both tables inherit the order, so the archive is
   * read the same way as the list above it.
   *
   * TicketSummary is still handed the unsplit, unfiltered `tickets` — its
   * counts describe the whole queue, and a sort cannot change them.
   */
  const { active, archived } = useMemo(() => {
    const sorted = sortTickets(tickets, sort);

    return {
      active: sorted.filter((ticket) => !isArchived(ticket)),
      archived: sorted.filter(isArchived),
    };
  }, [tickets, sort]);

  const chooseSort = (value) =>
    setSearchParams(withParam(searchParams, 'sort', value === DEFAULT_SORT ? '' : value), {
      // Trying three orderings should not leave three entries to step back
      // through, exactly as with the agency picker.
      replace: true,
    });

  const filter = showViewFilter ? (
    <ViewFilter
      openCount={active.length}
      resolvedCount={archived.length}
      resolvedView={resolvedView}
    />
  ) : null;

  const tools = <TicketSort sort={sort} onChange={chooseSort} />;

  /*
   * A control that cannot change anything is noise, so it appears only once
   * something it governs has two rows to put in an order.
   *
   * Asked per view rather than of the whole list, because the two views govern
   * different tables: the resolved view shows the archive alone, while the
   * default view's one control orders the active table *and* the archive
   * collapsed underneath it. Counting the whole list put a sort control over a
   * single resolved row; counting only the visible table would leave a long
   * archive unsortable whenever the active list happened to be short.
   */
  const sortable = (...lists) => lists.some((list) => list.length > 1);

  // The resolved half of the filter, which only exists below 900px.
  if (resolvedView) {
    return (
      <>
        {filter}
        <TicketSummary tickets={tickets} />

        {archived.length > 0 ? (
          <>
            {sortable(archived) && tools}
            {/* Keyed on the sort so re-ordering replays the table's entrance —
                see the note in TicketTable. */}
            <TicketTable key={sort} tickets={archived} showClient={showClient} />
          </>
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

      {/*
       * Outside the branch below, because it governs the archive too — a client
       * whose work is all resolved would otherwise have no way to order it.
       */}
      {sortable(active, archived) && tools}

      {active.length > 0 ? (
        <TicketTable key={sort} tickets={active} showClient={showClient} />
      ) : (
        <p className="muted">Nothing outstanding — everything here has been resolved.</p>
      )}

      {archived.length > 0 && (
        <details className="archive wide-only">
          <summary>Resolved ({archived.length})</summary>
          <TicketTable key={sort} tickets={archived} showClient={showClient} />
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
  // Merged rather than replaced: this used to hand over a fresh object, which
  // now would throw away the sort every time an agency was picked.
  const chooseAgency = (value) =>
    setSearchParams(withParam(searchParams, 'agency', value), { replace: true });

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
