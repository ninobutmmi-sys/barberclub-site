// ============================================
// BarberClub Dashboard — API Client
// ============================================

const API_PROD = 'https://api.barberclub-grenoble.fr/api';
const API_DEV = 'http://localhost:3000/api';
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? API_DEV
  : API_PROD;

export { API_BASE };

function getTokens() {
  return {
    access: localStorage.getItem('bc_access_token'),
    // refresh token is now in httpOnly cookie — not accessible from JS
  };
}

function setTokens(access) {
  localStorage.setItem('bc_access_token', access);
  // refresh token is set as httpOnly cookie by the backend
}

function clearTokens() {
  localStorage.removeItem('bc_access_token');
  localStorage.removeItem('bc_refresh_token'); // cleanup legacy
  localStorage.removeItem('bc_user');
}

let refreshPromise = null;

async function refreshAccessToken() {
  // If a refresh is already in progress, wait for it instead of firing another
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    // Refresh token is sent automatically via httpOnly cookie
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!res.ok) {
      clearTokens();
      throw new Error('Session expirée');
    }

    const data = await res.json();
    setTokens(data.access_token);
    return data.access_token;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function getSalonId() {
  return localStorage.getItem('bc_salon') || 'meylan';
}

async function request(path, options = {}) {
  const { access } = getTokens();
  const salonId = getSalonId();

  // Auto-inject salon_id into the path (GET requests)
  const separator = path.includes('?') ? '&' : '?';
  const fullPath = `${path}${separator}salon_id=${salonId}`;

  // Auto-inject salon_id into POST/PUT/PATCH body
  let finalOptions = { ...options };
  if (options.body && ['POST', 'PUT', 'PATCH'].includes((options.method || '').toUpperCase())) {
    try {
      const parsed = JSON.parse(options.body);
      finalOptions.body = JSON.stringify({ ...parsed, salon_id: salonId });
    } catch { /* not JSON, leave as-is */ }
  }

  const headers = {
    'Content-Type': 'application/json',
    ...finalOptions.headers,
  };

  if (access) {
    headers['Authorization'] = `Bearer ${access}`;
  }

  // Timeout: use caller's signal if provided, otherwise auto-abort after 15s
  const callerSignal = options.signal;
  let timeoutId;
  let controller;
  if (!callerSignal) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 15_000);
  }
  const signal = callerSignal || controller?.signal;

  const fetchOpts = { ...finalOptions, headers, credentials: 'include', signal };

  try {
    let res = await fetch(`${API_BASE}${fullPath}`, fetchOpts);

    // Auto-refresh on 401
    if (res.status === 401 && access) {
      try {
        const newToken = await refreshAccessToken();
        headers['Authorization'] = `Bearer ${newToken}`;
        res = await fetch(`${API_BASE}${fullPath}`, { ...fetchOpts, headers });
      } catch {
        clearTokens();
        window.location.reload();
        throw new Error('Session expirée');
      }
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.details?.[0] || `Erreur ${res.status}`);
    }

    if (res.status === 204) return null;
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError' && !callerSignal) {
      throw new Error('Le serveur ne répond pas (timeout 15s)');
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ---- Auth ----
export async function login(email, password) {
  const salonId = getSalonId();
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, type: 'barber', salon_id: salonId }),
    credentials: 'include', // receive httpOnly refresh token cookie
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Identifiants invalides');
  }

  const data = await res.json();
  setTokens(data.access_token);
  localStorage.setItem('bc_user', JSON.stringify(data.user));
  return data.user;
}

export async function logout() {
  try {
    // refresh token is sent automatically via httpOnly cookie
    await request('/auth/logout', {
      method: 'POST',
    });
  } catch { /* ignore */ }
  clearTokens();
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('bc_user'));
  } catch {
    return null;
  }
}

