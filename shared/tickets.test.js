import { describe, expect, it } from 'vitest';
import { ROLES } from './roles.js';
import {
  DEPARTMENT_LABELS,
  DEPARTMENT_ORDER,
  MAX_MESSAGE_LENGTH,
  MESSAGE_KINDS,
  STATUS_LABELS,
  STATUS_ORDER,
  TICKET_STATUSES,
  URGENCY_LABELS,
  URGENCY_ORDER,
  canCreateTickets,
  canEscalate,
  canManageTickets,
  canPostMessage,
  canReopen,
  checkMessage,
  hasOpenEscalation,
  isArchived,
  isConversationOpen,
  isDepartment,
  isReopenNotice,
  isReopened,
  isStatus,
  isUrgency,
} from './tickets.js';

describe('ticket vocabulary', () => {
  it('gives every value a label', () => {
    for (const [order, labels] of [
      [STATUS_ORDER, STATUS_LABELS],
      [DEPARTMENT_ORDER, DEPARTMENT_LABELS],
      [URGENCY_ORDER, URGENCY_LABELS],
    ]) {
      for (const value of order) {
        expect(labels[value]).toBeTruthy();
      }
    }
  });

  it('lists exactly the five statuses the brief names', () => {
    expect(STATUS_ORDER).toEqual([
      'open',
      'in_progress',
      'with_client',
      'on_hold',
      'resolved',
    ]);
    expect(Object.values(TICKET_STATUSES).sort()).toEqual([...STATUS_ORDER].sort());
  });

  it('rejects values outside each set', () => {
    expect(isStatus('open')).toBe(true);
    expect(isStatus('closed')).toBe(false);
    expect(isDepartment('network')).toBe(true);
    expect(isDepartment('catering')).toBe(false);
    expect(isUrgency('critical')).toBe(true);
    expect(isUrgency('whenever')).toBe(false);
    expect(isStatus(undefined)).toBe(false);
  });
});

describe('ticket permissions', () => {
  it('lets only clients raise tickets', () => {
    expect(canCreateTickets(ROLES.CLIENT)).toBe(true);
    expect(canCreateTickets(ROLES.AGENCY)).toBe(false);
    expect(canCreateTickets(ROLES.ADMIN)).toBe(false);
  });

  it('lets agencies and admins work them', () => {
    expect(canManageTickets(ROLES.AGENCY)).toBe(true);
    expect(canManageTickets(ROLES.ADMIN)).toBe(true);
    expect(canManageTickets(ROLES.CLIENT)).toBe(false);
  });

  describe('escalation', () => {
    const fresh = { escalatedAt: null };
    const already = { escalatedAt: '2026-07-28T10:00:00.000Z' };

    it('is an agency action only', () => {
      expect(canEscalate(ROLES.AGENCY, fresh)).toBe(true);
      expect(canEscalate(ROLES.CLIENT, fresh)).toBe(false);
      // An admin is the top of the tree — nobody to escalate to.
      expect(canEscalate(ROLES.ADMIN, fresh)).toBe(false);
    });

    it('cannot happen twice', () => {
      expect(canEscalate(ROLES.AGENCY, already)).toBe(false);
    });
  });

  describe('reopening', () => {
    const resolved = { clientId: 'client-1', status: 'resolved' };

    it('is the raising client\'s call, on a resolved ticket', () => {
      expect(canReopen(ROLES.CLIENT, resolved, 'client-1')).toBe(true);
    });

    it('is not open to another client', () => {
      expect(canReopen(ROLES.CLIENT, resolved, 'client-2')).toBe(false);
    });

    it('is not open to the agency or admin, who can just set the status', () => {
      expect(canReopen(ROLES.AGENCY, resolved, 'client-1')).toBe(false);
      expect(canReopen(ROLES.ADMIN, resolved, 'client-1')).toBe(false);
    });

    it('needs something to refuse', () => {
      for (const status of ['open', 'in_progress', 'with_client', 'on_hold']) {
        expect(canReopen(ROLES.CLIENT, { ...resolved, status }, 'client-1')).toBe(false);
      }
    });

    it('has no limit — a problem can genuinely come back twice', () => {
      // Nothing in the predicate counts previous reopens, unlike canEscalate.
      expect(canReopen(ROLES.CLIENT, resolved, 'client-1')).toBe(true);
      expect(canReopen(ROLES.CLIENT, { ...resolved }, 'client-1')).toBe(true);
    });
  });
});

describe('archiving', () => {
  it('archives a resolved ticket', () => {
    expect(isArchived({ status: 'resolved', unreadCount: 0 })).toBe(true);
  });

  it('leaves every other status active', () => {
    for (const status of ['open', 'in_progress', 'with_client', 'on_hold']) {
      expect(isArchived({ status, unreadCount: 0 })).toBe(false);
    }
  });

  it('keeps a resolved ticket out of the archive while a reply is unread', () => {
    // Otherwise resolving something buries the conversation on it.
    expect(isArchived({ status: 'resolved', unreadCount: 2 })).toBe(false);
  });

  it('copes with a ticket that carries no count at all', () => {
    expect(isArchived({ status: 'resolved' })).toBe(true);
    expect(isArchived(null)).toBe(false);
  });
});

