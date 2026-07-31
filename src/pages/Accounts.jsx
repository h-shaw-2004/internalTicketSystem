import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createAccount, listChildAccounts } from '../api/auth';
import {
  ROLES,
  ROLE_LABELS,
  creatableRoles,
  needsAgencyChoice,
} from '../../shared/roles.js';
import AppHeader from '../components/AppHeader';
import { clickableRow } from '../lib/clickableRow';

const formatDate = (value) => new Date(value).toLocaleDateString();

function StatusChip({ account }) {
  return account.mustChangePassword ? (
    <span className="status status-pending">Password not set</span>
  ) : (
    <span className="status status-active">Active</span>
  );
}

/**
 * Copies one credential to the clipboard.
 *
 * The temporary password crosses the API exactly once and is never recoverable,
 * so the handover is the one moment that matters — retyping a generated
 * password by hand is where it goes wrong.
 *
 * The callout around this is already `role="status"`, so the label changing to
 * "Copied" is announced without adding a second live region.
 */
function CopyButton({ value, label }) {
  const [state, setState] = useState('idle');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);

    try {
      // The Clipboard API needs a secure context, so being absent is a normal
      // outcome rather than a bug — the value stays selectable either way.
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');

      await navigator.clipboard.writeText(value);
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  }

  const text = { idle: 'Copy', copied: 'Copied', failed: 'Select it instead' }[state];

  return (
    <button type="button" className="copy-button" onClick={copy}>
      {text}
      <span className="visually-hidden"> {label}</span>
    </button>
  );
}