// ---- Admin: Bookings ----
export const getBookings = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/bookings?${qs}`);
};
export const createBooking = (body) =>
  request('/admin/bookings', { method: 'POST', body: JSON.stringify(body) });
export const updateBooking = (id, body) =>
  request(`/admin/bookings/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const updateBookingStatus = (id, status) =>
  request(`/admin/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const sendNoShowSms = (id) =>
  request(`/admin/bookings/${id}/no-show-sms`, { method: 'POST' });
export const deleteBooking = (id, { notify = false } = {}) =>
  request(`/admin/bookings/${id}?notify=${notify}`, { method: 'DELETE' });
export const deleteBookingGroup = (groupId, { notify = false, futureOnly = false } = {}) =>
  request(`/admin/bookings/group/${groupId}?notify=${notify}&future_only=${futureOnly}`, { method: 'DELETE' });
export const getBookingsHistory = (params) => {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  );
  const qs = new URLSearchParams(filtered).toString();
  return request(`/admin/bookings/history?${qs}`);
};

// ---- Admin: Services ----
export const getServices = () => request('/admin/services');
export const createService = (body) =>
  request('/admin/services', { method: 'POST', body: JSON.stringify(body) });
export const updateService = (id, body) =>
  request(`/admin/services/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteService = (id) =>
  request(`/admin/services/${id}`, { method: 'DELETE' });

// ---- Admin: Barbers ----
export const getBarbers = () => request('/admin/barbers');
export const updateBarber = (id, body) =>
  request(`/admin/barbers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const getBarberSchedule = (id) =>
  request(`/admin/barbers/${id}/schedule`);
export const updateBarberSchedule = (id, schedules) =>
  request(`/admin/barbers/${id}/schedule`, { method: 'PUT', body: JSON.stringify({ schedules }) });
export const addBarberOverride = (id, body) =>
  request(`/admin/barbers/${id}/overrides`, { method: 'POST', body: JSON.stringify(body) });
export const deleteBarberOverride = (id) =>
  request(`/admin/barbers/overrides/${id}`, { method: 'DELETE' });

// ---- Admin: Guest Assignments ----
export const getBarberGuestDays = (id) =>
  request(`/admin/barbers/${id}/guest-days`);
export const addBarberGuestDay = (id, body) =>
  request(`/admin/barbers/${id}/guest-days`, { method: 'POST', body: JSON.stringify(body) });
export const deleteBarberGuestDay = (id) =>
  request(`/admin/barbers/guest-days/${id}`, { method: 'DELETE' });
export const getGuestAssignments = () =>
  request('/admin/barbers/guest-assignments/list');

// ---- Admin: Clients ----
export const getClients = (params, signal) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/clients?${qs}`, signal ? { signal } : {});
};
export const getClient = (id) => request(`/admin/clients/${id}`);
export const getInactiveClients = () => request('/admin/clients/inactive');
export const updateClient = (id, body) =>
  request(`/admin/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteClient = (id) =>
  request(`/admin/clients/${id}`, { method: 'DELETE' });
export const getClientPhotos = (id) =>
  request(`/admin/clients/${id}/photos`);
export const uploadClientPhoto = (id, photoData) =>
  request(`/admin/clients/${id}/photos`, { method: 'POST', body: JSON.stringify({ photo_data: photoData }) });
export const deleteClientPhoto = (clientId, photoId) =>
  request(`/admin/clients/${clientId}/photos/${photoId}`, { method: 'DELETE' });
// ---- Admin: Blocked Slots ----
export const getBlockedSlots = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/blocked-slots?${qs}`);
};
export const createBlockedSlot = (body) =>
  request('/admin/blocked-slots', { method: 'POST', body: JSON.stringify(body) });
export const deleteBlockedSlot = (id) =>
  request(`/admin/blocked-slots/${id}`, { method: 'DELETE' });

