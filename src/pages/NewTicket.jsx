import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { createTicket } from '../api/tickets';
import {
  DEPARTMENT_LABELS,
  DEPARTMENT_ORDER,
  URGENCIES,
  URGENCY_LABELS,
  URGENCY_ORDER,
  canCreateTickets,
} from '../../shared/tickets.js';
import AppHeader from '../components/AppHeader';

const EMPTY_FORM = {
  subject: '',
  department: '',
  description: '',
  urgency: URGENCIES.MEDIUM,
};

export default function NewTicket() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Only clients raise tickets. The route guard admits any signed-in user
  // because /tickets is shared, so the exact-role check lives here.
  if (!canCreateTickets(user.role)) {
    return <Navigate to="/tickets" replace />;
  }

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError(null);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const ticket = await createTicket(form);
      navigate(`/tickets/${ticket.id}`, { replace: true });
    } catch (err) {
      setError({ message: err.message, field: err.field });
      setSubmitting(false);
    }
  }

  return (
    <div className="app-layout">
      <AppHeader title="Raise a ticket" backTo="/tickets" />

      <main className="app-main app-main-form">
        <section className="panel">
          <p className="muted panel-intro">
            This goes to your agency. Give them enough detail to start without having to
            come back and ask.
          </p>

          <form className="stack-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <p className="alert" role="alert">
                {error.message}
              </p>
            )}

            <label className="field" htmlFor="subject">
              <span>Subject</span>
              <input
                id="subject"
                name="subject"
                type="text"
                value={form.subject}
                onChange={update('subject')}
                aria-invalid={error?.field === 'subject' || undefined}
                maxLength={150}
                required
              />
              <small className="hint">One line describing the problem.</small>
            </label>

            <label className="field" htmlFor="department">
              <span>Department</span>
              <select
                id="department"
                name="department"
                value={form.department}
                onChange={update('department')}
                aria-invalid={error?.field === 'department' || undefined}
                required
              >
                <option value="">Select a department…</option>
                {DEPARTMENT_ORDER.map((department) => (
                  <option key={department} value={department}>
                    {DEPARTMENT_LABELS[department]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field" htmlFor="urgency">
              <span>Urgency</span>
              <select
                id="urgency"
                name="urgency"
                value={form.urgency}
                onChange={update('urgency')}
                aria-invalid={error?.field === 'urgency' || undefined}
                required
              >
                {URGENCY_ORDER.map((urgency) => (
                  <option key={urgency} value={urgency}>
                    {URGENCY_LABELS[urgency]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field" htmlFor="description">
              <span>Description</span>
              <textarea
                id="description"
                name="description"
                rows={6}
                value={form.description}
                onChange={update('description')}
                aria-invalid={error?.field === 'description' || undefined}
                required
              />
              <small className="hint">
                What happened, what you expected, and anything you have already tried.
              </small>
            </label>

            <button className="button" type="submit" disabled={submitting}>
              {submitting ? 'Raising…' : 'Raise ticket'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
