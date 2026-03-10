// ---------------------------------------------------------------------------
// TimeGrid
// ---------------------------------------------------------------------------

import { useState, useRef } from 'react';
import { format, isToday } from 'date-fns';
import { fr } from 'date-fns/locale';
import { HOUR_START, HOUR_END, GRID_HEIGHT, HOUR_HEIGHT, PX_PER_MIN, OFF_HOURS } from './helpers';
import NowIndicator from './NowIndicator';
import BlockedSlotBlock from './BlockedSlotBlock';
import BookingBlock from './BookingBlock';
import MinutePickerPopup from './MinutePickerPopup';

export default function TimeGrid({ days, barbers, bookingsByDayBarber, blockedByDayBarber, barberOffDays, barberSchedules, guestAssignments, onBookingClick, onBlockClick, onSlotClick, view, onSwipeLeft, onSwipeRight }) {
  const scrollRef = useRef(null);
  const gridBodyRef = useRef(null);
  const touchRef = useRef(null);
  const barberCount = barbers.length || 1;
  const isWeek = view === 'week';

  // Check if a barber is off on a given date (0=Monday convention)
  // Also handles guest assignments: resident away = off, guest without assignment = off
  function isBarberOff(barberId, date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const barber = barbers.find(b => b.id === barberId);

    // Check if this barber has a guest assignment on this date
    const ga = (guestAssignments || []).find(g => g.barber_id === barberId && g.date === dateStr);

    if (barber?.is_guest) {
      // Guest barber: only "on" if they have a guest assignment on this specific date
      return !ga;
    }

    // Resident barber: if they have a guest assignment elsewhere -> off
    if (ga) return true;

    // Normal off-day check
    const offSet = barberOffDays?.[barberId];
    if (!offSet || offSet.size === 0) return false;
    const jsDay = date.getDay(); // 0=Sunday
    const dow = jsDay === 0 ? 6 : jsDay - 1; // Convert to 0=Monday
    return offSet.has(dow);
  }

  // Get off-hours zones for a specific barber on a specific date
  function getBarberOffHours(barberId, date) {
    const jsDay = date.getDay();
    const dow = jsDay === 0 ? 6 : jsDay - 1;
    const sched = barberSchedules?.[barberId]?.[dow];
    if (!sched) return OFF_HOURS; // fallback to global off-hours
    const [sh, sm] = sched.start.split(':').map(Number);
    const [eh, em] = sched.end.split(':').map(Number);
    const startDecimal = sh + sm / 60;
    const endDecimal = eh + em / 60;
    const zones = [];
    if (startDecimal > HOUR_START) zones.push({ startHour: HOUR_START, endHour: startDecimal });
    if (endDecimal < HOUR_END) zones.push({ startHour: endDecimal, endHour: HOUR_END });
    return zones;
  }

  // Get guest assignment info for a barber on a specific date
  function getGuestInfo(barberId, date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    return (guestAssignments || []).find(g => g.barber_id === barberId && g.date === dateStr) || null;
  }

  // Minute picker state
  const [minutePicker, setMinutePicker] = useState(null); // { hour, dayStr, barberId, position: {top, left} }

  // Hover indicator state
  const [hoverInfo, setHoverInfo] = useState(null); // { barberId, dayStr, top, time }

  // Swipe to navigate days on mobile
  function handleTouchStart(e) {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function handleTouchEnd(e) {
    if (!touchRef.current) return;
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = e.changedTouches[0].clientY - touchRef.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    }
    touchRef.current = null;
  }

  // Build hour labels
  const hours = [];
  for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);

  return (
    <div
      ref={scrollRef}
      className="planning-grid-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(var(--overlay),0.08)',
        borderRadius: 10,
        background: 'var(--bg-card)',
        overflow: 'hidden',
      }}
    >
      {/* ===== STICKY HEADER (day names + barber names) ===== */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid rgba(var(--overlay),0.10)' }}>
        {/* Gutter spacer */}
        <div style={{ width: 52, minWidth: 52, borderRight: '1px solid rgba(var(--overlay),0.10)' }} />

        {/* Day headers */}
        {days.map((day) => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const current = isToday(day);
          return (
            <div key={dayStr} className={current ? 'planning-day-today-header' : ''} style={{ flex: 1, borderRight: '1px solid rgba(var(--overlay),0.25)', overflow: 'hidden' }}>
              {/* Day label */}
              <div style={{
                textAlign: 'center',
                padding: '6px 2px 4px',
                background: current ? 'rgba(34,197,94,0.06)' : 'transparent',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: current ? '#22c55e' : 'var(--text-secondary)' }}>
                  {format(day, isWeek ? 'EEE' : 'EEEE', { locale: fr })}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: current ? '#22c55e' : 'var(--text)', fontFamily: 'var(--font-display, Orbitron, monospace)', lineHeight: 1.2 }}>
                  {format(day, 'd')}
                </div>
              </div>
              {/* Barber sub-headers */}
              {barberCount > 1 && (
                <div style={{ display: 'flex', borderTop: '1px solid rgba(var(--overlay),0.06)' }}>
                  {barbers.map((b) => {
                    const off = isBarberOff(b.id, day);
                    const gi = getGuestInfo(b.id, day);
                    // Resident barber guesting elsewhere
                    const isAway = !b.is_guest && gi;
                    // Guest barber present today
                    const isGuestHere = b.is_guest && gi;
                    return (
                      <div key={b.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3px 1px', fontSize: 10, fontWeight: 700, color: off ? 'var(--text-muted)' : isGuestHere ? '#3b82f6' : 'var(--text-secondary)', borderRight: '1px solid rgba(var(--overlay),0.04)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em', opacity: off ? 0.5 : 1 }}>
                        {b.photo_url && (
                          <img src={b.photo_url} alt={b.name} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', marginBottom: 1, filter: off ? 'grayscale(1) opacity(0.4)' : 'none', border: isGuestHere ? '2px solid #3b82f6' : 'none' }} />
                        )}
                        {isAway ? (
                          <span title={`A ${gi.host_salon_id === 'grenoble' ? 'Grenoble' : 'Meylan'}`}>
                            <s>{b.name.split(' ')[0]}</s>
                            <span style={{ display: 'block', fontSize: 8, color: '#f59e0b', fontWeight: 600, lineHeight: 1 }}>
                              {gi.host_salon_id === 'grenoble' ? 'Grenoble' : 'Meylan'}
                            </span>
                          </span>
                        ) : isGuestHere ? (
                          <span>
                            {b.name.split(' ')[0]}
                            <span style={{ display: 'block', fontSize: 8, color: '#3b82f6', fontWeight: 600, lineHeight: 1 }}>
                              Invite
                            </span>
                          </span>
                        ) : off ? (
                          <s>{b.name.split(' ')[0]}</s>
                        ) : (
                          b.name.split(' ')[0]
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ===== SCROLLABLE BODY (time gutter + grid) ===== */}
      <div
        ref={gridBodyRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onScroll={() => { if (minutePicker) setMinutePicker(null); }}
      >
        <div style={{ display: 'flex', height: GRID_HEIGHT + 10, paddingTop: 10, position: 'relative' }}>
          {/* Now indicator — spans the entire grid width */}
          {days.some((d) => isToday(d)) && <NowIndicator />}

          {/* Time gutter */}
          <div style={{ width: 52, minWidth: 52, position: 'relative', borderRight: '1px solid rgba(var(--overlay),0.10)', flexShrink: 0 }}>
            {hours.map((h, i) => (
              <div key={h}>
                <div style={{ position: 'absolute', top: i * HOUR_HEIGHT - 7, right: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', userSelect: 'none' }}>
                  {String(h).padStart(2, '0')}:00
                </div>
                {i < hours.length - 1 && (
                  <div style={{ position: 'absolute', top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 - 6, right: 6, fontSize: 10, color: 'rgba(var(--overlay),0.35)', fontVariantNumeric: 'tabular-nums', userSelect: 'none' }}>
                    :30
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const current = isToday(day);

            return (
              <div key={dayStr} className={current ? 'planning-day-today' : ''} style={{ flex: 1, borderRight: '1px solid rgba(var(--overlay),0.25)', position: 'relative' }}>
                {/* Hour lines */}
                {hours.map((h, i) => (
                  <div key={`line-${h}`}>
                    <div style={{ position: 'absolute', top: i * HOUR_HEIGHT, left: 0, right: 0, borderTop: '1px solid rgba(var(--overlay),0.08)', pointerEvents: 'none' }} />
                    {i < hours.length - 1 && (
                      <div style={{ position: 'absolute', top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2, left: 0, right: 0, borderTop: '1px dashed rgba(var(--overlay),0.025)', pointerEvents: 'none' }} />
                    )}
                  </div>
                ))}

                {/* Barber columns */}
                <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
                  {barbers.map((barber, bIdx) => {
                    const key = `${dayStr}_${barber.id}`;
                    const dayBookings = bookingsByDayBarber[key] || [];
                    const dayBlocked = blockedByDayBarber?.[key] || [];
                    const barberIsOff = isBarberOff(barber.id, day);

                    return (
                      <div
                        key={barber.id}
                        className="planning-barber-col"
                        style={{
                          flex: 1,
                          position: 'relative',
                          borderRight: bIdx < barberCount - 1 ? '1px solid rgba(var(--overlay),0.04)' : 'none',
                          cursor: barberIsOff ? 'default' : 'pointer',
                          background: barberIsOff ? 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(var(--overlay),0.035) 6px, rgba(var(--overlay),0.035) 7px)' : 'transparent',
                          transition: 'background 0.15s',
                        }}
                        onClick={(e) => {
                          if (barberIsOff) return;
                          if (!gridBodyRef.current) return;
                          const rect = gridBodyRef.current.getBoundingClientRect();
                          const scrollTop = gridBodyRef.current.scrollTop;
                          const relativeY = (e.clientY - rect.top) + scrollTop - 10;
                          const totalMinutes = Math.round(relativeY / PX_PER_MIN / 5) * 5 + HOUR_START * 60;
                          const clamped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, totalMinutes));
                          const hour = Math.floor(clamped / 60);
                          setMinutePicker({
                            hour,
                            dayStr,
                            barberId: barber.id,
                            position: { top: e.clientY - 10, left: e.clientX + 10 },
                          });
                          setHoverInfo(null);
                        }}
                        onMouseMove={(e) => {
                          if (minutePicker) return;
                          if (!gridBodyRef.current) return;
                          const rect = gridBodyRef.current.getBoundingClientRect();
                          const scrollTop = gridBodyRef.current.scrollTop;
                          const relativeY = (e.clientY - rect.top) + scrollTop - 10;
                          const totalMinutes = Math.round(relativeY / PX_PER_MIN / 5) * 5 + HOUR_START * 60;
                          const clamped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, totalMinutes));
                          const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
                          const mm = String(clamped % 60).padStart(2, '0');
                          const topPx = (clamped - HOUR_START * 60) * PX_PER_MIN;
                          setHoverInfo({ barberId: barber.id, dayStr, top: topPx, time: `${hh}:${mm}` });
                        }}
                        onMouseLeave={() => setHoverInfo(null)}
                      >
                        {/* Off-hours zones per barber schedule (hatched, but clickable) */}
                        {!barberIsOff && getBarberOffHours(barber.id, day).map((zone) => (
                          <div key={`off-${zone.startHour}`} style={{
                            position: 'absolute',
                            top: (zone.startHour - HOUR_START) * 60 * PX_PER_MIN,
                            left: 0, right: 0,
                            height: (zone.endHour - zone.startHour) * 60 * PX_PER_MIN,
                            background: 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(var(--overlay),0.035) 6px, rgba(var(--overlay),0.035) 7px)',
                            pointerEvents: 'none',
                          }} />
                        ))}
                        {/* Off-day overlay */}
                        {barberIsOff && (
                          <div className="planning-day-off-overlay">
                            <span className="planning-day-off-badge">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>
                              Repos
                            </span>
                          </div>
                        )}
                        {/* Hover time indicator */}
                        {!barberIsOff && hoverInfo && hoverInfo.barberId === barber.id && hoverInfo.dayStr === dayStr && !minutePicker && (
                          <div className="planning-hover-indicator" style={{ top: hoverInfo.top }}>
                            <div className="planning-hover-label">+ {hoverInfo.time}</div>
                          </div>
                        )}
                        {dayBlocked.map((bs) => (
                          <BlockedSlotBlock key={bs.id} block={bs} onClick={onBlockClick} />
                        ))}
                        {dayBookings.map((bk) => (
                          <BookingBlock key={bk.id} booking={bk} onClick={onBookingClick} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Minute Picker Popup */}
      {minutePicker && (() => {
        const pickerKey = `${minutePicker.dayStr}_${minutePicker.barberId}`;
        const pickerBookings = bookingsByDayBarber[pickerKey] || [];
        const pickerBlocked = blockedByDayBarber?.[pickerKey] || [];
        const occupiedSlots = [
          ...pickerBookings.filter((b) => b.status !== 'cancelled').map((b) => {
            const [sh, sm] = (b.start_time || '').split(':').map(Number);
            const [eh, em] = (b.end_time || '').split(':').map(Number);
            return { startMin: sh * 60 + (sm || 0), endMin: eh * 60 + (em || 0) };
          }),
          ...pickerBlocked.map((b) => {
            const [sh, sm] = (b.start_time || '').split(':').map(Number);
            const [eh, em] = (b.end_time || '').split(':').map(Number);
            return { startMin: sh * 60 + (sm || 0), endMin: eh * 60 + (em || 0) };
          }),
        ];
        return (
          <MinutePickerPopup
            hour={minutePicker.hour}
            position={minutePicker.position}
            occupiedSlots={occupiedSlots}
            onClose={() => setMinutePicker(null)}
            onSelect={(time) => {
              const { dayStr, barberId } = minutePicker;
              setMinutePicker(null);
              onSlotClick?.(dayStr, barberId, time);
            }}
          />
        );
      })()}
    </div>
  );
}