// ---- Admin: Analytics ----
export const getDashboard = (params) => {
  const qs = params ? new URLSearchParams(params).toString() : '';
  return request(`/admin/analytics/dashboard${qs ? '?' + qs : ''}`);
};
export const getRevenue = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/analytics/revenue?${qs}`);
};
export const getPeakHours = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/analytics/peak-hours?${qs}`);
};
export const getOccupancy = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/analytics/occupancy?${qs}`);
};
export const getServiceStats = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/analytics/services?${qs}`);
};
export const getBarberStats = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/analytics/barbers?${qs}`);
};
export const getMemberStats = () => request('/admin/analytics/members');
export const getTrends = () => request('/admin/analytics/trends');
export const getNoShowStats = (params) => {
  const qs = params ? new URLSearchParams(params).toString() : '';
  return request(`/admin/analytics/no-shows${qs ? '?' + qs : ''}`);
};
export const getRevenueHourly = (params) => {
  const qs = params ? new URLSearchParams(params).toString() : '';
  return request(`/admin/analytics/revenue-hourly${qs ? '?' + qs : ''}`);
};

// ---- Admin: Waitlist ----
export const getWaitlist = (params) => {
  const qs = params ? new URLSearchParams(params).toString() : '';
  return request(`/admin/waitlist${qs ? '?' + qs : ''}`);
};
export const addToWaitlist = (body) =>
  request('/admin/waitlist', { method: 'POST', body: JSON.stringify(body) });
export const updateWaitlistEntry = (id, body) =>
  request(`/admin/waitlist/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteWaitlistEntry = (id) =>
  request(`/admin/waitlist/${id}`, { method: 'DELETE' });
export const notifyWaitlistSms = (id) =>
  request(`/admin/waitlist/${id}/notify-sms`, { method: 'POST' });
export const getWaitlistCount = () => request('/admin/waitlist/count');

// ---- Admin: Automation Triggers ----
export const getAutomationTriggers = () => request('/admin/automation');
export const updateAutomationTrigger = (type, body) =>
  request(`/admin/automation/${type}`, { method: 'PUT', body: JSON.stringify(body) });

// ---- Admin: Mailing ----
export const sendMailing = (body) =>
  request('/admin/mailing/send', { method: 'POST', body: JSON.stringify(body) });

// ---- Admin: SMS ----
export const sendSms = (body) =>
  request('/admin/sms/send', { method: 'POST', body: JSON.stringify(body) });

// ---- Admin: Notifications ----
export const getNotificationLogs = (params) => {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  );
  const qs = new URLSearchParams(filtered).toString();
  return request(`/admin/notifications/logs?${qs}`);
};
export const getNotificationStats = () => request('/admin/notifications/stats');
export const getBrevoStatus = () => request('/admin/notifications/brevo-status');
export const purgeFailedNotifications = () => request('/admin/notifications/failed', { method: 'DELETE' });

// ---- Admin: System Health ----
export const getSystemHealth = () => request('/admin/system/health');

// ---- Admin: Audit Log ----
export const getAuditLog = (params) => {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  );
  const qs = new URLSearchParams(filtered).toString();
  return request(`/admin/audit-log?${qs}`);
};

// ---- Admin: Campaign Tracking ----
export const getCampaigns = () => request('/admin/campaigns');
export const getCampaignROI = (id) => request(`/admin/campaigns/${id}/roi`);

// ---- Admin: Products ----
export const getProducts = (params) => {
  const qs = params ? new URLSearchParams(params).toString() : '';
  return request(`/admin/products${qs ? '?' + qs : ''}`);
};
export const getProductStats = () => request('/admin/products/stats');
export const getProductSales = (params) => {
  const qs = params ? new URLSearchParams(params).toString() : '';
  return request(`/admin/products/sales${qs ? '?' + qs : ''}`);
};
export const createProduct = (body) =>
  request('/admin/products', { method: 'POST', body: JSON.stringify(body) });
export const updateProduct = (id, body) =>
  request(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteProduct = (id) =>
  request(`/admin/products/${id}`, { method: 'DELETE' });
export const recordProductSale = (id, body) =>
  request(`/admin/products/${id}/sale`, { method: 'POST', body: JSON.stringify(body) });
export const getBookingSales = (bookingId) =>
  request(`/admin/products/sales/booking/${bookingId}`);
export const deleteSale = (saleId) =>
  request(`/admin/products/sales/${saleId}`, { method: 'DELETE' });

// ---- Admin: Gift Cards ----
export const getGiftCards = () => request('/admin/products/gift-cards');
export const createGiftCard = (body) =>
  request('/admin/products/gift-cards', { method: 'POST', body: JSON.stringify(body) });
export const updateGiftCard = (id, body) =>
  request(`/admin/products/gift-cards/${id}`, { method: 'PUT', body: JSON.stringify(body) });
