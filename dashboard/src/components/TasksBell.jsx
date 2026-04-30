import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTasks, useCompleteTask } from '../hooks/useApi';

const Z_BACKDROP = 999;
const Z_DROPDOWN = 1000;

const ChecklistIcon = ({ size = 20 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
       strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const RecurringIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={11} height={11}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

function dueLabel(dateStr) {
  if (!dateStr) return null;
  const diff = daysBetween(todayISO(), dateStr);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  if (diff < 0) return diff === -1 ? 'Hier' : `Il y a ${-diff}j`;
  if (diff < 7) return `Dans ${diff}j`;
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function dueColor(dateStr) {
  if (!dateStr) return 'var(--text-muted)';
  const diff = daysBetween(todayISO(), dateStr);
  if (diff < 0) return '#ef4444';
  if (diff === 0) return '#f59e0b';
  return 'var(--text-secondary)';
}

/**
 * TasksBell — toolbar widget showing imminent tasks with inline check-off.
 * Designed to slot into a page toolbar (e.g. Planning header) next to other
 * icon buttons like refresh.
 *
 * @param {string} variant      - "planning" (default) — styled like .plan-icon-btn
 * @param {number} overdueCount - count of overdue tasks (passed by parent to avoid duplicate fetch)
 */
export default function TasksBell({ variant = 'planning', overdueCount = 0 }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Pull todo tasks (anything not done, regardless of due date)
  // We'll group + filter client-side to overdue/today/week.
  const tasksQuery = useTasks({ status: 'todo' }, {
    refetchInterval: open ? 30_000 : false,
  });
  const completeMutation = useCompleteTask();

  // Group tasks. Slice for display, but keep totals for accurate badges.
  const grouped = useMemo(() => {
    const tasks = tasksQuery.data || [];
    const today = todayISO();
    const buckets = { overdue: [], today: [], later: [] };
    for (const t of tasks) {
      const due = t.next_due_date || t.due_date;
      if (!due) {
        buckets.later.push(t);
        continue;
      }
      const diff = daysBetween(today, due);
      if (diff < 0) buckets.overdue.push(t);
      else if (diff === 0) buckets.today.push(t);
      else if (diff <= 7) buckets.later.push(t);
    }
    // Cap each group: 3 overdue + 5 today + 4 later = 12 max visible
    const overdueShown = buckets.overdue.slice(0, 3);
    const todayShown = buckets.today.slice(0, 5);
    const laterShown = buckets.later.slice(0, 4);
    return {
      overdue: overdueShown,
      today: todayShown,
      later: laterShown,
      overdueTotal: buckets.overdue.length,
      todayTotal: buckets.today.length,
      laterTotal: buckets.later.length,
      totalShown: overdueShown.length + todayShown.length + laterShown.length,
      totalCount: tasks.length,
    };
  }, [tasksQuery.data]);

  // Outside-click close
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleComplete = useCallback(async (e, task) => {
    e.stopPropagation();
    // Let errors bubble so TaskRow can revert its optimistic state.
    await completeMutation.mutateAsync({ id: task.id });
  }, [completeMutation]);

  const handleRowClick = useCallback(() => {
    setOpen(false);
    navigate('/tasks');
  }, [navigate]);

  const handleSeeAll = useCallback(() => {
    setOpen(false);
    navigate('/tasks');
  }, [navigate]);

  const hasContent = grouped.totalShown > 0;
  const DROPDOWN_W = 320;

  // Compute dropdown position inline at render. Aligns the dropdown's right edge
  // to the button's right edge (so it doesn't overflow off-screen on narrow viewports).
  const rect = open ? wrapperRef.current?.getBoundingClientRect() : null;
  const pos = rect
    ? {
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.right - DROPDOWN_W, window.innerWidth - DROPDOWN_W - 8)),
      }
    : { top: 0, left: 0 };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="plan-icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={overdueCount > 0 ? `Tâches (${overdueCount} en retard)` : 'Tâches'}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={overdueCount > 0 ? `Tâches — ${overdueCount} en retard` : 'Tâches'}
        style={{ position: 'relative' }}
      >
        <ChecklistIcon size={16} />
        {overdueCount > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -4, right: -4,
              minWidth: 16, height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: '#ef4444',
              color: '#fff',
              fontSize: 9, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
              border: '2px solid var(--bg)',
              boxSizing: 'content-box',
            }}
          >
            {overdueCount > 9 ? '9+' : overdueCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Liste des tâches"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: Z_DROPDOWN,
            width: 320,
            maxHeight: 'min(70vh, 520px)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Tâches</span>
              {grouped.totalCount > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  padding: '2px 7px', borderRadius: 10,
                  background: 'rgba(var(--overlay), 0.08)',
                  color: 'var(--text-secondary)',
                }}>
                  {grouped.totalCount}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSeeAll}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-secondary)', fontSize: 11,
                padding: '4px 6px', borderRadius: 4,
              }}
            >
              Tout voir →
            </button>
          </div>

          {/* Body */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {tasksQuery.isLoading && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                Chargement…
              </div>
            )}

            {!tasksQuery.isLoading && !hasContent && (
              <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: 'rgba(34,197,94,0.1)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: '#22c55e', marginBottom: 10,
                }}>
                  <CheckIcon />
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 3, fontWeight: 500 }}>
                  Tout est à jour
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Aucune tâche à faire
                </div>
              </div>
            )}

            {!tasksQuery.isLoading && hasContent && (
              <>
                <Section title="En retard" tasks={grouped.overdue} total={grouped.overdueTotal} accent="#ef4444"
                         onComplete={handleComplete} onRowClick={handleRowClick} />
                <Section title="Aujourd'hui" tasks={grouped.today} total={grouped.todayTotal} accent="#f59e0b"
                         onComplete={handleComplete} onRowClick={handleRowClick} />
                <Section title="Cette semaine" tasks={grouped.later} total={grouped.laterTotal} accent={null}
                         onComplete={handleComplete} onRowClick={handleRowClick} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, tasks, total, accent, onComplete, onRowClick }) {
  if (tasks.length === 0) return null;
  const hidden = total - tasks.length;
  return (
    <>
      <div style={{
        padding: '8px 14px 4px',
        fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: accent || 'var(--text-muted)',
        borderTop: '1px solid var(--border)',
        background: 'rgba(var(--overlay), 0.02)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>{title} <span style={{ opacity: 0.55, marginLeft: 4 }}>{total}</span></span>
        {hidden > 0 && (
          <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.6, textTransform: 'none', letterSpacing: 0 }}>
            +{hidden} non affichées
          </span>
        )}
      </div>
      {tasks.map((t) => <TaskRow key={t.id} task={t} onComplete={onComplete} onClick={onRowClick} />)}
    </>
  );
}

