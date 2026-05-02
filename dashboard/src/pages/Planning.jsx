// ---------------------------------------------------------------------------
// Main Planning component
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import {
  updateBookingStatus as apiUpdateBookingStatus,
  updateBooking as apiUpdateBooking,
  deleteBooking as apiDeleteBooking,
  deleteBookingGroup as apiDeleteBookingGroup,
  deleteBlockedSlot as apiDeleteBlockedSlot,
  getBarberSchedule,
  addBarberOverride,
} from '../api';
import {
  useBookings,
  useBarbers,
  useServices,
  useBlockedSlots,
  useGuestAssignments,
  useTasksOverdueCount,
  keys,
} from '../hooks/useApi';
import TasksBell from '../components/TasksBell';
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
import OverrideModal from '../components/planning/OverrideModal';
import TimeGrid from '../components/planning/TimeGrid';
import MobileWeekStrip from '../components/planning/MobileWeekStrip';
import MiniCalendar from '../components/planning/MiniCalendar';

export default function Planning() {
  const { salon } = useAuth();
  const isMobile = useMobile();
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState(window.innerWidth < 1024 ? 'day' : 'week');
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createDefaults, setCreateDefaults] = useState({});
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockDefaults, setBlockDefaults] = useState({});
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [overrideBlock, setOverrideBlock] = useState(null);
  const [quickAction, setQuickAction] = useState(null);
  const [mobileFullDay, setMobileFullDay] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showMiniCal, setShowMiniCal] = useState(false);

  // Search client in planning
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedBookingId, setHighlightedBookingId] = useState(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef(null);

  // Barber schedules (loaded separately since they don't change often)
  const [barberOffDays, setBarberOffDays] = useState({});
  const [barberBreaks, setBarberBreaks] = useState({});
  const [barberSchedules, setBarberSchedules] = useState({});
  const [barberOverrides, setBarberOverrides] = useState({});

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

  // React Query hooks for planning data
  const bookingsQuery = useBookings({ date: apiDateStr, view }, { refetchInterval: 60_000 });
  const barbersQuery = useBarbers();
  const servicesQuery = useServices();
  const blockedSlotsQuery = useBlockedSlots({ date: apiDateStr, view }, { refetchInterval: 60_000 });
  const guestAssignmentsQuery = useGuestAssignments();
  const tasksOverdueQuery = useTasksOverdueCount();
  const tasksOverdueCount = tasksOverdueQuery.data?.count ?? 0;

  const bookings = useMemo(() => {
    const bk = bookingsQuery.data;
    return Array.isArray(bk) ? bk : [];
  }, [bookingsQuery.data]);
  const barbers = useMemo(() => {
    const b = barbersQuery.data;
    return Array.isArray(b) ? b.filter(x => x.is_active) : [];
  }, [barbersQuery.data]);
  const services = useMemo(() => {
    const s = servicesQuery.data;
    return Array.isArray(s) ? s : [];
  }, [servicesQuery.data]);
  const blockedSlots = useMemo(() => {
    const bs = blockedSlotsQuery.data;
    return Array.isArray(bs) ? bs : [];
  }, [blockedSlotsQuery.data]);
  const guestAssignments = useMemo(() => {
    const ga = guestAssignmentsQuery.data;
    return Array.isArray(ga) ? ga : [];
  }, [guestAssignmentsQuery.data]);

  const loading = bookingsQuery.isLoading && barbersQuery.isLoading;
  const error = bookingsQuery.error?.message || barbersQuery.error?.message || null;

  // Load barber schedules when barbers change
  useEffect(() => {
    if (barbers.length === 0) return;
    const offMap = {};
    const breakMap = {};
    const schedMap = {};
    const overrideMap = {};
    Promise.all(barbers.map(async (br) => {
      try {
        const cached = queryClient.getQueryData(keys.barberSchedule(br.id));
        const sched = cached || await queryClient.fetchQuery({
          queryKey: keys.barberSchedule(br.id),
          queryFn: () => getBarberSchedule(br.id),
          staleTime: 5 * 60_000,
        });
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
        // Index overrides by date for quick lookup
        const ov = {};
        (sched.overrides || []).forEach((o) => {
          const d = typeof o.date === 'string' ? o.date.slice(0, 10) : o.date;
          ov[d] = o;
        });
        overrideMap[br.id] = ov;
      } catch { offMap[br.id] = new Set(); breakMap[br.id] = {}; schedMap[br.id] = {}; overrideMap[br.id] = {}; }
    })).then(() => {
      setBarberOffDays(offMap);
      setBarberBreaks(breakMap);
      setBarberSchedules(schedMap);
      setBarberOverrides(overrideMap);
    });
  }, [barbers, queryClient]);

  // WebSocket: invalidate queries on real-time events
  const { dirty: wsDirty, consume: wsConsume } = usePlanningSocket();
  useEffect(() => {
    if (wsDirty) {
      wsConsume();
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['blockedSlots'] });
    }
  }, [wsDirty, wsConsume, queryClient]);

  function invalidatePlanning() {
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
    queryClient.invalidateQueries({ queryKey: ['blockedSlots'] });
  }

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['blockedSlots'] }),
        queryClient.invalidateQueries({ queryKey: keys.barbers }),
        queryClient.invalidateQueries({ queryKey: keys.services }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

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
    // Inject recurring breaks as virtual blocked slots (skip if override exists for that day)
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd');
      const jsDay = day.getDay();
      const dow = jsDay === 0 ? 6 : jsDay - 1; // 0=Monday
      for (const barber of barbers) {
        // Skip recurring break if an override exists for this day
        if (barberOverrides[barber.id]?.[dateStr]) continue;
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
  }, [blockedSlots, days, barbers, barberBreaks, barberOverrides]);

  const stats = useMemo(() => {
    const active = bookings.filter((b) => b.status !== 'cancelled');
    const billable = active.filter((b) => b.status !== 'no_show');
    return { count: active.length, revenue: billable.reduce((s, b) => s + (b.price || 0), 0) };
  }, [bookings]);

  // Search: filter bookings matching search term
  const searchResults = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return [];
    const q = searchTerm.toLowerCase();
    return bookings.filter((b) => {
      if (b.status === 'cancelled') return false;
      const full = `${b.client_first_name || ''} ${b.client_last_name || ''}`.toLowerCase();
      return full.includes(q);
    });
  }, [searchTerm, bookings]);

  // Auto-highlight if single result
  useEffect(() => {
    if (searchResults.length === 1) {
      setHighlightedBookingId(searchResults[0].id);
      setShowSearchResults(false);
    } else if (searchResults.length > 1) {
      setHighlightedBookingId(null);
      setShowSearchResults(true);
    } else {
      setHighlightedBookingId(null);
      setShowSearchResults(false);
    }
  }, [searchResults]);

  // Close search results dropdown on outside click
  useEffect(() => {
    if (!showSearchResults) return;
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearchResults(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSearchResults]);

  function selectSearchResult(bk) {
    setHighlightedBookingId(bk.id);
    setShowSearchResults(false);
  }

  function clearSearch() {
    setSearchTerm('');
    setHighlightedBookingId(null);
    setShowSearchResults(false);
  }

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
    try { await apiUpdateBookingStatus(id, status); setSelectedBooking(null); setQuickAction(null); invalidatePlanning(); } catch (err) { alert(err.message); }
  }

  async function handleDeleteBooking(id, notify = false) {
    try { await apiDeleteBooking(id, { notify }); setSelectedBooking(null); invalidatePlanning(); } catch (err) { alert(err.message); }
  }

  async function handleDeleteBookingGroup(groupId, notify = false, futureOnly = false) {
    try { const res = await apiDeleteBookingGroup(groupId, { notify, futureOnly }); setSelectedBooking(null); invalidatePlanning(); return res; } catch (err) { alert(err.message); }
  }

  async function handleRescheduleBooking(id, data) {
    try {
      await apiUpdateBooking(id, data);
      setSelectedBooking(null);
      invalidatePlanning();
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
    invalidatePlanning();
  }

  function handleBlockClick() {
    setBlockDefaults({ initialDate: format(currentDate, 'yyyy-MM-dd'), initialBarberId: barbers[0]?.id });
    setShowBlockModal(true);
  }

  function handleBlockCreated() {
    setShowBlockModal(false);
    setBlockDefaults({});
    invalidatePlanning();
  }

  async function handleDeleteBlock(id) {
    if (!confirm('Supprimer ce blocage ?')) return;
    try { await apiDeleteBlockedSlot(id); setSelectedBlock(null); invalidatePlanning(); } catch (err) { alert(err.message); }
  }

  function handleOverrideClick(block) {
    setOverrideBlock(block);
  }

  async function handleSaveOverride(data) {
    const barberId = overrideBlock?.barber_id;
    if (!barberId) return;
    await addBarberOverride(barberId, data);
    // Invalidate barber schedule cache so the pause updates
    queryClient.invalidateQueries({ queryKey: keys.barberSchedule(barberId) });
    // Re-fetch schedules
    const sched = await getBarberSchedule(barberId);
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
    const ov = {};
    (sched.overrides || []).forEach((o) => {
      const d = typeof o.date === 'string' ? o.date.slice(0, 10) : o.date;
      ov[d] = o;
    });
    setBarberOffDays((prev) => ({ ...prev, [barberId]: offSet }));
    setBarberBreaks((prev) => ({ ...prev, [barberId]: breaks }));
    setBarberSchedules((prev) => ({ ...prev, [barberId]: hours }));
    setBarberOverrides((prev) => ({ ...prev, [barberId]: ov }));
    invalidatePlanning();
  }

  // Keyboard shortcuts: <-/-> = prev/next, T = today, Escape = clear search
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && (searchTerm || highlightedBookingId)) {
        e.preventDefault();
        clearSearch();
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (selectedBooking || showCreateModal || showBlockModal || selectedBlock || overrideBlock || quickAction) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); goToday(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedBooking, showCreateModal, showBlockModal, selectedBlock, overrideBlock, quickAction, searchTerm, highlightedBookingId]);

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
          <button onClick={() => invalidatePlanning()} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Réessayer</button>
        </div>
      )}
      {/* Header */}
      {isMobile ? (
        <div className="page-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '8px 12px' }}>
          {/* Row 1: Month nav + KPIs + actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="plan-nav-btn" onClick={goPrevMonth} style={{ width: 24, height: 24 }}><ChevronLeft /></button>
              <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize', textAlign: 'center' }}>{monthDisplay}</span>
              <button className="plan-nav-btn" onClick={goNextMonth} style={{ width: 24, height: 24 }}><ChevronRight /></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="plan-kpi-chip" style={{ padding: '2px 6px' }}>
                <span className="plan-kpi-val">{stats.count}</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>rdv</span>
              </span>
              <button className="plan-today-btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setCurrentDate(new Date())}>Auj.</button>
              <button
                onClick={() => setMobileFullDay((v) => !v)}
                style={{
                  padding: '4px 7px', fontSize: 0, background: mobileFullDay ? 'rgba(59,130,246,0.15)' : 'rgba(var(--overlay),0.06)',
                  border: `1px solid ${mobileFullDay ? 'rgba(59,130,246,0.3)' : 'rgba(var(--overlay),0.10)'}`,
                  borderRadius: 6, cursor: 'pointer', color: mobileFullDay ? '#3b82f6' : 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                title={mobileFullDay ? 'Vue détaillée' : 'Vue journée'}
              >
                {mobileFullDay ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                )}
              </button>
              <button className="plan-block-btn" onClick={handleBlockClick} style={{ padding: '5px 8px', fontSize: 0 }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
              </button>
            </div>
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
                {salon !== 'grenoble' && (
                <span className="plan-kpi-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  CA <span className="plan-kpi-val">{formatPrice(stats.revenue)}</span>
                </span>
                )}
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

            <div className="plan-nav mini-cal-wrapper">
              <button className="plan-nav-btn" onClick={goPrev}><ChevronLeft /></button>
              <span className="plan-nav-label" onClick={() => setShowMiniCal(v => !v)}>{navDisplay}</span>
              <button className="plan-nav-btn" onClick={goNext}><ChevronRight /></button>
              {showMiniCal && (
                <MiniCalendar
                  currentDate={currentDate}
                  view={view}
                  onSelectDate={setCurrentDate}
                  onClose={() => setShowMiniCal(false)}
                />
              )}
            </div>

            <button className="plan-today-btn" onClick={goToday}>Aujourd&apos;hui</button>
            <button className="plan-icon-btn" onClick={handleRefresh} disabled={refreshing} title="Actualiser">
              <RefreshIcon spinning={refreshing} />
            </button>
            <TasksBell variant="planning" overdueCount={tasksOverdueCount} />
          </div>

          <div className="plan-controls">
            <div className="plan-search-wrapper" ref={searchRef}>
              <div className="plan-search-input-wrap">
                <svg className="plan-search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  className="plan-search-input"
                  type="text"
                  placeholder="Chercher un client..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <button className="plan-search-clear" onClick={clearSearch} title="Effacer">
                    <CloseIcon size={12} />
                  </button>
                )}
              </div>
              {showSearchResults && searchResults.length > 1 && (
                <div className="plan-search-dropdown">
                  {searchResults.map((bk) => {
                    const barber = barbers.find((b) => b.id === bk.barber_id);
                    return (
                      <button key={bk.id} className="plan-search-result" onClick={() => selectSearchResult(bk)}>
                        <span className="plan-search-result-name">{bk.client_first_name} {bk.client_last_name}</span>
                        <span className="plan-search-result-meta">
                          {bk.start_time?.slice(0, 5)} · {barber?.name?.split(' ')[0] || ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
      <div className="page-body" style={{ paddingBottom: 0, paddingLeft: isMobile ? 0 : undefined, paddingRight: isMobile ? 0 : undefined }}>
        {loading ? (
          <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Chargement du planning...</div>
          </div>
        ) : barbers.length === 0 ? (
          <div className="empty-state" style={{ minHeight: 300 }}>Aucun barber configuré.</div>
        ) : (
          <div key={`${view}-${mobileFullDay}`} className="planning-grid-animated">
            <TimeGrid
              days={days}
              barbers={barbers}
              bookingsByDayBarber={bookingsByDayBarber}
              blockedByDayBarber={blockedByDayBarber}
              barberOffDays={barberOffDays}
              barberSchedules={barberSchedules}
              onBookingClick={handleBookingBlockClick}
              onBlockClick={setSelectedBlock}
              onOverrideClick={handleOverrideClick}
              onSlotClick={handleSlotClick}
              view={view}
              onSwipeLeft={goNext}
              onSwipeRight={goPrev}
              guestAssignments={guestAssignments}
              compact={isMobile && mobileFullDay}
              highlightedBookingId={highlightedBookingId}
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
            invalidatePlanning();
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

      {overrideBlock && (() => {
        const dow = (() => { const js = new Date(overrideBlock.date).getDay(); return js === 0 ? 6 : js - 1; })();
        const sched = barberSchedules[overrideBlock.barber_id]?.[dow];
        return (
          <OverrideModal
            block={overrideBlock}
            barberName={barbers.find((b) => b.id === overrideBlock.barber_id)?.name || ''}
            barberScheduleStart={sched?.start || '09:00'}
            barberScheduleEnd={sched?.end || '19:00'}
            onSave={handleSaveOverride}
            onClose={() => setOverrideBlock(null)}
          />
        );
      })()}

    </>
  );
}
