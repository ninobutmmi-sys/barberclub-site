// ---------------------------------------------------------------------------
// MobileWeekStrip — Timify-style day navigation for mobile
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import {
  format,
  addDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfWeek,
  isToday,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from './Icons';

const DAY_LABELS = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];

export default function MobileWeekStrip({ currentDate, onSelectDate, hideMonthNav }) {
  const weekMonday = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);
  const weekDays = useMemo(() => {
    const d = [];
    for (let i = 0; i < 7; i++) d.push(addDays(weekMonday, i));
    return d;
  }, [weekMonday]);

  const currentStr = format(currentDate, 'yyyy-MM-dd');
  const monthLabel = format(currentDate, 'MMM yyyy', { locale: fr });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: hideMonthNav ? 0 : 8 }}>
      {/* Month label + nav + Aujourd'hui */}
      {!hideMonthNav && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="plan-nav-btn" onClick={() => onSelectDate(subMonths(currentDate, 1))} style={{ width: 26, height: 26, flexShrink: 0 }}><ChevronLeft /></button>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize', minWidth: 90, textAlign: 'center' }}>{monthLabel}</span>
            <button className="plan-nav-btn" onClick={() => onSelectDate(addMonths(currentDate, 1))} style={{ width: 26, height: 26, flexShrink: 0 }}><ChevronRight /></button>
          </div>
          <button className="plan-today-btn" style={{ padding: '4px 10px', fontSize: 12, borderColor: 'rgba(255,255,255,0.7)', color: 'var(--text)' }} onClick={() => onSelectDate(new Date())}>Aujourd&apos;hui</button>
        </div>
      )}
      {/* Week nav arrows + Day buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button className="plan-nav-btn" onClick={() => onSelectDate(subWeeks(currentDate, 1))} style={{ width: 26, height: 26, flexShrink: 0 }}><ChevronLeft /></button>
        {weekDays.map((day, i) => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const isActive = dayStr === currentStr;
          const today = isToday(day);
          return (
            <button
              key={dayStr}
              onClick={() => onSelectDate(day)}
              style={{
                flex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                padding: '4px 0',
                border: isActive ? '2px solid var(--accent, #3b82f6)' : '1px solid transparent',
                borderRadius: 8,
                background: isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
                color: isActive ? 'var(--accent, #3b82f6)' : today ? 'var(--text)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: isActive || today ? 800 : 600, lineHeight: 1.2 }}>
                {format(day, 'd')}
              </span>
              <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'lowercase', letterSpacing: '0.02em', opacity: isActive ? 1 : 0.7 }}>
                {DAY_LABELS[i]}
              </span>
              {today && (
                <div style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: isActive ? 'var(--accent, #3b82f6)' : 'var(--text-muted)',
                }} />
              )}
            </button>
          );
        })}
        <button className="plan-nav-btn" onClick={() => onSelectDate(addWeeks(currentDate, 1))} style={{ width: 26, height: 26, flexShrink: 0 }}><ChevronRight /></button>
      </div>
    </div>
  );
}
