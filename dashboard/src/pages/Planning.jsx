// ---------------------------------------------------------------------------
// Main Planning component
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getBookings,
  getBarbers,
  getServices,
  updateBookingStatus,
  updateBooking,
  deleteBooking,
  deleteBookingGroup,
  getBlockedSlots,
  deleteBlockedSlot,
  getBarberSchedule,
  getGuestAssignments,
} from '../api';
import {
  format,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import useMobile from '../hooks/useMobile';

import { formatPrice } from '../components/planning/helpers';
import { ChevronLeft, ChevronRight, PlusIcon, RefreshIcon, CloseIcon } from '../components/planning/Icons';
import BookingQuickActions from '../components/planning/BookingQuickActions';
import BookingDetailModal from '../components/planning/BookingDetailModal';
import CreateBookingModal from '../components/planning/CreateBookingModal';
import BlockSlotModal from '../components/planning/BlockSlotModal';
import BlockDetailModal from '../components/planning/BlockDetailModal';
import TimeGrid from '../components/planning/TimeGrid';
import MobileWeekStrip from '../components/planning/MobileWeekStrip';

export default function Planning() {
  const isMobile = useMobile();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState(window.innerWidth < 1024 ? 'day' : 'week');
  const [bookings, setBookings] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [blockedSlots, setBlockedSlots] = useState([]);
  const [barberOffDays, setBarberOffDays] = useState({}); // { barberId: Set([0,6]) }
  const [guestAssignments, setGuestAssignments] = useState([]); // [{ barber_id, host_salon_id, date, barber_name, home_salon_id }]
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createDefaults, setCreateDefaults] = useState({});
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockDefaults, setBlockDefaults] = useState({});
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [quickAction, setQuickAction] = useState(null); // { booking, rect }

  // Force day view on mobile
  useEffect(() => {
    if (isMobile) setView('day');
  }, [isMobile]);

  const currentDateStr = format(currentDate, 'yyyy-MM-dd');

  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDateStr]);
  const weekEnd = useMemo(() => endOfWeek(currentDate, { weekStartsOn: 1 }), [currentDateStr]);

  const days = useMemo(() => {
    if (view === 'day') return [currentDate];
    const result = [];
    for (let i = 0; i < 7; i++) result.push(addDays(weekStart, i));
    return result;
  }, [view, weekStart, currentDateStr]);

  const apiDateStr = useMemo(
    () => format(view === 'week' ? weekStart : currentDate, 'yyyy-MM-dd'),
    [view, weekStart, currentDateStr]
  );

  const loadData = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [bk, b, s, bs, ga] = await Promise.all([
        getBookings({ date: apiDateStr, view }),
        getBarbers(),
        getServices(),
        getBlockedSlots({ date: apiDateStr, view }),
        getGuestAssignments().catch(() => []),
      ]);
      if (signal?.aborted) return;
      setBookings(Array.isArray(bk) ? bk : []);
      const barberList = Array.isArray(b) ? b : [];
      setBarbers(barberList);
      setServices(Array.isArray(s) ? s : []);
      setBlockedSlots(Array.isArray(bs) ? bs : []);
      setGuestAssignments(Array.isArray(ga) ? ga : []);
      // Load schedules for all barbers to know off-days
      const offMap = {};
      await Promise.all(barberList.map(async (br) => {
        try {
          const sched = await getBarberSchedule(br.id);
          const offSet = new Set();
          (sched.weekly || []).forEach((w) => { if (!w.is_working) offSet.add(w.day_of_week); });
          offMap[br.id] = offSet;
        } catch { offMap[br.id] = new Set(); }
      }));
      if (signal?.aborted) return;
      setBarberOffDays(offMap);
    } catch (err) {
      if (signal?.aborted) return;
      console.error('Planning load error:', err);
      setError('Impossible de charger les donnees');
    }
    if (!signal?.aborted) setLoading(false);
  }, [apiDateStr, view]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  // Auto-refresh every 30s (pause when tab is hidden)
  useEffect(() => {
    let intervalId = null;
    function startPolling() {
      intervalId = setInterval(() => { loadData(); }, 30_000);
    }
    function stopPolling() {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }
    function handleVisibility() {
      if (document.hidden) { stopPolling(); } else { loadData(); startPolling(); }
    }
    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => { stopPolling(); document.removeEventListener('visibilitychange', handleVisibility); };
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const bookingsByDayBarber = useMemo(() => {
    const map = {};
    for (const bk of bookings) {
      const dateStr = typeof bk.date === 'string' ? bk.date.slice(0, 10) : format(new Date(bk.date), 'yyyy-MM-dd');
      const key = `${dateStr}_${bk.barber_id}`;
      if (!map[key]) map[key] = [];
      map[key].push(bk);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    }
    return map;
  }, [bookings]);

  const blockedByDayBarber = useMemo(() => {
    const map = {};
    for (const bs of blockedSlots) {
      const dateStr = typeof bs.date === 'string' ? bs.date.slice(0, 10) : format(new Date(bs.date), 'yyyy-MM-dd');
      const key = `${dateStr}_${bs.barber_id}`;
      if (!map[key]) map[key] = [];
      map[key].push(bs);
    }
    return map;
  }, [blockedSlots]);

  const stats = useMemo(() => {
    const active = bookings.filter((b) => b.status !== 'cancelled');
    return { count: active.length, revenue: active.reduce((s, b) => s + (b.price || 0), 0) };
  }, [bookings]);

  // Next upcoming booking (mobile only)
  const nextBooking = useMemo(() => {
    if (!isMobile) return null;
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return bookings
      .filter(b => {
        const d = typeof b.date === 'string' ? b.date.slice(0, 10) : format(new Date(b.date), 'yyyy-MM-dd');
        return d === todayStr && b.status === 'confirmed';
      })
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
      .find(b => {
        const [h, m] = (b.start_time || '0:0').split(':').map(Number);
        return h * 60 + m > nowMin;
      }) || null;
  }, [bookings, isMobile]);

  const navDisplay = useMemo(() => {
    if (view === 'day') return format(currentDate, 'EEEE d MMMM yyyy', { locale: fr });
    return `${format(weekStart, 'd MMM', { locale: fr })} \u2013 ${format(weekEnd, 'd MMM yyyy', { locale: fr })}`;
  }, [view, currentDateStr, weekStart, weekEnd]);

  const monthDisplay = useMemo(() => format(currentDate, 'MMMM yyyy', { locale: fr }), [currentDateStr]);

  function goToday() { setCurrentDate(new Date()); }
  function goPrev() { setCurrentDate((prev) => view === 'week' ? subWeeks(prev, 1) : subDays(prev, 1)); }
  function goNext() { setCurrentDate((prev) => view === 'week' ? addWeeks(prev, 1) : addDays(prev, 1)); }
  function goPrevMonth() { setCurrentDate((prev) => subMonths(prev, 1)); }
  function goNextMonth() { setCurrentDate((prev) => addMonths(prev, 1)); }

  // Booking block click -> quick actions popover
  function handleBookingBlockClick(booking, rect) {
    setQuickAction({ booking, rect });
  }

  async function handleStatusChange(id, status) {
    try { await updateBookingStatus(id, status); setSelectedBooking(null); setQuickAction(null); loadData(); } catch (err) { alert(err.message); }
  }

  async function handleDeleteBooking(id, notify = false) {
    try { await deleteBooking(id, { notify }); setSelectedBooking(null); loadData(); } catch (err) { alert(err.message); }
  }

  async function handleDeleteBookingGroup(groupId, notify = false, futureOnly = false) {
    try { const res = await deleteBookingGroup(groupId, { notify, futureOnly }); setSelectedBooking(null); loadData(); return res; } catch (err) { alert(err.message); }
  }

  async function handleRescheduleBooking(id, data) {
    try {
      await updateBooking(id, data);
      setSelectedBooking(null);
      loadData();
    } catch (err) {
      throw err;
    }
  }

  function handleSlotClick(dateStr, barberId, time) {
    setCreateDefaults({ initialDate: dateStr, initialBarberId: barberId, initialTime: time });
    setShowCreateModal(true);
  }

  function handleCreateClick() {
    setCreateDefaults({ initialDate: format(currentDate, 'yyyy-MM-dd') });
    setShowCreateModal(true);
  }

  function handleCreated() {
    setShowCreateModal(false);
    setCreateDefaults({});
    loadData();
  }

  function handleBlockClick() {
    setBlockDefaults({ initialDate: format(currentDate, 'yyyy-MM-dd'), initialBarberId: barbers[0]?.id });
    setShowBlockModal(true);
  }

  function handleBlockCreated() {
    setShowBlockModal(false);
    setBlockDefaults({});
    loadData();
  }

  async function handleDeleteBlock(id) {
    if (!confirm('Supprimer ce blocage ?')) return;
    try { await deleteBlockedSlot(id); setSelectedBlock(null); loadData(); } catch (err) { alert(err.message); }
  }

  // Keyboard shortcuts: <-/-> = prev/next, T = today
  useEffect(() => {
    function handleKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (selectedBooking || showCreateModal || showBlockModal || selectedBlock || quickAction) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); goToday(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedBooking, showCreateModal, showBlockModal, selectedBlock, quickAction]);

  // Pull to refresh (mobile)
  const showPullRef = useRef(false);
  const [showPullRefresh, setShowPullRefresh] = useState(false);
  useEffect(() => { showPullRef.current = showPullRefresh; }, [showPullRefresh]);

  useEffect(() => {
    if (!isMobile) return;
    const el = document.querySelector('.main-content');
    if (!el) return;
    let startY = 0, pulling = false;
    function isInsideScrollableChild(target) {
      let node = target;
      while (node && node !== el) {
        if (node.scrollHeight > node.clientHeight && node.scrollTop > 0) return true;
        node = node.parentElement;
      }
      return false;
    }
    function onStart(e) {
      if (el.scrollTop > 0 || isInsideScrollableChild(e.target)) return;
      startY = e.touches[0].clientY;
      pulling = true;
    }
    function onMove(e) {
      if (!pulling) return;
      const delta = (e.touches?.[0]?.clientY || 0) - startY;
      if (delta > 60 && el.scrollTop <= 0) setShowPullRefresh(true);
      else if (delta <= 0) { pulling = false; setShowPullRefresh(false); }
    }
    function onEnd() {
      if (pulling && showPullRef.current) handleRefresh();
      pulling = false;
      setShowPullRefresh(false);
    }
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd); };
  }, [isMobile, handleRefresh]);


  return (
    <>
      {error && (
        <div role="alert" style={{ background: '#1c1917', border: '1px solid #dc2626', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fca5a5' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); loadData(); }} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Réessayer</button>
        </div>
      )}
      {/* Header */}
      {isMobile ? (
        <div className="page-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 className="page-title" style={{ fontSize: 18 }}>Planning</h2>
              <div className="plan-kpis">
                <span className="plan-kpi-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  <span className="plan-kpi-val">{stats.count}</span>
                </span>
                <span className="plan-kpi-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  <span className="plan-kpi-val">{formatPrice(stats.revenue)}</span>
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="plan-block-btn" onClick={handleBlockClick} style={{ padding: '6px 10px', fontSize: 11 }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
                Bloquer
              </button>
              <button className="plan-create-btn" onClick={handleCreateClick} style={{ padding: '6px 12px' }}>
                <PlusIcon size={14} /> Nouveau
              </button>
            </div>
          </div>
          {/* Week day strip — Timify-style */}
          <MobileWeekStrip currentDate={currentDate} onSelectDate={setCurrentDate} />

          {/* Next booking banner */}
          {nextBooking && format(currentDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginTop: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prochain</div>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {nextBooking.start_time?.slice(0, 5)} — {nextBooking.client_first_name} {nextBooking.client_last_name} · {nextBooking.service_name}
                </div>
              </div>
              {nextBooking.client_phone && (
                <a href={`tel:${nextBooking.client_phone.replace(/\s/g, '')}`} style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(34,197,94,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e', textDecoration: 'none', flexShrink: 0, border: '1px solid rgba(34,197,94,0.2)' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="plan-header">
          <div className="plan-left">
            <div className="plan-title-block">
              <h2>Planning</h2>
              <div className="plan-kpis">
                <span className="plan-kpi-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  RDV <span className="plan-kpi-val">{stats.count}</span>
                </span>
                <span className="plan-kpi-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  CA <span className="plan-kpi-val">{formatPrice(stats.revenue)}</span>
                </span>
              </div>
            </div>

            <div style={{ width: 1, height: 28, background: 'rgba(var(--overlay),0.08)' }} />

            <div className="plan-month-nav">
              <button className="plan-nav-btn" onClick={goPrevMonth} style={{ width: 28, height: 28 }}><ChevronLeft /></button>
              <span className="plan-month-label">{monthDisplay}</span>
              <button className="plan-nav-btn" onClick={goNextMonth} style={{ width: 28, height: 28 }}><ChevronRight /></button>
            </div>

            <div style={{ width: 1, height: 28, background: 'rgba(var(--overlay),0.08)' }} />

            <div className="plan-view-toggle">
              {['week', 'day'].map((v) => (
                <button key={v} className={`plan-view-btn${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
                  {v === 'week' ? 'Semaine' : 'Jour'}
                </button>
              ))}
            </div>

            <div className="plan-nav">
              <button className="plan-nav-btn" onClick={goPrev}><ChevronLeft /></button>
              <span className="plan-nav-label">{navDisplay}</span>
              <button className="plan-nav-btn" onClick={goNext}><ChevronRight /></button>
            </div>

            <button className="plan-today-btn" onClick={goToday}>Aujourd&apos;hui</button>
            <button className="plan-icon-btn" onClick={handleRefresh} disabled={refreshing} title="Actualiser">
              <RefreshIcon spinning={refreshing} />
            </button>
          </div>

          <div className="plan-controls">
            <button className="plan-block-btn" onClick={handleBlockClick}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
              Bloquer
            </button>
            <button className="plan-create-btn" onClick={handleCreateClick}>
              <PlusIcon size={13} /> Nouveau RDV
            </button>
          </div>
        </div>
      )}

      {/* Pull to refresh indicator */}
      {isMobile && showPullRefresh && (
        <div style={{ textAlign: 'center', padding: '10px 0', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {refreshing ? (
            <>
              <div style={{ width: 14, height: 14, border: '2px solid rgba(var(--overlay),0.1)', borderTopColor: 'var(--text-secondary)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              Actualisation...
            </>
          ) : 'Relacher pour actualiser'}
        </div>
      )}

      {/* Grid */}
      <div className="page-body" style={{ paddingBottom: 0 }}>
        {loading ? (
          <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Chargement du planning...</div>
          </div>
        ) : barbers.length === 0 ? (
          <div className="empty-state" style={{ minHeight: 300 }}>Aucun barber configuré.</div>
        ) : (
          <div key={view} className="planning-grid-animated">
            <TimeGrid
              days={days}
              barbers={barbers}
              bookingsByDayBarber={bookingsByDayBarber}
              blockedByDayBarber={blockedByDayBarber}
              barberOffDays={barberOffDays}
              onBookingClick={handleBookingBlockClick}
              onBlockClick={setSelectedBlock}
              onSlotClick={handleSlotClick}
              view={view}
              onSwipeLeft={goNext}
              onSwipeRight={goPrev}
              guestAssignments={guestAssignments}
            />
            {bookings.filter((b) => b.status !== 'cancelled').length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#a8a29e' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
                <p style={{ margin: 0, fontSize: 15 }}>Aucun rendez-vous ce jour</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FAB — mobile only */}
      {isMobile && !showCreateModal && !selectedBooking && !quickAction && (
        <button
          onClick={handleCreateClick}
          aria-label="Nouveau RDV"
          style={{
            position: 'fixed', bottom: 76, right: 16, zIndex: 100,
            width: 52, height: 52, borderRadius: '50%',
            background: '#3b82f6', color: '#fff', border: 'none',
            boxShadow: '0 4px 20px rgba(59,130,246,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'transform 0.15s',
          }}
          onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.9)'; }}
          onTouchEnd={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <PlusIcon size={22} />
        </button>
      )}

      {/* Quick Actions Popover */}
      {quickAction && (
        <BookingQuickActions
          booking={quickAction.booking}
          anchorRect={quickAction.rect}
          onViewDetail={(bk) => { setQuickAction(null); setSelectedBooking(bk); }}
          onDelete={(bk) => { setQuickAction(null); setSelectedBooking(bk); }}
          onStatusChange={(id, status) => { setQuickAction(null); handleStatusChange(id, status); }}
          onClose={() => setQuickAction(null)}
          isMobile={isMobile}
        />
      )}

      {/* Modals */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          barbers={barbers}
          services={services}
          onClose={() => setSelectedBooking(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDeleteBooking}
          onDeleteGroup={handleDeleteBookingGroup}
          onReschedule={handleRescheduleBooking}
          onNotesUpdated={(clientId, newNotes) => {
            setBookings((prev) => prev.map((b) =>
              b.client_id === clientId ? { ...b, client_notes: newNotes } : b
            ));
            setSelectedBooking((prev) => prev ? { ...prev, client_notes: newNotes } : prev);
          }}
        />
      )}

      {showCreateModal && (
        <CreateBookingModal
          barbers={barbers}
          services={services}
          onClose={() => { setShowCreateModal(false); setCreateDefaults({}); }}
          onCreated={handleCreated}
          {...createDefaults}
        />
      )}

      {showBlockModal && (
        <BlockSlotModal
          barbers={barbers}
          onClose={() => { setShowBlockModal(false); setBlockDefaults({}); }}
          onCreated={handleBlockCreated}
          {...blockDefaults}
        />
      )}

      {selectedBlock && (
        <BlockDetailModal
          block={selectedBlock}
          onClose={() => setSelectedBlock(null)}
          onDelete={handleDeleteBlock}
        />
      )}

    </>
  );
}
