import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useMobile from '../hooks/useMobile';
import { useBookingsHistory, useBarbers } from '../hooks/useApi';
import * as api from '../api';
import { formatPrice, formatDateFR } from '../utils/format';

const LIMIT = 50;

function formatTime(time) {
  if (!time) return '-';
  return time.slice(0, 5);
}

export default function FauxPlans() {
  const isMobile = useMobile();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [barberFilter, setBarberFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loadingId, setLoadingId] = useState(null);
  const [fadingId, setFadingId] = useState(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data: barbers = [] } = useBarbers();

  const params = useMemo(() => ({
    status: 'no_show',
    limit: LIMIT,
    offset: page * LIMIT,
    sort: 'date',
    order: 'desc',
    ...(barberFilter && { barber_id: barberFilter }),
    ...(debouncedSearch && { search: debouncedSearch }),
  }), [barberFilter, debouncedSearch, page]);

  const { data, isLoading, error } = useBookingsHistory(params);
  const bookings = data?.bookings || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / LIMIT);

  // Stats
  const totalAmount = useMemo(() =>
    bookings.reduce((sum, b) => sum + (b.price || 0), 0),
    [bookings]
  );
  const clientCount = useMemo(() => {
    const s = new Set(bookings.map(b => b.client_id));
    return s.size;
  }, [bookings]);

  const handleMarkPaid = useCallback(async (booking) => {
    setLoadingId(booking.id);
    try {
      await api.updateBookingStatus(booking.id, 'completed');
      setFadingId(booking.id);
      setTimeout(() => {
        setFadingId(null);
        queryClient.invalidateQueries({ queryKey: ['bookingsHistory'] });
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
      }, 350);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoadingId(null);
    }
  }, [queryClient]);

  return (
    <div className="page-body">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Faux Plans</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>
            Marquer comme payé pour régulariser
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="fp-stats">
        <div className="fp-stat-card">
          <div className="fp-stat-icon" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <div className="fp-stat-text">
            <div className="fp-stat-value">{total}</div>
            <div className="fp-stat-label">Faux plans</div>
          </div>
        </div>
        <div className="fp-stat-card">
          <div className="fp-stat-icon" style={{ background: 'rgba(168,162,158,0.1)', color: 'var(--text-secondary)' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            </svg>
          </div>
          <div className="fp-stat-text">
            <div className="fp-stat-value">{clientCount}</div>
            <div className="fp-stat-label">Clients</div>
          </div>
        </div>
        <div className="fp-stat-card">
          <div className="fp-stat-icon" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div className="fp-stat-text">
            <div className="fp-stat-value fp-stat-danger">{formatPrice(totalAmount)}</div>
            <div className="fp-stat-label">Montant dû</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="fp-filters">
        <div className="fp-search-wrap">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fp-search-icon">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="input fp-search-input"
            placeholder="Rechercher un client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="fp-search-clear" onClick={() => setSearch('')}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        <select
          className="input"
          value={barberFilter}
          onChange={(e) => { setBarberFilter(e.target.value); setPage(0); }}
          style={{ width: isMobile ? '100%' : 180 }}
        >
          <option value="">Tous les barbers</option>
          {barbers.filter(b => b.is_active).map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
          {error.message}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="empty-state">
          <div className="fp-spinner" />
          <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Chargement...</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && bookings.length === 0 && (
        <div className="empty-state" style={{ padding: '48px 20px' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <p style={{ fontWeight: 600, fontSize: 15 }}>Aucun faux plan</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {debouncedSearch || barberFilter ? 'Aucun résultat pour cette recherche' : 'Tous les RDV ont été honorés'}
          </p>
        </div>
      )}

      {/* Mobile cards */}
      {!isLoading && bookings.length > 0 && isMobile && (
        <div className="fp-card-list">
          {bookings.map((b) => (
            <div
              key={b.id}
              className={`fp-card${fadingId === b.id ? ' fp-card-fade' : ''}`}
            >
              <div className="fp-card-top">
                <div className="fp-card-client">
                  <span className="fp-card-name">
                    {b.client_first_name} {b.client_last_name}
                  </span>
                  <span className="fp-card-meta">
                    {formatDateFR(b.date)} &middot; {formatTime(b.start_time)} &middot; {b.barber_name || '-'}
                  </span>
                </div>
                <span className="fp-card-price">{formatPrice(b.price || 0)}</span>
              </div>
              <div className="fp-card-bottom">
                <span className="fp-card-service">{b.service_name || '-'}</span>
                {b.no_show_sms_sent && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 6 }}>SMS envoyé</span>
                )}
                {b.client_phone && (
                  <a href={`tel:${b.client_phone}`} className="fp-card-phone">{b.client_phone}</a>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="fp-pay-btn"
                  style={{ flex: 1 }}
                  onClick={() => handleMarkPaid(b)}
                  disabled={loadingId === b.id}
                >
                  {loadingId === b.id ? (
                    <div className="fp-spinner-sm" />
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Faux plan payé
                    </>
                  )}
                </button>
                <button
                  className="fp-pay-btn"
                  style={{ flex: 0, padding: '0 14px', background: b.no_show_sms_sent ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', color: b.no_show_sms_sent ? '#22c55e' : '#f59e0b' }}
                  disabled={b.no_show_sms_sent}
                  onClick={async () => {
                    if (!confirm('Envoyer le SMS faux plan ?')) return;
                    try {
                      await api.sendNoShowSms(b.id);
                      queryClient.invalidateQueries({ queryKey: ['bookingsHistory'] });
                    } catch (e) { alert(e.message); }
                  }}
                >
                  {b.no_show_sms_sent ? '✓ SMS' : 'SMS'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Desktop table */}
      {!isLoading && bookings.length > 0 && !isMobile && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Téléphone</th>
                <th>Date</th>
                <th>Heure</th>
                <th>Barber</th>
                <th>Prestation</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'center', width: 130 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr
                  key={b.id}
                  className={fadingId === b.id ? 'fp-row-fade' : ''}
                >
                  <td style={{ fontWeight: 600 }}>{b.client_first_name} {b.client_last_name}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{b.client_phone || '-'}</td>
                  <td>{formatDateFR(b.date)}</td>
                  <td>{formatTime(b.start_time)}</td>
                  <td>{b.barber_name || '-'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{b.service_name || '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>{formatPrice(b.price || 0)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button
                        className="fp-pay-btn-sm"
                        onClick={() => handleMarkPaid(b)}
                        disabled={loadingId === b.id}
                      >
                        {loadingId === b.id ? '...' : (
                          <>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Payé
                          </>
                        )}
                      </button>
                      <button
                        className="fp-pay-btn-sm"
                        style={{ background: b.no_show_sms_sent ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', color: b.no_show_sms_sent ? '#22c55e' : '#f59e0b' }}
                        disabled={b.no_show_sms_sent}
                        onClick={async () => {
                          if (!confirm('Envoyer le SMS faux plan ?')) return;
                          try {
                            await api.sendNoShowSms(b.id);
                            queryClient.invalidateQueries({ queryKey: ['bookingsHistory'] });
                          } catch (e) { alert(e.message); }
                        }}
                        title={b.no_show_sms_sent ? 'SMS déjà envoyé' : 'Envoyer SMS faux plan'}
                      >
                        {b.no_show_sms_sent ? '✓ SMS' : 'SMS'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 20, fontSize: 13 }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            Précédent
          </button>
          <span style={{ color: 'var(--text-secondary)' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  );
}
