/**
 * LiveToasts — Real-time toast notifications for client-initiated booking changes.
 * Listens to WebSocket 'booking:client-action' events and displays stacked toasts.
 * Auto-dismisses after 8s. Click to dismiss.
 */

import { useState, useCallback } from 'react';
import { useSocketEvent } from '../hooks/useSocket';

const TOAST_DURATION = 8000;

const TYPES = {
  cancelled: {
    label: 'RDV annulé',
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.3)',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  rescheduled: {
    label: 'RDV déplacé',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.3)',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round">
        <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    ),
  },
  created: {
    label: 'Nouveau RDV',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.3)',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
};

export default function LiveToasts() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((data) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-4), { id, ...data }]); // Max 5 visible
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Listen for client actions
  useSocketEvent('booking:client-action', addToast);

  // Also listen for new bookings (optional, for created toasts)
  useSocketEvent('booking:created', useCallback((data) => {
    if (data && data.id) {
      addToast({
        type: 'created',
        clientName: [data.client_first_name, data.client_last_name].filter(Boolean).join(' ') || 'Client',
        barberName: data.barber_name,
        serviceName: data.service_name,
        date: data.date,
        time: data.start_time?.slice(0, 5),
      });
    }
  }, [addToast]));

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none', maxWidth: 380, width: '100%',
    }}>
      {toasts.map((toast, i) => {
        const cfg = TYPES[toast.type] || TYPES.created;
        return (
          <div
            key={toast.id}
            onClick={() => dismiss(toast.id)}
            style={{
              pointerEvents: 'auto',
              background: 'var(--bg-card, #111)',
              border: `1px solid ${cfg.border}`,
              borderLeft: `4px solid ${cfg.color}`,
              borderRadius: 12,
              padding: '14px 16px',
              cursor: 'pointer',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              animation: 'toast-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              display: 'flex', alignItems: 'flex-start', gap: 12,
              opacity: 1,
              transition: 'opacity 0.2s, transform 0.2s',
            }}
          >
            <div style={{ flexShrink: 0, marginTop: 1 }}>{cfg.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: cfg.color,
                textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
              }}>
                {cfg.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                {toast.clientName || 'Client'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {toast.serviceName && <span>{toast.serviceName}</span>}
                {toast.barberName && <span> — {toast.barberName}</span>}
                {toast.date && toast.time && (
                  <span style={{ display: 'block', marginTop: 2, color: 'var(--text-muted)' }}>
                    {toast.date} à {toast.time}
                    {toast.type === 'rescheduled' && toast.oldDate && (
                      <span> (avant : {toast.oldDate} à {toast.oldTime})</span>
                    )}
                  </span>
                )}
              </div>
            </div>
            <div style={{ flexShrink: 0, color: 'var(--text-muted)', fontSize: 10, opacity: 0.5 }}>✕</div>
          </div>
        );
      })}
    </div>
  );
}
