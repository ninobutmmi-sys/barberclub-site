// ============================================
// useSocket — Real-time WebSocket connection
// ============================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { API_BASE } from '../api';

// Socket.IO URL = API base without /api
const WS_URL = API_BASE.replace('/api', '');

let sharedSocket = null;
let refCount = 0;

function getSocket() {
  if (sharedSocket) {
    refCount++;
    return sharedSocket;
  }

  const token = localStorage.getItem('bc_access_token');
  if (!token) return null;

  sharedSocket = io(WS_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
  });

  sharedSocket.on('connect_error', (err) => {
    // If token expired, try refreshing
    if (err.message === 'Token invalide' || err.message === 'Token manquant') {
      const newToken = localStorage.getItem('bc_access_token');
      if (newToken && sharedSocket) {
        sharedSocket.auth = { token: newToken };
      }
    }
  });

  refCount = 1;
  return sharedSocket;
}

function releaseSocket() {
  refCount--;
  if (refCount <= 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    refCount = 0;
  }
}

/**
 * Hook to listen for real-time events
 * @param {string} event - Event name (e.g. 'booking:created')
 * @param {Function} callback - Handler function
 */
export function useSocketEvent(event, callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handler = (data) => callbackRef.current(data);
    socket.on(event, handler);

    return () => {
      socket.off(event, handler);
      releaseSocket();
    };
  }, [event]);
}

/**
 * Hook that returns true when any planning-relevant event fires.
 * Resets after being consumed (read).
 */
export function usePlanningSocket() {
  const [dirty, setDirty] = useState(false);

  const markDirty = useCallback(() => setDirty(true), []);

  useSocketEvent('booking:created', markDirty);
  useSocketEvent('booking:updated', markDirty);
  useSocketEvent('booking:cancelled', markDirty);
  useSocketEvent('booking:status', markDirty);
  useSocketEvent('blockedslot:changed', markDirty);

  const consume = useCallback(() => setDirty(false), []);

  return { dirty, consume };
}
