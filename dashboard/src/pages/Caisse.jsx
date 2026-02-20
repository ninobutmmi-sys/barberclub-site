import { useState, useEffect, useCallback } from 'react';
import { getDailyCash, recordPayment, deletePayment, closeRegister, updateBookingStatus } from '../api';
import { format, addDays, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import useMobile from '../hooks/useMobile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC';
}

const METHOD_LABELS = { cb: 'CB', cash: 'Espèces', lydia: 'Lydia', other: 'Autre' };
const METHOD_COLORS = {
  cb: { bg: 'rgba(59,130,246,0.12)', border: '#3b82f6', text: '#93c5fd' },
  cash: { bg: 'rgba(34,197,94,0.12)', border: '#22c55e', text: '#86efac' },
  lydia: { bg: 'rgba(168,85,247,0.12)', border: '#a855f7', text: '#d8b4fe' },
  other: { bg: 'rgba(245,158,11,0.12)', border: '#f59e0b', text: '#fcd34d' },
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// RecordPaymentModal
// ---------------------------------------------------------------------------

function RecordPaymentModal({ bookings, onClose, onRecorded, isClosed }) {
  const [bookingId, setBookingId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pre-fill amount when booking selected
  const selectedBooking = bookings.find((b) => b.id === bookingId);
  function handleBookingChange(id) {
    setBookingId(id);
    const bk = bookings.find((b) => b.id === id);
    if (bk && bk.price && !amount) {
      setAmount((bk.price / 100).toFixed(2));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const cents = Math.round(parseFloat(amount) * 100);
    if (isNaN(cents) || cents <= 0) { setError('Montant invalide'); return; }
    setSaving(true);
    try {
      await recordPayment({
        booking_id: bookingId || undefined,
        amount: cents,
        method,
        note: note || undefined,
      });
      onRecorded();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  const unpaid = bookings.filter((b) => !b.payment_id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Enregistrer un paiement</h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', fontSize: 13, marginBottom: 14 }}>{error}</div>
            )}
            <div className="form-group">
              <label className="label">Lier à un RDV (optionnel)</label>
              <select className="input" value={bookingId} onChange={(e) => handleBookingChange(e.target.value)}>
                <option value="">— Paiement libre —</option>
                {unpaid.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.start_time?.slice(0, 5)} — {b.client_first_name} {b.client_last_name} — {b.service_name} ({formatPrice(b.price)})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="label">Montant (€)</label>
                <input className="input" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="25.00" />
              </div>
              <div className="form-group">
                <label className="label">Méthode</label>
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} required>
                  <option value="cash">Espèces</option>
                  <option value="cb">CB</option>
                  <option value="lydia">Lydia</option>
                  <option value="other">Autre</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Note (optionnel)</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: Pourboire, produit vendu..." />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || isClosed}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Caisse component
// ---------------------------------------------------------------------------

export default function Caisse() {
  const isMobile = useMobile();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayModal, setShowPayModal] = useState(false);
  const [closingNotes, setClosingNotes] = useState('');
  const [closing, setClosing] = useState(false);

  const dateStr = format(currentDate, 'yyyy-MM-dd');
  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
  const isClosed = !!data?.closing;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getDailyCash(dateStr);
      setData(result);
    } catch (err) {
      console.error('Caisse loadData error:', err);
    }
    setLoading(false);
  }, [dateStr]);

  useEffect(() => { loadData(); }, [loadData]);

  function goPrev() { setCurrentDate(subDays(currentDate, 1)); }
  function goNext() { setCurrentDate(addDays(currentDate, 1)); }
  function goToday() { setCurrentDate(new Date()); }

  async function handleMarkCompleted(bookingId) {
    try {
      await updateBookingStatus(bookingId, 'completed');
      loadData();
    } catch (err) { alert(err.message); }
  }

  async function handleDeletePayment(paymentId) {
    if (!confirm('Supprimer ce paiement ?')) return;
    try { await deletePayment(paymentId); loadData(); } catch (err) { alert(err.message); }
  }

  async function handleClose() {
    if (!confirm('Clôturer la caisse pour cette journée ? Cette action est définitive.')) return;
    setClosing(true);
    try {
      await closeRegister({ date: dateStr, notes: closingNotes || undefined });
      loadData();
    } catch (err) { alert(err.message); }
    setClosing(false);
  }

  const totals = data?.totals || {};
  const bookings = data?.bookings || [];
  const standalone = data?.standalone_payments || [];

  const paid = bookings.filter((b) => b.payment_id);
  const unpaid = bookings.filter((b) => !b.payment_id);

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Caisse du jour</h2>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {isClosed ? (
              <span style={{ color: '#22c55e', fontWeight: 600 }}>Journée clôturée</span>
            ) : (
              <span>Caisse ouverte</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={goPrev} style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(var(--overlay),0.08)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft /></button>
            <span style={{ fontSize: isMobile ? 12 : 14, fontWeight: 600, color: '#fff', textTransform: 'capitalize', minWidth: isMobile ? 120 : 180, textAlign: 'center', userSelect: 'none' }}>
              {format(currentDate, 'EEEE d MMMM yyyy', { locale: fr })}
            </span>
            <button onClick={goNext} style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(var(--overlay),0.08)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight /></button>
          </div>
          {!isToday && <button className="btn btn-secondary btn-sm" onClick={goToday}>Aujourd&apos;hui</button>}
          {!isClosed && <button className="btn btn-primary btn-sm" onClick={() => setShowPayModal(true)}>Encaisser</button>}
        </div>
      </div>

      {/* Body */}
      <div className="page-body">
        {loading ? (
          <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Chargement...</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            {/* Totals cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <TotalCard label="Total" amount={totals.grand_total || 0} color="#fff" />
              <TotalCard label="CB" amount={totals.total_cb || 0} color="#3b82f6" />
              <TotalCard label="Espèces" amount={totals.total_cash || 0} color="#22c55e" />
              <TotalCard label="Lydia" amount={totals.total_lydia || 0} color="#a855f7" />
              <TotalCard label="Autre" amount={totals.total_other || 0} color="#f59e0b" />
            </div>

            {/* Unpaid bookings */}
            {unpaid.length > 0 && (
              <div className="card" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#f59e0b' }}>
                  RDV non encaissés ({unpaid.length})
                </h3>
                <div style={{ display: 'grid', gap: 6 }}>
                  {unpaid.map((b) => (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(245,158,11,0.06)', borderRadius: 6, border: '1px solid rgba(245,158,11,0.12)' }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{b.start_time?.slice(0, 5)}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.client_first_name} {b.client_last_name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.service_name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontFamily: 'var(--font-display, Orbitron, monospace)', fontWeight: 800, fontSize: 13 }}>{formatPrice(b.price)}</span>
                        {b.status === 'confirmed' && (
                          <button className="btn btn-secondary btn-sm" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => handleMarkCompleted(b.id)} title="Marquer terminé">
                            <CheckIcon /> Terminé
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Paid bookings */}
            {paid.length > 0 && (
              <div className="card" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                  RDV encaissés ({paid.length})
                </h3>
                <div style={{ display: 'grid', gap: 4 }}>
                  {paid.map((b) => (
                    <PaymentRow
                      key={b.id}
                      time={b.start_time?.slice(0, 5)}
                      label={`${b.client_first_name} ${b.client_last_name} — ${b.service_name}`}
                      amount={b.payment_amount}
                      method={b.payment_method}
                      note={b.payment_note}
                      onDelete={!isClosed ? () => handleDeletePayment(b.payment_id) : null}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Standalone payments */}
            {standalone.length > 0 && (
              <div className="card" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                  Paiements libres ({standalone.length})
                </h3>
                <div style={{ display: 'grid', gap: 4 }}>
                  {standalone.map((p) => (
                    <PaymentRow
                      key={p.id}
                      time={p.paid_at ? new Date(p.paid_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '–'}
                      label={p.note || 'Paiement libre'}
                      amount={p.amount}
                      method={p.method}
                      sublabel={p.recorded_by_name}
                      onDelete={!isClosed ? () => handleDeletePayment(p.id) : null}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {bookings.length === 0 && standalone.length === 0 && (
              <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Aucun encaissement pour cette journée</div>
              </div>
            )}

            {/* Close register */}
            {!isClosed && (bookings.length > 0 || standalone.length > 0) && (
              <div className="card" style={{ padding: 16, borderColor: 'rgba(239,68,68,0.2)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Clôturer la caisse</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Une fois clôturée, vous ne pourrez plus ajouter ou supprimer de paiements pour cette journée.
                </p>
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="label">Notes de clôture (optionnel)</label>
                  <input className="input" value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} placeholder="Ex: Remise en banque effectuée" />
                </div>
                <button className="btn btn-danger btn-sm" onClick={handleClose} disabled={closing}>
                  {closing ? 'Clôture...' : 'Clôturer la journée'}
                </button>
              </div>
            )}

            {/* Closing info */}
            {isClosed && data.closing && (
              <div className="card" style={{ padding: 16, borderColor: 'rgba(34,197,94,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <CheckIcon />
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#22c55e' }}>Caisse clôturée</h3>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Clôturée le {new Date(data.closing.closed_at).toLocaleString('fr-FR')}
                  {data.closing.notes && <span> — {data.closing.notes}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showPayModal && (
        <RecordPaymentModal
          bookings={bookings}
          isClosed={isClosed}
          onClose={() => setShowPayModal(false)}
          onRecorded={() => { setShowPayModal(false); loadData(); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TotalCard({ label, amount, color }) {
  return (
    <div className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display, Orbitron, monospace)', fontWeight: 800, fontSize: 20, color }}>{formatPrice(amount)}</div>
    </div>
  );
}

function PaymentRow({ time, label, sublabel, amount, method, note, onDelete }) {
  const mc = METHOD_COLORS[method] || METHOD_COLORS.other;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(var(--overlay),0.04)', background: 'rgba(var(--overlay),0.02)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{time}</span>
        <div style={{ overflow: 'hidden', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
          {(sublabel || note) && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sublabel}{sublabel && note ? ' — ' : ''}{note}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: mc.bg, color: mc.text, border: `1px solid ${mc.border}`, textTransform: 'uppercase' }}>
          {METHOD_LABELS[method] || method}
        </span>
        <span style={{ fontFamily: 'var(--font-display, Orbitron, monospace)', fontWeight: 800, fontSize: 13 }}>{formatPrice(amount)}</span>
        {onDelete && (
          <button onClick={onDelete} style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid rgba(239,68,68,0.2)', background: 'transparent', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6, transition: 'opacity 0.15s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '1'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}>
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}
