import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import useMobile from '../hooks/useMobile';
import {
  useTasks, useTask, useCreateTask, useUpdateTask, useDeleteTask,
  useCompleteTask, useUncompleteTask, useBarbers,
} from '../hooks/useApi';

// ---- Icons ----
const IconPlus = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const IconCheck = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: 14, height: 14 }}><polyline points="20 6 9 17 4 12" /></svg>;
const IconRecurring = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>;
const IconTrash = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>;
const IconEdit = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
const IconClock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
const IconClose = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
const IconHistory = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /><polyline points="12 7 12 12 16 14" /></svg>;
const IconEmpty = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 56, height: 56, color: 'var(--text-muted)', marginBottom: 14 }}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}

function formatDueLabel(dateStr) {
  if (!dateStr) return null;
  const diff = daysBetween(todayISO(), dateStr);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  if (diff < 0) return `Il y a ${-diff} j`;
  if (diff < 7) return `Dans ${diff} j`;
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function dueColor(dateStr) {
  if (!dateStr) return 'var(--text-muted)';
  const diff = daysBetween(todayISO(), dateStr);
  if (diff < 0) return 'var(--danger)';
  if (diff === 0) return 'var(--warning)';
  if (diff < 4) return 'var(--warning)';
  return 'var(--text-secondary)';
}

function formatRecurrenceLabel(config) {
  if (!config) return '';
  const { unit, interval } = config;
  if (unit === 'day') return interval === 1 ? 'Tous les jours' : `Tous les ${interval} jours`;
  if (unit === 'week') {
    const days = (config.days_of_week || []).map((d) => DAY_LABELS[d]).join(', ');
    return interval === 1 ? `Chaque semaine (${days})` : `Toutes les ${interval} semaines (${days})`;
  }
  if (unit === 'month') {
    const dom = config.day_of_month === 'last' ? 'dernier jour' : `le ${config.day_of_month}`;
    return interval === 1 ? `Chaque mois, ${dom}` : `Tous les ${interval} mois, ${dom}`;
  }
  return '';
}

function groupTasks(tasks) {
  const groups = { overdue: [], today: [], week: [], later: [], none: [] };
  const today = todayISO();
  for (const t of tasks) {
    const due = t.next_due_date || t.due_date;
    if (!due) {
      groups.none.push(t);
      continue;
    }
    const diff = daysBetween(today, due);
    if (diff < 0) groups.overdue.push(t);
    else if (diff === 0) groups.today.push(t);
    else if (diff <= 7) groups.week.push(t);
    else groups.later.push(t);
  }
  return groups;
}

// =============================================================
// Page
// =============================================================
export default function Tasks() {
  const isMobile = useMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilter = searchParams.get('filter') === 'overdue' ? 'overdue' : null;

  const [tab, setTab] = useState('todo'); // todo | done | all
  const [editing, setEditing] = useState(null); // null | 'new' | task
  const [historyTaskId, setHistoryTaskId] = useState(null);
  const [toast, setToast] = useState(null);

  const tasksQuery = useTasks({ status: tab });
  const barbersQuery = useBarbers();
  const completeMutation = useCompleteTask();
  const uncompleteMutation = useUncompleteTask();
  const deleteMutation = useDeleteTask();

  const tasks = tasksQuery.data || [];
  const barbers = (barbersQuery.data || []).filter((b) => b.is_active);

  // Filter overdue if param set
  const filtered = useMemo(() => {
    if (initialFilter === 'overdue') {
      const today = todayISO();
      return tasks.filter((t) => {
        const due = t.next_due_date || t.due_date;
        return due && daysBetween(today, due) < 0;
      });
    }
    return tasks;
  }, [tasks, initialFilter]);

  const groups = useMemo(() => groupTasks(filtered), [filtered]);

  const toastTimer = useRef(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  async function handleComplete(task) {
    try {
      const result = await completeMutation.mutateAsync({ id: task.id });
      if (task.is_recurring && result?.task?.next_due_date) {
        const next = new Date(result.task.next_due_date + 'T00:00:00')
          .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
        showToast(`Fait. Prochaine échéance : ${next}`);
      } else {
        showToast('Tâche cochée');
      }
    } catch (err) {
      showToast(err.message || 'Erreur', 'error');
    }
  }

  async function handleUncomplete(task) {
    try {
      await uncompleteMutation.mutateAsync(task.id);
      showToast('Décochée');
    } catch (err) {
      showToast(err.message || 'Erreur', 'error');
    }
  }

  async function handleDelete(task) {
    if (!confirm(`Supprimer "${task.title}" ?\nL'historique sera conservé mais la tâche disparaîtra de la liste.`)) return;
    try {
      await deleteMutation.mutateAsync(task.id);
      showToast('Tâche supprimée');
    } catch (err) {
      showToast(err.message || 'Erreur', 'error');
    }
  }

  const isLoading = tasksQuery.isLoading;
  const isEmpty = !isLoading && filtered.length === 0;

  return (
    <div style={{ padding: isMobile ? '16px 12px 80px' : '24px 24px 32px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 600, margin: 0 }}>Tâches</h1>
          {initialFilter === 'overdue' && (
            <button
              type="button"
              onClick={() => setSearchParams({})}
              style={{
                marginTop: 6, fontSize: 12, color: 'var(--text-secondary)',
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              Filtre "en retard" actif — voir toutes
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '9px 14px', borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)', color: 'var(--bg)', border: 'none',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <IconPlus />
          {isMobile ? 'Nouvelle' : 'Nouvelle tâche'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'todo', label: 'À faire' },
          { key: 'done', label: 'Faites' },
          { key: 'all', label: 'Toutes' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.key ? 'var(--text)' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Loading / empty */}
      {isLoading && <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Chargement…</div>}

      {isEmpty && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <IconEmpty />
          <div style={{ fontSize: 14 }}>
            {tab === 'todo' ? 'Aucune tâche en cours' : tab === 'done' ? 'Aucune tâche terminée' : 'Aucune tâche'}
          </div>
        </div>
      )}

      {/* Groups */}
      {!isLoading && !isEmpty && (
        <>
          <Group title="En retard" count={groups.overdue.length} tasks={groups.overdue} color="var(--danger)"
                 onComplete={handleComplete} onUncomplete={handleUncomplete} onEdit={setEditing}
                 onDelete={handleDelete} onHistory={setHistoryTaskId} />
          <Group title="Aujourd'hui" count={groups.today.length} tasks={groups.today} color="var(--warning)"
                 onComplete={handleComplete} onUncomplete={handleUncomplete} onEdit={setEditing}
                 onDelete={handleDelete} onHistory={setHistoryTaskId} />
          <Group title="Cette semaine" count={groups.week.length} tasks={groups.week}
                 onComplete={handleComplete} onUncomplete={handleUncomplete} onEdit={setEditing}
                 onDelete={handleDelete} onHistory={setHistoryTaskId} />
          <Group title="Plus tard" count={groups.later.length} tasks={groups.later}
                 onComplete={handleComplete} onUncomplete={handleUncomplete} onEdit={setEditing}
                 onDelete={handleDelete} onHistory={setHistoryTaskId} />
          <Group title="Sans échéance" count={groups.none.length} tasks={groups.none}
                 onComplete={handleComplete} onUncomplete={handleUncomplete} onEdit={setEditing}
                 onDelete={handleDelete} onHistory={setHistoryTaskId} />
        </>
      )}

      {/* Modal */}
      {editing && (
        <TaskModal
          task={editing === 'new' ? null : editing}
          barbers={barbers}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { showToast(msg); setEditing(null); }}
        />
      )}

      {/* History drawer */}
      {historyTaskId && (
        <HistoryDrawer
          taskId={historyTaskId}
          onClose={() => setHistoryTaskId(null)}
          onUncomplete={async (task) => {
            await handleUncomplete(task);
            setHistoryTaskId(null);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: isMobile ? 80 : 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: toast.type === 'error' ? 'var(--danger)' : 'var(--accent)',
            color: toast.type === 'error' ? '#fff' : 'var(--bg)',
            padding: '11px 18px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 13, fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 1000,
            maxWidth: 'calc(100vw - 40px)',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

// =============================================================
// Group section
// =============================================================
function Group({ title, count, tasks, color, onComplete, onUncomplete, onEdit, onDelete, onHistory }) {
  if (count === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: color || 'var(--text-secondary)', margin: '0 0 10px', padding: '0 4px',
      }}>
        {title} <span style={{ opacity: 0.5, marginLeft: 6 }}>{count}</span>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t}
            onComplete={onComplete} onUncomplete={onUncomplete}
            onEdit={onEdit} onDelete={onDelete} onHistory={onHistory} />
        ))}
      </div>
    </div>
  );
}

// =============================================================
// Task card
// =============================================================
function TaskCard({ task, onComplete, onUncomplete, onEdit, onDelete, onHistory }) {
  const [optimisticDone, setOptimisticDone] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const isCompletedOneShot = !task.is_recurring && task.completed_at;
  const isCheckedNow = isCompletedOneShot || optimisticDone;
  const due = task.next_due_date || task.due_date;
  const dueLabel = formatDueLabel(due);

  function handleCheckClick() {
    if (isCheckedNow) {
      onUncomplete(task);
      setOptimisticDone(false);
    } else {
      setOptimisticDone(true);
      onComplete(task).catch(() => setOptimisticDone(false));
    }
  }

  const assigneeLabel = task.assigned_barber_name || task.assigned_to_name || '—';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 14px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      opacity: isCheckedNow ? 0.55 : 1,
      transition: 'opacity 0.18s',
    }}>
      {/* Checkbox */}
      <button
        type="button"
        onClick={handleCheckClick}
        aria-label={isCheckedNow ? 'Décocher' : 'Cocher'}
        style={{
          flexShrink: 0,
          width: 22, height: 22,
          borderRadius: 6,
          border: isCheckedNow ? 'none' : '1.5px solid var(--border-focus)',
          background: isCheckedNow ? 'var(--success)' : 'transparent',
          color: isCheckedNow ? '#fff' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          marginTop: 1,
          transition: 'all 0.15s',
        }}
      >
        {isCheckedNow && <IconCheck />}
      </button>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 500,
          textDecoration: isCheckedNow ? 'line-through' : 'none',
          color: isCheckedNow ? 'var(--text-muted)' : 'var(--text)',
          wordBreak: 'break-word',
        }}>
          {task.title}
        </div>
        {task.description && (
          <div style={{
            fontSize: 12, color: 'var(--text-secondary)',
            marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {task.description}
          </div>
        )}
        {/* Meta row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          {/* Assignee */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
            <Avatar name={assigneeLabel} photo={task.assigned_barber_photo} />
            <span>{assigneeLabel}</span>
          </div>
          {/* Due date */}
          {dueLabel && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 500,
              color: dueColor(due),
            }}>
              <IconClock />
              {dueLabel}
            </div>
          )}
          {/* Recurring badge */}
          {task.is_recurring && (
            <div
              title={formatRecurrenceLabel(task.recurrence_config)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10.5,
                color: 'var(--text-secondary)',
                background: 'rgba(var(--overlay), 0.06)',
                padding: '2px 7px',
                borderRadius: 10,
              }}
            >
              <IconRecurring />
              {formatRecurrenceLabel(task.recurrence_config)}
            </div>
          )}
        </div>
      </div>

      {/* Menu */}
      <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', padding: 6,
            fontSize: 18, lineHeight: 1,
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <div style={{
            position: 'absolute', top: 32, right: 0, zIndex: 10,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            minWidth: 180, padding: 4,
          }}>
            <MenuItem icon={<IconEdit />} label="Éditer" onClick={() => { setMenuOpen(false); onEdit(task); }} />
            <MenuItem icon={<IconHistory />} label="Voir historique" onClick={() => { setMenuOpen(false); onHistory(task.id); }} />
            <MenuItem icon={<IconTrash />} label="Supprimer" danger onClick={() => { setMenuOpen(false); onDelete(task); }} />
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        background: 'none', border: 'none',
        padding: '8px 10px', borderRadius: 6,
        color: danger ? 'var(--danger)' : 'var(--text)',
        fontSize: 13, cursor: 'pointer', textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      {icon}
      {label}
    </button>
  );
}

