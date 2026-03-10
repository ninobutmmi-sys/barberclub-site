// ============================================
// WebSocket service — Socket.IO for real-time updates
// ============================================

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const logger = require('../utils/logger');

let io = null;

/**
 * Initialize Socket.IO on an existing HTTP server
 */
function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware — only barbers (dashboard) can connect
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token manquant'));
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      if (decoded.type !== 'barber') return next(new Error('Accès réservé'));
      socket.user = decoded;
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', (socket) => {
    const salonId = socket.user.salon_id || 'meylan';
    socket.join(`salon:${salonId}`);
    logger.debug('WS connected', { userId: socket.user.id, salon: salonId });

    socket.on('disconnect', () => {
      logger.debug('WS disconnected', { userId: socket.user.id });
    });
  });

  logger.info('WebSocket server initialized');
  return io;
}

/**
 * Emit a booking event to all dashboard users of a salon
 */
function emitBookingEvent(salonId, event, data) {
  if (!io) return;
  io.to(`salon:${salonId}`).emit(event, data);
}

// Convenience helpers
const emitBookingCreated = (salonId, booking) => emitBookingEvent(salonId, 'booking:created', booking);
const emitBookingUpdated = (salonId, booking) => emitBookingEvent(salonId, 'booking:updated', booking);
const emitBookingCancelled = (salonId, bookingId) => emitBookingEvent(salonId, 'booking:cancelled', { id: bookingId });
const emitBookingStatusChanged = (salonId, booking) => emitBookingEvent(salonId, 'booking:status', booking);
const emitBlockedSlotChanged = (salonId) => emitBookingEvent(salonId, 'blockedslot:changed', {});

module.exports = {
  init,
  emitBookingCreated,
  emitBookingUpdated,
  emitBookingCancelled,
  emitBookingStatusChanged,
  emitBlockedSlotChanged,
};
