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
import { usePlanningSocket } from '../hooks/useSocket';

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
  const [barberBreaks, setBarberBreaks] = useState({}); // { barberId: { dayOfWeek: { start, end } } }
  const [barberSchedules, setBarberSchedules] = useState({}); // { barberId: { dayOfWeek: { start, end } } }
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

  const loadData = useCallback(async (signal, { silent = false } = {}) => {
    if (!silent) setLoading(true);
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
      // Load schedules for all barbers to know off-days + working hours
      const offMap = {};
      const breakMap = {};
      const schedMap = {};
      await Promise.all(barberList.map(async (br) => {
        try {
          const sched = await getBarberSchedule(br.id);
          const offSet = new Set();
          const breaks = {};
          const hours = {};
          (sched.weekly || []).forEach((w) => {
            if (!w.is_working) offSet.add(w.day_of_week);
            else if (w.start_time && w.end_time) {
              hours[w.day_of_week] = { start: w.start_time.slice(0, 5), end: w.end_time.slice(0, 5) };
            }
            if (w.break_start && w.break_end) {
              breaks[w.day_of_week] = { start: w.break_start.slice(0, 5), end: w.break_end.slice(0, 5) };
            }
          });
          offMap[br.id] = offSet;
          breakMap[br.id] = breaks;
          schedMap[br.id] = hours;
        } catch { offMap[br.id] = new Set(); breakMap[br.id] = {}; schedMap[br.id] = {}; }
      }));
      if (signal?.aborted) return;
      setBarberOffDays(offMap);
      setBarberBreaks(breakMap);
      setBarberSchedules(schedMap);
    } catch (err) {
      if (signal?.aborted) return;
      console.error('Planning load error:', err);
      setError('Impossible de charger les donnees');
    }
    if (!signal?.aborted && !silent) setLoading(false);
  }, [apiDateStr, view]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  // Real-time updates via WebSocket (fallback: poll every 60s)
  const { dirty: wsDirty, consume: wsConsume } = usePlanningSocket();
  useEffect(() => {
    if (wsDirty) {
      wsConsume();
      loadData(undefined, { silent: true });
    }
  }, [wsDirty, wsConsume, loadData]);

  // Fallback polling every 60s + refresh on tab visibility
  useEffect(() => {
    let intervalId = setInterval(() => { loadData(undefined, { silent: true }); }, 60_000);
    function handleVisibility() {
      if (!document.hidden) loadData(undefined, { silent: true });
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => { clearInterval(intervalId); document.removeEventListener('visibilitychange', handleVisibility); };
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
    // Inject recurring breaks as virtual blocked slots
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd');
      const jsDay = day.getDay();
      const dow = jsDay === 0 ? 6 : jsDay - 1; // 0=Monday
      for (const barber of barbers) {
        const brk = barberBreaks[barber.id]?.[dow];
        if (!brk) continue;
        const key = `${dateStr}_${barber.id}`;
        if (!map[key]) map[key] = [];
        map[key].push({
          id: `break-${barber.id}-${dateStr}`,
          barber_id: barber.id,
          date: dateStr,
          start_time: brk.start,
          end_time: brk.end,
          type: 'break',
          reason: 'Pause',
          _isRecurring: true,
        });
      }
    }
    return map;
  }, [blockedSlots, days, barbers, barberBreaks]);

  const stats = useMemo(() => {
    const active = bookings.filter((b) => b.status !== 'cancelled');
    return { count: active.length, revenue: active.reduce((s, b) => s + (b.price || 0), 0) };
  }, [bookings]);


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

  // Booking block click -> detail modal on mobile, quick actions popover on desktop
  function handleBookingBlockClick(booking, rect) {
    if (isMobile) {
      setSelectedBooking(booking);
    } else {
      setQuickAction({ booking, rect });
    }
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
        <div className="page-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '8px 12px' }}>
          {/* Row 1: Month nav + Auj. + Bloquer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="plan-nav-btn" onClick={goPrevMonth} style={{ width: 24, height: 24 }}><ChevronLeft /></button>
              <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize', textAlign: 'center' }}>{monthDisplay}</span>
              <button className="plan-nav-btn" onClick={goNextMonth} style={{ width: 24, height: 24 }}><ChevronRight /></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="plan-today-btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setCurrentDate(new Date())}>Auj.</button>
              <button className="plan-block-btn" onClick={handleBlockClick} style={{ padding: '5px 8px', fontSize: 0 }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
              </button>
            </div>
          </div>
          {/* Row 2: KPIs */}
          <div className="plan-kpis" style={{ justifyContent: 'center', gap: 8 }}>
            <span className="plan-kpi-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span className="plan-kpi-val">{stats.count}</span>
            </span>
            <span className="plan-kpi-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              <span className="plan-kpi-val">{formatPrice(stats.revenue)}</span>
            </span>
          </div>
          {/* Row 2: Week day strip */}
          <MobileWeekStrip currentDate={currentDate} onSelectDate={setCurrentDate} hideMonthNav />

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
              barberSchedules={barberSchedules}
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
