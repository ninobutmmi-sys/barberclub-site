// ============================================
// BarberClub Dashboard — API Client
// ============================================

const API_BASE = 'http://localhost:3000/api';

function getTokens() {
  return {
    access: localStorage.getItem('bc_access_token'),
    refresh: localStorage.getItem('bc_refresh_token'),
  };
}

function setTokens(access, refresh) {
  localStorage.setItem('bc_access_token', access);
  localStorage.setItem('bc_refresh_token', refresh);
}

function clearTokens() {
  localStorage.removeItem('bc_access_token');
  localStorage.removeItem('bc_refresh_token');
  localStorage.removeItem('bc_user');
}

async function refreshAccessToken() {
  const { refresh } = getTokens();
  if (!refresh) throw new Error('No refresh token');

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });

  if (!res.ok) {
    clearTokens();
    throw new Error('Session expirée');
  }

  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

async function request(path, options = {}) {
  const { access } = getTokens();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (access) {
    headers['Authorization'] = `Bearer ${access}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401 && access) {
    try {
      const newToken = await refreshAccessToken();
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch {
      clearTokens();
      window.location.href = '/login';
      throw new Error('Session expirée');
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.details?.[0] || `Erreur ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ---- Auth ----
export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, type: 'barber' }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Identifiants invalides');
  }

  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  localStorage.setItem('bc_user', JSON.stringify(data.user));
  return data.user;
}

export async function logout() {
  const { refresh } = getTokens();
  try {
    await request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refresh }),
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
export const deleteBooking = (id) =>
  request(`/admin/bookings/${id}`, { method: 'DELETE' });

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

// ---- Admin: Clients ----
export const getClients = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/clients?${qs}`);
};
export const getClient = (id) => request(`/admin/clients/${id}`);
export const updateClient = (id, body) =>
  request(`/admin/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteClient = (id) =>
  request(`/admin/clients/${id}`, { method: 'DELETE' });

// ---- Admin: Analytics ----
export const getDashboard = () => request('/admin/analytics/dashboard');
export const getRevenue = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/analytics/revenue?${qs}`);
};