describe('outstanding escalation', () => {
  const escalatedAt = '2026-07-28T11:00:00.000Z';

  it('counts an escalated ticket that is still being worked', () => {
    expect(hasOpenEscalation({ escalatedAt, status: 'in_progress' })).toBe(true);
  });

  it('stops counting once the ticket is resolved', () => {
    // escalated_at is never cleared, so the raw field stays true forever and
    // would keep a finished ticket in a red count.
    expect(hasOpenEscalation({ escalatedAt, status: 'resolved' })).toBe(false);
  });

  it('counts it again if the client reopens it', () => {
    expect(hasOpenEscalation({ escalatedAt, status: 'open' })).toBe(true);
  });

  it('ignores tickets that were never escalated', () => {
    expect(hasOpenEscalation({ escalatedAt: null, status: 'open' })).toBe(false);
    expect(hasOpenEscalation(null)).toBe(false);
  });
});

describe('reopened tickets', () => {
  const reopenedAt = '2026-07-29T09:00:00.000Z';

  it('flags a ticket that came back and is being worked again', () => {
    expect(isReopened({ reopenedAt, status: 'open' })).toBe(true);
    expect(isReopened({ reopenedAt, status: 'in_progress' })).toBe(true);
  });

  it('stops flagging it once it is resolved again', () => {
    // reopened_at is never cleared, like escalated_at.
    expect(isReopened({ reopenedAt, status: 'resolved' })).toBe(false);
  });

  it('leaves a ticket nobody has reopened alone', () => {
    expect(isReopened({ reopenedAt: null, status: 'open' })).toBe(false);
    expect(isReopened(null)).toBe(false);
  });

  it('marks a reopen reason as an event rather than a reply', () => {
    expect(isReopenNotice({ kind: 'reopen' })).toBe(true);
    expect(isReopenNotice({ kind: 'message' })).toBe(false);
    expect(isReopenNotice({})).toBe(false);
    expect(isReopenNotice(null)).toBe(false);
  });

  it('keeps MESSAGE_KINDS in step with the check constraint in schema.sql', () => {
    expect(Object.values(MESSAGE_KINDS).sort()).toEqual(['message', 'reopen']);
  });
});

describe('messages', () => {
  describe('checkMessage', () => {
    it('accepts ordinary text and hands back the trimmed body', () => {
      expect(checkMessage('  Have you tried a hard reset?  ')).toEqual({
        valid: true,
        body: 'Have you tried a hard reset?',
        error: null,
      });
    });

    it('rejects empty and whitespace-only bodies', () => {
      expect(checkMessage('').valid).toBe(false);
      expect(checkMessage('   \n  ').valid).toBe(false);
      expect(checkMessage(null).valid).toBe(false);
      expect(checkMessage(undefined).valid).toBe(false);
    });

    it('rejects a body over the limit but accepts one exactly at it', () => {
      expect(checkMessage('a'.repeat(MAX_MESSAGE_LENGTH)).valid).toBe(true);
      expect(checkMessage('a'.repeat(MAX_MESSAGE_LENGTH + 1)).valid).toBe(false);
    });

    it('explains every refusal', () => {
      expect(checkMessage('').error).toBeTruthy();
      expect(checkMessage('a'.repeat(MAX_MESSAGE_LENGTH + 1)).error).toBeTruthy();
    });
  });

  describe('canPostMessage', () => {
    const base = {
      clientId: 'client-1',
      agencyId: 'agency-1',
      escalatedAt: null,
      escalatedTo: null,
    };
    const escalated = { ...base, escalatedAt: '2026-07-28T10:00:00.000Z', escalatedTo: 'admin-1' };

    it('lets the client who raised it post, and no other client', () => {
      expect(canPostMessage(ROLES.CLIENT, base, 'client-1')).toBe(true);
      expect(canPostMessage(ROLES.CLIENT, base, 'client-2')).toBe(false);
    });

    it('lets the owning agency post, and no other agency', () => {
      expect(canPostMessage(ROLES.AGENCY, base, 'agency-1')).toBe(true);
      expect(canPostMessage(ROLES.AGENCY, base, 'agency-2')).toBe(false);
    });

    it('keeps an admin out until the ticket is escalated to them', () => {
      // Browsing by agency is oversight, not participation.
      expect(canPostMessage(ROLES.ADMIN, base, 'admin-1')).toBe(false);
      expect(canPostMessage(ROLES.ADMIN, escalated, 'admin-1')).toBe(true);
    });

    it('does not let a different admin in on someone else\'s escalation', () => {
      expect(canPostMessage(ROLES.ADMIN, escalated, 'admin-2')).toBe(false);
    });

    it('refuses when the ticket or the user is missing', () => {
      expect(canPostMessage(ROLES.CLIENT, null, 'client-1')).toBe(false);
      expect(canPostMessage(ROLES.CLIENT, base, null)).toBe(false);
    });

    it('closes to everyone once the ticket is resolved', () => {
      // Otherwise chatting becomes a second way to reopen work, one that leaves
      // the status reading "resolved" while the ticket sits in the active list.
      const done = { ...escalated, status: 'resolved' };

      expect(canPostMessage(ROLES.CLIENT, done, 'client-1')).toBe(false);
      expect(canPostMessage(ROLES.AGENCY, done, 'agency-1')).toBe(false);
      expect(canPostMessage(ROLES.ADMIN, done, 'admin-1')).toBe(false);
    });

    it('opens again when the ticket is reopened', () => {
      const reopened = { ...base, status: 'open' };
      expect(canPostMessage(ROLES.CLIENT, reopened, 'client-1')).toBe(true);
    });
  });

  describe('isConversationOpen', () => {
    it('is closed only when resolved', () => {
      for (const status of ['open', 'in_progress', 'with_client', 'on_hold']) {
        expect(isConversationOpen({ status })).toBe(true);
      }
      expect(isConversationOpen({ status: 'resolved' })).toBe(false);
      expect(isConversationOpen(null)).toBe(false);
    });
  });
});