function Avatar({ name, photo }) {
  if (photo) {
    return <img src={photo} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />;
  }
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <div style={{
      width: 18, height: 18, borderRadius: '50%',
      background: 'var(--bg-hover)', color: 'var(--text-secondary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 600,
    }}>
      {initial}
    </div>
  );
}

// =============================================================
// Modal create/edit
// =============================================================
function TaskModal({ task, barbers, onClose, onSaved }) {
  const isMobile = useMobile();
  const isEdit = !!task;
  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();

  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [assigneeMode, setAssigneeMode] = useState(task?.assigned_to_barber_id ? 'barber' : task?.assigned_to_name ? 'name' : 'none');
  const [barberId, setBarberId] = useState(task?.assigned_to_barber_id || '');
  const [assigneeName, setAssigneeName] = useState(task?.assigned_to_name || '');
  const [dueDate, setDueDate] = useState(task?.due_date || '');
  const [isRecurring, setIsRecurring] = useState(task?.is_recurring || false);

  const initialConfig = task?.recurrence_config;
  const [recUnit, setRecUnit] = useState(initialConfig?.unit || 'month');
  const [recInterval, setRecInterval] = useState(initialConfig?.interval || 1);
  const [recDaysOfWeek, setRecDaysOfWeek] = useState(initialConfig?.days_of_week || [0]);
  const [recDayOfMonth, setRecDayOfMonth] = useState(initialConfig?.day_of_month || 'last');

  const [error, setError] = useState(null);

  function buildRecurrenceConfig() {
    const cfg = { unit: recUnit, interval: Math.max(1, parseInt(recInterval, 10) || 1) };
    if (recUnit === 'week') {
      if (!recDaysOfWeek.length) return null;
      cfg.days_of_week = [...recDaysOfWeek].sort((a, b) => a - b);
    }
    if (recUnit === 'month') {
      cfg.day_of_month = recDayOfMonth === 'last' ? 'last' : Math.max(1, Math.min(31, parseInt(recDayOfMonth, 10) || 1));
    }
    return cfg;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Titre requis');
      return;
    }
    if (isRecurring && recUnit === 'week' && recDaysOfWeek.length === 0) {
      setError('Sélectionne au moins un jour de la semaine');
      return;
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      assigned_to_barber_id: assigneeMode === 'barber' ? (barberId || null) : null,
      assigned_to_name: assigneeMode === 'name' ? (assigneeName.trim() || null) : null,
      due_date: dueDate || null,
      is_recurring: isRecurring,
      recurrence_config: isRecurring ? buildRecurrenceConfig() : null,
    };

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: task.id, data: payload });
        onSaved('Tâche modifiée');
      } else {
        await createMutation.mutateAsync(payload);
        onSaved('Tâche créée');
      }
    } catch (err) {
      setError(err.message || 'Erreur');
    }
  }

  function toggleDay(day) {
    setRecDaysOfWeek((curr) => (curr.includes(day) ? curr.filter((d) => d !== day) : [...curr, day]));
  }

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 20,
        overflowY: 'auto',
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          width: '100%', maxWidth: 520,
          maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: isMobile ? '16px 16px 0 0' : 'var(--radius)',
          padding: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{isEdit ? 'Modifier la tâche' : 'Nouvelle tâche'}</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 6 }}>
            <IconClose />
          </button>
        </div>

        {/* Title */}
        <Field label="Titre *">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Paie de fin de mois"
            maxLength={200}
            autoFocus
            style={inputStyle}
          />
        </Field>

        {/* Description */}
        <Field label="Description (optionnel)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Détails…"
            maxLength={2000}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Field>

        {/* Assignee */}
        <Field label="Assigné à">
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <RadioChip label="Aucun" active={assigneeMode === 'none'} onClick={() => setAssigneeMode('none')} />
            <RadioChip label="Un barber" active={assigneeMode === 'barber'} onClick={() => setAssigneeMode('barber')} />
            <RadioChip label="Quelqu'un d'autre" active={assigneeMode === 'name'} onClick={() => setAssigneeMode('name')} />
          </div>
          {assigneeMode === 'barber' && (
            <select value={barberId} onChange={(e) => setBarberId(e.target.value)} style={inputStyle}>
              <option value="">— Choisir —</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          {assigneeMode === 'name' && (
            <input
              type="text"
              value={assigneeName}
              onChange={(e) => setAssigneeName(e.target.value)}
              placeholder="Alternant, Stagiaire, …"
              maxLength={100}
              style={inputStyle}
            />
          )}
        </Field>

        {/* Due date */}
        <Field label="Date d'échéance (optionnel)">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            {dueDate && (
              <button
                type="button"
                onClick={() => setDueDate('')}
                style={{ ...secondaryButtonStyle, padding: '8px 12px' }}
              >
                Effacer
              </button>
            )}
          </div>
        </Field>

        {/* Recurring */}
        <div style={{ margin: '14px 0 16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontWeight: 500 }}>Tâche récurrente</span>
          </label>
        </div>

        {isRecurring && (
          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: 14, marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tous les</span>
              <input
                type="number"
                min={1}
                max={365}
                value={recInterval}
                onChange={(e) => setRecInterval(e.target.value)}
                style={{ ...inputStyle, width: 70, padding: '8px 10px' }}
              />
              <select value={recUnit} onChange={(e) => setRecUnit(e.target.value)} style={{ ...inputStyle, padding: '8px 10px', width: 'auto' }}>
                <option value="day">jour(s)</option>
                <option value="week">semaine(s)</option>
                <option value="month">mois</option>
              </select>
            </div>

            {recUnit === 'week' && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Jours de la semaine</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DAY_LABELS.map((label, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDay(idx)}
                      style={{
                        padding: '7px 12px', borderRadius: 6,
                        background: recDaysOfWeek.includes(idx) ? 'var(--accent)' : 'transparent',
                        color: recDaysOfWeek.includes(idx) ? 'var(--bg)' : 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {recUnit === 'month' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Le</span>
                <select
                  value={recDayOfMonth}
                  onChange={(e) => setRecDayOfMonth(e.target.value)}
                  style={{ ...inputStyle, padding: '8px 10px', width: 'auto' }}
                >
                  <option value="last">dernier jour</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>du mois</span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(239,68,68,0.1)', color: 'var(--danger)',
            fontSize: 13, marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>Annuler</button>
          <button type="submit" disabled={submitting} style={primaryButtonStyle}>
            {submitting ? '…' : isEdit ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

function RadioChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px', borderRadius: 18,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--bg)' : 'var(--text-secondary)',
        border: '1px solid var(--border)',
        fontSize: 12, fontWeight: 500, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  fontSize: 14,
  outline: 'none',
};

const primaryButtonStyle = {
  padding: '10px 18px',
  background: 'var(--accent)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const secondaryButtonStyle = {
  padding: '10px 18px',
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

// =============================================================
// History drawer
// =============================================================
function HistoryDrawer({ taskId, onClose, onUncomplete }) {
  const isMobile = useMobile();
  const taskQuery = useTask(taskId);
  const task = taskQuery.data;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: isMobile ? '100%' : 420,
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border)',
          padding: 20,
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Historique</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 6 }}>
            <IconClose />
          </button>
        </div>

        {!task && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Chargement…</div>}

        {task && (
          <>
            <div style={{ marginBottom: 18, padding: '0 0 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{task.title}</div>
              {task.is_recurring && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {formatRecurrenceLabel(task.recurrence_config)}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {task.completion_count} complétion{task.completion_count > 1 ? 's' : ''}
              </div>
            </div>

            {task.completions?.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                Aucune complétion
              </div>
            )}

            {task.completions?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {task.completions.map((c, idx) => (
                  <div key={c.id} style={{
                    padding: 12,
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      {new Date(c.completed_at).toLocaleString('fr-FR', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      Par <strong>{c.completed_by_name || 'Compte salon'}</strong>
                      {c.due_date_at_completion && (
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {' '}— échéance du {new Date(c.due_date_at_completion + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                    {c.notes && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, fontStyle: 'italic' }}>
                        {c.notes}
                      </div>
                    )}
                    {idx === 0 && (
                      <button
                        type="button"
                        onClick={() => onUncomplete(task)}
                        style={{
                          marginTop: 10,
                          background: 'none', border: 'none', padding: 0,
                          color: 'var(--danger)', fontSize: 12, cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Annuler cette complétion
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
