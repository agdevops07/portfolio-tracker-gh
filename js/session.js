// ═══════════════════════════════════════════════
// SESSION MANAGER
// Persists up to 3 portfolio sessions in localStorage.
// Survives page refresh and browser restart.
// ═══════════════════════════════════════════════

const SESSION_KEY   = 'portfolio_sessions';   // localStorage key for all sessions
const ACTIVE_KEY    = 'portfolio_active_sid';  // localStorage key for active session id
const MAX_SESSIONS  = 5;

// ── Helpers ──────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function now() {
  return new Date().toISOString();
}

// ── Core read / write ────────────────────────────

export function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveSessions(sessions) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  } catch (_) {}
}

export function getActiveSessionId() {
  try { return localStorage.getItem(ACTIVE_KEY) || null; } catch (_) { return null; }
}

export function setActiveSessionId(sid) {
  try { localStorage.setItem(ACTIVE_KEY, sid); } catch (_) {}
}

// ── Public API ────────────────────────────────────

/**
 * Save (create or update) a session with the given CSV string.
 * @param {string} csvText  Raw CSV content
 * @param {string} [label]  Human-friendly name; auto-generated if omitted
 * @param {string} [sid]    Existing session id to overwrite; creates new if omitted
 * @returns {object} The saved session object
 */
export function saveSession(csvText, label, sid) {
  const sessions = loadSessions();

  // Derive a smart auto-label from the CSV
  if (!label) {
    try {
      const firstLine = csvText.split('\n')[1] || '';
      const ticker = firstLine.split(',')[0]?.trim().toUpperCase() || '';
      const count  = csvText.split('\n').filter(l => l.trim() && !l.startsWith('ticker')).length;
      label = ticker ? `${ticker} + ${count - 1} more` : `Portfolio ${sessions.length + 1}`;
    } catch (_) {
      label = `Portfolio ${sessions.length + 1}`;
    }
  }

  const existingIdx = sid ? sessions.findIndex(s => s.id === sid) : -1;

  if (existingIdx !== -1) {
    // Update in place
    sessions[existingIdx] = {
      ...sessions[existingIdx],
      label,
      csv: csvText,
      updatedAt: now(),
    };
  } else {
    // Create new session
    const newSession = {
      id: genId(),
      label,
      csv: csvText,
      createdAt: now(),
      updatedAt: now(),
    };

    if (sessions.length >= MAX_SESSIONS) {
      // Drop the oldest session (first in list)
      sessions.shift();
    }
    sessions.push(newSession);
    sid = newSession.id;
  }

  saveSessions(sessions);
  setActiveSessionId(sid || sessions.at(-1).id);
  return sessions.find(s => s.id === (sid || sessions.at(-1).id));
}

/**
 * Delete a session by id. Clears active if it was the active one.
 */
export function deleteSession(sid) {
  let sessions = loadSessions();
  sessions = sessions.filter(s => s.id !== sid);
  saveSessions(sessions);

  if (getActiveSessionId() === sid) {
    const next = sessions.at(-1);
    setActiveSessionId(next ? next.id : null);
  }
}

/**
 * Rename a session.
 */
export function renameSession(sid, newLabel) {
  const sessions = loadSessions();
  const s = sessions.find(s => s.id === sid);
  if (s) {
    s.label = newLabel;
    s.updatedAt = now();
    saveSessions(sessions);
  }
}

/**
 * Returns the CSV text of the active session, or null if none exists.
 */
export function getActiveCSV() {
  const sid = getActiveSessionId();
  if (!sid) return null;
  const sessions = loadSessions();
  const s = sessions.find(s => s.id === sid);
  return s ? s.csv : null;
}

/**
 * Returns true if at least one saved session exists.
 */
export function hasSessions() {
  return loadSessions().length > 0;
}

/**
 * Activate a session by id and return its CSV.
 */
export function activateSession(sid) {
  setActiveSessionId(sid);
  const sessions = loadSessions();
  const s = sessions.find(s => s.id === sid);
  return s ? s.csv : null;
}

/**
 * Format a date string for display.
 */
export function fmtSessionDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return iso; }
}
