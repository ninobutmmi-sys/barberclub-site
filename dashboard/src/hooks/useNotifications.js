// ============================================
// BarberClub Dashboard — Notification Hook
// Polls for new online bookings every 30s
// ============================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { getBookings } from '../api';

const POLL_INTERVAL = 30_000; // 30 seconds
const STORAGE_KEY = 'bc_seen_booking_ids';

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
    const raw = localStorage.getItem(STORAGE_KEY);
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
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

  // Bootstrap + interval
  useEffect(() => {
    fetchBookings();
    intervalRef.current = setInterval(fetchBookings, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
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
    setSeenIds((prev) => {
      const next = new Set(prev);
      allBookings.forEach((b) => next.add(String(b.id ?? b._id)));
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