/** Plain list of accounts of a single kind — no type or parent column needed. */
function AccountTable({ accounts }) {
  return (
    <div className="table-scroll">
      <table className="account-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            {/*
             * Email is the widest column and the one that cannot be dropped —
             * it is the account's identity. On a phone it moves under the name
             * instead, which removes the column without losing anything.
             */}
            <th scope="col" className="col-secondary">
              Email
            </th>
            <th scope="col">Status</th>
            <th scope="col" className="col-secondary">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td>
                {account.fullName}
                <span className="cell-sub">{account.email}</span>
              </td>
              <td className="col-secondary">{account.email}</td>
              <td>
                <StatusChip account={account} />
              </td>
              <td className="col-secondary">{formatDate(account.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Account management.
 *
 * An agency creates clients and the role is implied. An admin creates agencies
 * *or* clients, and a client's parent must be an agency — so making one means
 * naming which of the admin's agencies it belongs to.
 */
export default function Accounts() {
  const { user } = useAuth();
  const allowedRoles = creatableRoles(user.role);
  const canChooseRole = allowedRoles.length > 1;
  const isAdmin = user.role === ROLES.ADMIN;

  const emptyForm = useMemo(
    () => ({ fullName: '', email: '', role: allowedRoles[0] ?? '', agencyId: '' }),
    [allowedRoles]
  );

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  // The generated password, held only until the next creation or a reload.
  // Nothing can retrieve it again, so the creator has to pass it on now.
  const [issued, setIssued] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await listChildAccounts());
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // One fetch returns both levels for an admin, so the split happens here
  // rather than in another request.
  const agencies = accounts.filter((account) => account.role === ROLES.AGENCY);
  const clientsByAgency = accounts
    .filter((account) => account.role === ROLES.CLIENT)
    .reduce((map, client) => {
      map.set(client.parentId, [...(map.get(client.parentId) ?? []), client]);
      return map;
    }, new Map());

  // Which agency's clients are open. Admins only — an agency's list is flat.
  const [openAgencyId, setOpenAgencyId] = useState(null);
  const openAgency = agencies.find((agency) => agency.id === openAgencyId) ?? null;

  const mustPickAgency = needsAgencyChoice(user.role, form.role);

  const update = (field) => (event) => {
    const { value } = event.target;
    setForm((current) => ({
      ...current,
      [field]: value,
      // Switching away from client drops a stale agency choice.
      ...(field === 'role' && value !== ROLES.CLIENT ? { agencyId: '' } : {}),
    }));
    setError(null);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setIssued(null);

    try {
      const { account, temporaryPassword } = await createAccount(form);
      setForm(emptyForm);
      setIssued({ email: account.email, password: temporaryPassword, role: account.role });
      // Open the agency a new client landed under, so it is visible immediately
      // rather than hidden one click away.
      if (account.role === ROLES.CLIENT && account.parentId) {
        setOpenAgencyId(account.parentId);
      }
      await refresh();
    } catch (err) {
      setError({ message: err.message, field: err.field });
    } finally {
      setSubmitting(false);
    }
  }

  // The route guard already keeps clients out; this is the belt to its braces.
  if (allowedRoles.length === 0) {
    return (
      <div className="app-layout">
        <main className="app-main">
          <p className="alert" role="alert">
            Your account type cannot create other accounts.
          </p>
        </main>
      </div>
    );
  }

  const targetLabel = ROLE_LABELS[form.role]?.toLowerCase() ?? 'account';
  const heading = canChooseRole ? 'New account' : `New ${targetLabel} account`;
  // Fixed, unlike the form heading — it must not change as the type selector moves.
  const listHeading = isAdmin ? 'Your agencies' : `Your ${targetLabel} accounts`;

  return (
    <div className="app-layout">
      <AppHeader title="Accounts" backTo="/tickets" />

      <main className="app-main app-main-stack">
        <section className="panel">
          <h2>{heading}</h2>
          <p className="muted panel-intro">
            A temporary password is generated for them. They must replace it the first
            time they sign in, so you never learn the password they end up using.
          </p>

          <form className="stack-form" onSubmit={handleSubmit} noValidate>
            {issued && (
              <div className="notice credential-callout" role="status">
                <p className="credential-lead">
                  {ROLE_LABELS[issued.role]} account created. Pass these on now — the
                  password is not shown again.
                </p>
                <dl className="credential-list">
                  <dt>Email</dt>
                  <dd>
                    <code>{issued.email}</code>
                    <CopyButton value={issued.email} label="email" />
                  </dd>
                  <dt>Temporary password</dt>
                  <dd>
                    <code>{issued.password}</code>
                    <CopyButton value={issued.password} label="temporary password" />
                  </dd>
                </dl>
              </div>
            )}

            {error && (
              <p className="alert" role="alert">
                {error.message}
              </p>
            )}

            {canChooseRole && (
              <label className="field" htmlFor="role">
                <span>Account type</span>
                <select
                  id="role"
                  name="role"
                  value={form.role}
                  onChange={update('role')}
                  aria-invalid={error?.field === 'role' || undefined}
                  required
                >
                  {allowedRoles.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {mustPickAgency && (
              /* The hint sits outside the label and is linked with
                 aria-describedby — inside, it would become part of the field's
                 accessible name ("Agency Clients belong to an agency…"). */
              <div className="field">
                <label className="field-label" htmlFor="agencyId">
                  Agency
                </label>
                <select
                  id="agencyId"
                  name="agencyId"
                  value={form.agencyId}
                  onChange={update('agencyId')}
                  aria-invalid={error?.field === 'agencyId' || undefined}
                  aria-describedby="agencyId-hint"
                  required
                >
                  <option value="">Select an agency…</option>
                  {agencies.map((agency) => (
                    <option key={agency.id} value={agency.id}>
                      {agency.fullName} ({agency.email})
                    </option>
                  ))}
                </select>
                <small className="hint" id="agencyId-hint">
                  {agencies.length === 0
                    ? 'Create an agency first — a client has to belong to one.'
                    : 'Clients belong to an agency, not directly to you.'}
                </small>
              </div>
            )}

            <label className="field" htmlFor="fullName">
              <span>Full name</span>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="off"
                value={form.fullName}
                onChange={update('fullName')}
                aria-invalid={error?.field === 'fullName' || undefined}
                required
              />
            </label>

            <label className="field" htmlFor="email">
              <span>Email</span>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={update('email')}
                aria-invalid={error?.field === 'email' || undefined}
                required
              />
            </label>

            <button
              className="button"
              type="submit"
              disabled={submitting || (mustPickAgency && agencies.length === 0)}
            >
              {submitting ? 'Creating…' : `Create ${targetLabel} account`}
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>{listHeading}</h2>

          {loading && <p className="muted">Loading…</p>}

          {loadError && (
            <p className="alert" role="alert">
              {loadError}
            </p>
          )}

          {!loading && !loadError && accounts.length === 0 && (
            <p className="muted">
              {isAdmin
                ? 'No agencies yet. Create one above to get started.'
                : `No ${targetLabel} accounts yet.`}
            </p>
          )}

          {/*
           * An admin sees only its agencies here; a client lives under an
           * agency, so it belongs one level in rather than in the same list. A
           * flat table would repeat "belongs to <you>" on every agency row and
           * mix two levels that have an obvious hierarchy.
           */}
          {isAdmin && agencies.length > 0 && (
            <div className="table-scroll">
              <table className="account-table">
                <thead>
                  <tr>
                    <th scope="col">Agency</th>
                    <th scope="col" className="col-secondary">
                      Email
                    </th>
                    <th scope="col">Clients</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="col-secondary">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agencies.map((agency) => {
                    const clients = clientsByAgency.get(agency.id) ?? [];
                    const open = agency.id === openAgencyId;

                    return (
                      <tr
                        key={agency.id}
                        aria-selected={open || undefined}
                        {...clickableRow(() => setOpenAgencyId(open ? null : agency.id))}
                      >
                        <td>
                          <button
                            type="button"
                            className="link-button"
                            aria-expanded={open}
                            onClick={() => setOpenAgencyId(open ? null : agency.id)}
                          >
                            {agency.fullName}
                          </button>
                          <span className="cell-sub">{agency.email}</span>
                        </td>
                        <td className="col-secondary">{agency.email}</td>
                        <td>{clients.length}</td>
                        <td>
                          <StatusChip account={agency} />
                        </td>
                        <td className="col-secondary">{formatDate(agency.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isAdmin && accounts.length > 0 && <AccountTable accounts={accounts} />}
        </section>

        {isAdmin && openAgency && (
          <section className="panel">
            <div className="panel-head">
              <h2>Clients of {openAgency.fullName}</h2>
              <button
                type="button"
                className="link-button"
                onClick={() => setOpenAgencyId(null)}
              >
                Close
              </button>
            </div>

            {(clientsByAgency.get(openAgency.id) ?? []).length === 0 ? (
              <p className="muted">
                {openAgency.fullName} has no clients yet. Create one above and assign it to
                them.
              </p>
            ) : (
              <AccountTable accounts={clientsByAgency.get(openAgency.id)} />
            )}
          </section>
        )}
      </main>
    </div>
  );
}
