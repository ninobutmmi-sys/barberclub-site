// ============================================
// BarberClub Dashboard — Notification Hook
// Polls for new online bookings every 30s
// ============================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { getBookings } from '../api';

const POLL_INTERVAL = 30_000; // 30 seconds

function getStorageKey() {
  const salon = localStorage.getItem('bc_salon') || 'meylan';
  return `bc_seen_booking_ids_${salon}`;
}

/**
 * Formats today's date as YYYY-MM-DD for the API query.
 * @returns {string}
 */
function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Loads the set of previously-seen booking IDs from localStorage.
 * @returns {Set<string>}
 */
function loadSeenIds() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

/**
 * Persists the set of seen booking IDs to localStorage.
 * @param {Set<string>} ids
 */
function saveSeenIds(ids) {
  const arr = [...ids].slice(-500);
  localStorage.setItem(getStorageKey(), JSON.stringify(arr));
}

/**
 * Custom hook that polls for new bookings and exposes notification state.
 *
 * @returns {{
 *   hasNew: boolean,
 *   newCount: number,
 *   bookings: Array<Object>,
 *   markSeen: () => void,
 *   loading: boolean
 * }}
 */
export function useNotifications() {
  const [allBookings, setAllBookings] = useState([]);
  const [seenIds, setSeenIds] = useState(() => loadSeenIds());
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);
  const isFirstFetch = useRef(true);

  /**
   * Fetches today's bookings from the API and reconciles
   * new arrivals against the set of previously seen IDs.
   */
  const fetchBookings = useCallback(async () => {
    try {
      setLoading(true);
      const today = getTodayISO();
      const data = await getBookings({ date: today, view: 'day' });

      // The API may return { bookings: [...] } or a raw array
      const list = Array.isArray(data) ? data : (data?.bookings ?? []);

      // On the very first fetch we seed the seen set with whatever
      // is already there so we don't flash old bookings as "new".
      if (isFirstFetch.current) {
        isFirstFetch.current = false;
        const currentIds = new Set(list.map((b) => String(b.id ?? b._id)));
        const merged = new Set([...loadSeenIds(), ...currentIds]);
        setSeenIds(merged);
        saveSeenIds(merged);
      }

      setAllBookings(list);
    } catch (err) {
      // Silently swallow polling errors so the UI is not disrupted.
    } finally {
      setLoading(false);
    }
  }, []);

  // Bootstrap + interval (pause when tab is hidden)
  useEffect(() => {
    fetchBookings();

    function startPolling() {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchBookings, POLL_INTERVAL);
    }
    function stopPolling() {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    }
    function handleVisibility() {
      if (document.hidden) { stopPolling(); } else { fetchBookings(); startPolling(); }
    }

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => { stopPolling(); document.removeEventListener('visibilitychange', handleVisibility); };
  }, [fetchBookings]);

  // Derive the unseen bookings
  const newBookings = allBookings.filter(
    (b) => !seenIds.has(String(b.id ?? b._id))
  );

  /**
   * Marks every currently-visible booking as "seen" so the badge
   * disappears and the dropdown clears.
   */
  const markSeen = useCallback(() => {
    // Snapshot current IDs so we only mark what's visible now, not future arrivals
    const currentIds = allBookings.map((b) => String(b.id ?? b._id));
    setSeenIds((prev) => {
      const next = new Set(prev);
      currentIds.forEach((id) => next.add(id));
      saveSeenIds(next);
      return next;
    });
  }, [allBookings]);

  return {
    hasNew: newBookings.length > 0,
    newCount: newBookings.length,
    bookings: newBookings,
    markSeen,
    loading,
  };
}
