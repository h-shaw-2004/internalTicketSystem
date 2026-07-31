import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listTicketMessages, markTicketRead, postTicketMessage } from '../api/tickets';
import { ROLE_LABELS, ROLES } from '../../shared/roles.js';
import {
  MAX_MESSAGE_LENGTH,
  canPostMessage,
  checkMessage,
  isConversationOpen,
  isReopenNotice,
} from '../../shared/tickets.js';
import useAsync from '../lib/useAsync';
import AsyncBoundary from './AsyncBoundary';

/**
 * The conversation on a ticket.
 *
 * Polls rather than holding a socket open: threads are short, the traffic is
 * one small request every ten seconds per open ticket, and it needs no
 * connection handling, no reconnect logic and no server-side state.
 */
const POLL_MS = 10_000;

const formatDateTime = (value) => new Date(value).toLocaleString();

/** Warn only when the remaining allowance gets close enough to matter. */
const COUNTER_VISIBLE_FROM = MAX_MESSAGE_LENGTH - 200;

/**
 * A reopen reason, rendered as an event rather than a reply.
 *
 * The point is that an agency scanning the thread can tell a returning problem
 * from a new one at a glance — a ticket somebody has already worked once is
 * usually a smaller job than it looks.
 */
function ReopenNotice({ message }) {
  return (
    <li className="message message-reopen">
      <div className="message-head">
        <span className="message-event">Reopened this ticket</span>
        <time className="message-time" dateTime={message.createdAt}>
          {formatDateTime(message.createdAt)}
        </time>
      </div>
      <p className="message-byline">
        {message.author?.fullName ?? 'The client'} said the problem was still there:
      </p>
      <p className="message-body">{message.body}</p>
    </li>
  );
}

function Message({ message, isMine }) {
  if (isReopenNotice(message)) return <ReopenNotice message={message} />;

  return (
    <li className={`message${isMine ? ' message-mine' : ''}`}>
      <div className="message-head">
        <span className="message-author">{message.author?.fullName ?? 'Unknown'}</span>
        <span className={`message-role message-role-${message.authorRole}`}>
          {ROLE_LABELS[message.authorRole] ?? message.authorRole}
        </span>
        <time className="message-time" dateTime={message.createdAt}>
          {formatDateTime(message.createdAt)}
        </time>
      </div>
      <p className="message-body">{message.body}</p>
    </li>
  );
}

function Composer({ ticketId, onSent }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const { valid } = checkMessage(body);

  async function send(event) {
    event.preventDefault();

    const checked = checkMessage(body);
    if (!checked.valid) {
      setError(checked.error);
      return;
    }

    setSending(true);
    setError(null);

    try {
      const message = await postTicketMessage(ticketId, checked.body);
      setBody('');
      onSent(message);
      inputRef.current?.focus();
    } catch (err) {
      // The text stays in the box — a failed send must never eat what was typed.
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const remaining = MAX_MESSAGE_LENGTH - body.length;

  return (
    <form className="composer" onSubmit={send}>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <label className="field" htmlFor="message-body">
        <span className="visually-hidden">Message</span>
        <textarea
          id="message-body"
          name="body"
          ref={inputRef}
          rows={3}
          value={body}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Write a message…"
          onChange={(event) => setBody(event.target.value)}
        />
      </label>

      <div className="composer-foot">
        {body.length >= COUNTER_VISIBLE_FROM && (
          <span className="composer-count" role="status">
            {remaining} characters left
          </span>
        )}

        <button className="button" type="submit" disabled={!valid || sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}

/**
 * `reloadKey` lets the page force a refetch when something *outside* the chat
 * writes to the thread — reopening a ticket posts the client's reason as a
 * message, and waiting out the poll to show it would look broken.
 */
export default function TicketChat({ ticket, user, reloadKey = 0 }) {
  // reloadKey is intentionally part of the task identity; that is the refetch.
  const task = useCallback(() => listTicketMessages(ticket.id), [ticket.id, reloadKey]);
  const state = useAsync(task, { pollMs: POLL_MS });
  const { refresh } = state;

  // Messages sent from this tab, shown straight away rather than waiting for
  // the next poll. The next fetch returns them too, so they are merged by id.
  const [sent, setSent] = useState([]);

  const onSent = useCallback(
    (message) => {
      setSent((current) => [...current, message]);
      refresh();
    },
    [refresh]
  );

  const canPost = canPostMessage(user.role, ticket, user.id);

  const merged = useMemo(() => {
    const fetched = Array.isArray(state.data) ? state.data : [];
    const seen = new Set(fetched.map((m) => m.id));
    return [...fetched, ...sent.filter((m) => !seen.has(m.id))].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );
  }, [state.data, sent]);

  /*
   * The boundary always renders the merged list, so `children` is handed an
   * array whatever the fetch returned.
   *
   * AsyncBoundary also renders `empty` *instead of* the children, so a thread
   * whose first message was just sent would otherwise still read "no messages
   * yet" until the poll landed. Anything optimistically appended therefore
   * promotes the state to ready.
   */
  const view = { ...state, data: merged };
  if (merged.length > 0 && (state.status === 'empty' || state.status === 'ready')) {
    view.status = 'ready';
  }

  /*
   * Mark the thread read whenever its newest message changes, not just on
   * mount: a reply that lands while you are sitting here reading it would
   * otherwise still be waiting as an unread badge when you go back to the list.
   *
   * Keyed on the timestamp so a poll that changes nothing costs no request. A
   * failed mark clears the key so the next poll tries again — being briefly
   * marked unread is recoverable, silently never marking read is not.
   */
  const newest = merged.length > 0 ? merged[merged.length - 1].createdAt : null;
  const markedThrough = useRef(null);

  useEffect(() => {
    if (!newest || markedThrough.current === newest) return;

    markedThrough.current = newest;
    markTicketRead(ticket.id).catch(() => {
      markedThrough.current = null;
    });
  }, [newest, ticket.id]);

  return (
    <section className="panel panel-conversation">
      <div className="panel-head">
        <h2>Conversation</h2>
        {state.stale && (
          <span className="muted" role="status">
            Reconnecting…
          </span>
        )}
      </div>

      <AsyncBoundary
        state={view}
        loadingLabel="Loading the conversation…"
        empty={
          <p className="muted">
            {canPost
              ? 'No messages yet. Start the conversation below.'
              : 'No messages yet on this ticket.'}
          </p>
        }
      >
        {(messages) => (
          <ul className="message-list" aria-label="Conversation">
            {messages.map((message) => (
              <Message key={message.id} message={message} isMine={message.authorId === user.id} />
            ))}
          </ul>
        )}
      </AsyncBoundary>

      {canPost && <Composer ticketId={ticket.id} onSent={onSent} />}

      {!canPost && !isConversationOpen(ticket) && (
        <p className="muted composer-locked">
          {user.role === ROLES.CLIENT
            ? 'This ticket is resolved, so the conversation is closed. If the problem is still there, reopen it above and your note goes back to your agency.'
            : 'This ticket is resolved, so the conversation is closed. Set it back to an open status if there is more to do.'}
        </p>
      )}

      {!canPost && isConversationOpen(ticket) && user.role === ROLES.ADMIN && (
        <p className="muted composer-locked">
          This conversation is between the client and their agency. Escalating the ticket to you
          is what brings you into it.
        </p>
      )}
    </section>
  );
}
