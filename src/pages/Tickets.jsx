import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listChildAccounts } from '../api/auth';
import {
  listAgencyTickets,
  listEscalatedTickets,
  listMyTickets,
  listTicketsForAgency,
} from '../api/tickets';
import { ROLES, canCreateAccounts } from '../../shared/roles.js';
import useAsync from '../lib/useAsync';
import AsyncBoundary from '../components/AsyncBoundary';
import TicketTable from '../components/TicketTable';
import TicketSummary from '../components/TicketSummary';
import AppHeader from '../components/AppHeader';

/** Counts plus the table — every list on this page shows both. */
function TicketResults({ tickets, showClient = false }) {
  return (
    <>
      <TicketSummary tickets={tickets} />
      <TicketTable tickets={tickets} showClient={showClient} />
    </>
  );
}

function ClientTickets() {
  const task = useCallback(() => listMyTickets(), []);
  const state = useAsync(task);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Your tickets</h2>
        <Link className="button" to="/tickets/new">
          Raise a ticket
        </Link>
      </div>

      <AsyncBoundary
        state={state}
        empty={
          <p className="muted">
            You haven&apos;t raised any tickets yet. Use <strong>Raise a ticket</strong> above
            and your agency will pick it up.
          </p>
        }
      >
        {(tickets) => <TicketResults tickets={tickets} />}
      </AsyncBoundary>
    </section>
  );
}

function AgencyTickets() {
  const task = useCallback(() => listAgencyTickets(), []);
  const state = useAsync(task);

  return (
    <section className="panel">
      <h2>Client tickets</h2>
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
        {(tickets) => <TicketResults tickets={tickets} showClient />}
      </AsyncBoundary>
    </section>
  );
}

function AdminTickets() {
  const escalatedTask = useCallback(() => listEscalatedTickets(), []);
  const escalated = useAsync(escalatedTask);

  // GET /accounts returns an admin's agencies *and* the clients beneath them,
  // so this has to narrow it — otherwise clients show up as pickable agencies.
  // Filtered inside the task rather than at render, so `empty` still means
  // "no agencies" rather than "no accounts of any kind".
  const agenciesTask = useCallback(
    async () => (await listChildAccounts()).filter((account) => account.role === ROLES.AGENCY),
    []
  );
  const agencies = useAsync(agenciesTask);

  const [agencyId, setAgencyId] = useState('');
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
          {(tickets) => <TicketResults tickets={tickets} showClient />}
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
                  onChange={(event) => setAgencyId(event.target.value)}
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
                  {(tickets) => <TicketResults tickets={tickets} showClient />}
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

  return (
    <div className="app-layout">
      <AppHeader
        title="Tickets"
        action={
          canCreateAccounts(user.role) && (
            <Link className="button button-ghost" to="/accounts">
              Manage accounts
            </Link>
          )
        }
      />

      <main className="app-main app-main-stack">
        {user.role === ROLES.CLIENT && <ClientTickets />}
        {user.role === ROLES.AGENCY && <AgencyTickets />}
        {user.role === ROLES.ADMIN && <AdminTickets />}
      </main>
    </div>
  );
}