function TaskRow({ task, onComplete, onClick }) {
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  const due = task.next_due_date || task.due_date;
  const assignee = task.assigned_barber_name || task.assigned_to_name || null;

  async function handleCheck(e) {
    e.stopPropagation();
    if (inFlight.current || done) return;
    inFlight.current = true;
    setDone(true);
    try {
      await onComplete(e, task);
    } catch {
      setDone(false);
    } finally {
      inFlight.current = false;
    }
  }

  function handleRowClick() {
    // Don't navigate while a check-mutation is in flight or freshly checked
    if (inFlight.current || done) return;
    onClick();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={(e) => { if (e.key === 'Enter') handleRowClick(); }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 6,
        width: '100%',
        padding: '4px 6px 4px 4px',
        borderTop: '1px solid var(--border)',
        cursor: done ? 'default' : 'pointer',
        textAlign: 'left',
        opacity: done ? 0.45 : 1,
        transition: 'opacity 0.18s, background 0.15s',
      }}
      onMouseEnter={(e) => { if (!done) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Hit area 32×32 around 18×18 visible checkbox — touch-target compliant.
          Native button toggle: aria-pressed conveys binary state cleanly. */}
      <button
        type="button"
        aria-pressed={done}
        aria-label={done ? `${task.title} (fait)` : `Marquer ${task.title} comme fait`}
        onClick={handleCheck}
        style={{
          flexShrink: 0,
          width: 32, height: 32,
          padding: 0, margin: 0,
          background: 'none', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 18, height: 18,
            borderRadius: 5,
            border: done ? 'none' : '1.5px solid var(--border-focus)',
            background: done ? '#22c55e' : 'transparent',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
        >
          {done && <CheckIcon />}
        </span>
      </button>

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontSize: 12.5, fontWeight: 500, color: 'var(--text)',
          textDecoration: done ? 'line-through' : 'none',
          lineHeight: 1.35,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {task.title}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          {assignee && <span>{assignee}</span>}
          {due && (
            <span style={{ color: dueColor(due), fontWeight: 500 }}>{dueLabel(due)}</span>
          )}
          {task.is_recurring && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, opacity: 0.7 }}>
              <RecurringIcon />
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
