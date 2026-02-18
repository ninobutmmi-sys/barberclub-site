import { useState, useEffect } from 'react';
import { getBookings, getBarbers, updateBookingStatus, deleteBooking } from '../api';
import { format, addDays, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

export default function Planning() {
  const [date, setDate] = useState(new Date());
  const [bookings, setBookings] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const dateStr = format(date, 'yyyy-MM-dd');
  const dateDisplay = format(date, 'EEEE d MMMM yyyy', { locale: fr });

  useEffect(() => {
    loadData();
  }, [dateStr]);

  async function loadData() {
    setLoading(true);
    try {
      const [b, bk] = await Promise.all([
        getBarbers(),
        getBookings({ date: dateStr, view: 'day' }),
      ]);
      setBarbers(b);
      setBookings(bk);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  async function handleStatus(id, status) {
    try {
      await updateBookingStatus(id, status);
      setSelected(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer ce rendez-vous ?')) return;
    try {
      await deleteBooking(id);
      setSelected(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  }

  const bookingsByBarber = barbers.map((barber) => ({
    ...barber,
    bookings: bookings
      .filter((b) => b.barber_id === barber.id)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
  }));

  const todayCount = bookings.length;
  const todayRevenue = bookings.reduce((sum, b) => sum + (b.price || 0), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Planning</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {todayCount} RDV &middot; {formatPrice(todayRevenue)} CA
          </p>
        </div>
        <div className="planning-toolbar">
          <div className="date-nav">
            <button className="date-nav-btn" onClick={() => setDate(subDays(date, 1))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <span className="date-display" style={{ textTransform: 'capitalize' }}>{dateDisplay}</span>
            <button className="date-nav-btn" onClick={() => setDate(addDays(date, 1))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setDate(new Date())}>
            Aujourd'hui
          </button>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="empty-state">Chargement...</div>
        ) : (
          <div className="planning-grid" style={{ gridTemplateColumns: `repeat(${barbers.length || 1}, 1fr)` }}>
            {bookingsByBarber.map((barber) => (
              <div className="barber-column" key={barber.id}>
                <div className="barber-column-header">
                  <div className="barber-column-avatar">
                    {barber.name.charAt(0)}
                  </div>
                  <div>
                    <div>{barber.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                      {barber.bookings.length} RDV
                    </div>
                  </div>
                </div>
                <div className="booking-list">
                  {barber.bookings.length === 0 ? (
                    <div className="empty-state" style={{ padding: 20 }}>
                      Aucun RDV
                    </div>
                  ) : (
                    barber.bookings.map((bk) => (
                      <div className="booking-card" key={bk.id} onClick={() => setSelected(bk)}>
                        <div className="booking-time">
                          {bk.start_time?.slice(0, 5)}
                        </div>
                        <div className="booking-info">
                          <div className="booking-client">
                            {bk.client_first_name} {bk.client_last_name}
                          </div>
                          <div className="booking-service">{bk.service_name}</div>
                        </div>
                        <span className={`badge badge-${bk.status}`}>
                          {bk.status === 'confirmed' ? 'Conf.' : bk.status === 'completed' ? 'Fait' : bk.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Booking detail modal */}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Rendez-vous</h3>
              <button className="btn-ghost" onClick={() => setSelected(null)}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Client</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{selected.client_first_name} {selected.client_last_name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Téléphone</span>
                  <span style={{ fontSize: 14 }}>{selected.client_phone}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Prestation</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{selected.service_name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Horaire</span>
                  <span style={{ fontSize: 14 }}>{selected.start_time?.slice(0, 5)} - {selected.end_time?.slice(0, 5)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Prix</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{formatPrice(selected.price)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Statut</span>
                  <span className={`badge badge-${selected.status}`}>{selected.status}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
              {selected.status === 'confirmed' && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => handleStatus(selected.id, 'completed')}>
                    Marquer terminé
                  </button>
                  <button className="btn btn-secondary btn-sm" style={{ color: 'var(--warning)' }} onClick={() => handleStatus(selected.id, 'no_show')}>
                    No-show
                  </button>
                </>
              )}
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(selected.id)}>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
