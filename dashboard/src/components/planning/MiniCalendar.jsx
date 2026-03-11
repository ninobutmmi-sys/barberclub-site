import { useState, useEffect, useRef, useMemo } from 'react';
import {
  format,
  addMonths, subMonths,
  startOfMonth, endOfMonth,
  startOfWeek, endOfWeek,
  addDays, isSameDay, isSameMonth, isToday,
} from 'date-fns';
import { fr } from 'date-fns/locale';

const DAYS_HEADER = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];

export default function MiniCalendar({ currentDate, view, onSelectDate, onClose }) {
  const ref = useRef(null);
  const [month, setMonth] = useState(currentDate);

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Current week range (for highlighting)
  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);
  const weekEnd = useMemo(() => endOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);

  // Build calendar grid
  const weeks = useMemo(() => {
    const mStart = startOfMonth(month);
    const mEnd = endOfMonth(month);
    const gridStart = startOfWeek(mStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(mEnd, { weekStartsOn: 1 });

    const rows = [];
    let day = gridStart;
    while (day <= gridEnd) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        week.push(day);
        day = addDays(day, 1);
      }
      rows.push(week);
    }
    return rows;
  }, [month]);

  function handleDayClick(day) {
    onSelectDate(day);
    onClose();
  }

  function isInCurrentWeek(day) {
    return view === 'week' && day >= weekStart && day <= weekEnd;
  }

  return (
    <div ref={ref} className="mini-cal">
      <div className="mini-cal-header">
        <button className="mini-cal-arrow" onClick={() => setMonth(m => subMonths(m, 1))}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="mini-cal-month">{format(month, 'MMMM yyyy', { locale: fr })}</span>
        <button className="mini-cal-arrow" onClick={() => setMonth(m => addMonths(m, 1))}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div className="mini-cal-days-header">
        {DAYS_HEADER.map(d => <span key={d}>{d}</span>)}
      </div>

      <div className="mini-cal-grid">
        {weeks.map((week, wi) => (
          <div key={wi} className="mini-cal-week">
            {week.map((day, di) => {
              const inMonth = isSameMonth(day, month);
              const today = isToday(day);
              const selected = view === 'day' && isSameDay(day, currentDate);
              const inWeek = isInCurrentWeek(day);

              return (
                <button
                  key={di}
                  className={[
                    'mini-cal-day',
                    !inMonth && 'other-month',
                    today && 'today',
                    selected && 'selected',
                    inWeek && 'in-week',
                    inWeek && di === 0 && 'week-start',
                    inWeek && di === 6 && 'week-end',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleDayClick(day)}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
