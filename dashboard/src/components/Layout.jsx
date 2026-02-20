import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useNotifications } from '../hooks/useNotifications';
import SearchBar from './SearchBar';

/** Bell SVG icon */
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/**
 * Formats a booking time for display in the notification dropdown.
 * Handles "HH:MM", ISO datetime strings, and "start_time" field variants.
 * @param {Object} booking
 * @returns {string}
 */
function formatTime(booking) {
  const raw = booking.time || booking.start_time || booking.datetime || '';
  if (!raw) return '--:--';
  if (raw.includes('T')) {
    const d = new Date(raw);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return raw.slice(0, 5);
}

/**
 * Extracts a human-readable client name from a booking object.
 * @param {Object} booking
 * @returns {string}
 */
function clientName(booking) {
  if (booking.client_name) return booking.client_name;
  if (booking.client?.name) return booking.client.name;
  const first = booking.client_first_name || booking.client?.first_name || '';
  const last = booking.client_last_name || booking.client?.last_name || '';
  if (first || last) return `${first} ${last}`.trim();
  return 'Client inconnu';
}

/**
 * Extracts the service name from a booking object.
 * @param {Object} booking
 * @returns {string}
 */
function serviceName(booking) {
  return booking.service_name || booking.service?.name || 'Service';
}

const NAV = [
  {
    to: '/analytics', label: 'Analytics',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>,
  },
  {
    to: '/planning', label: 'Planning',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  },
  {
    to: '/services', label: 'Prestations',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12L12 12"/><path d="M20 4L8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8L20 20"/></svg>,
  },
  {
    to: '/barbers', label: 'Barbers',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
  {
    to: '/clients', label: 'Clients',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  {
    to: '/history', label: 'Historique',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  },
  {
    to: '/sms', label: 'SMS',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  },
  {
    to: '/mailing', label: 'Mailing',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>,
  },
  {
    to: '/boutique', label: 'Boutique',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
  },
  {
    to: '/automation', label: 'Automation',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
  },
  {
    to: '/campaigns', label: 'Campagnes',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('bc_theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bc_theme', theme);
  }, [theme]);
  const toggle = () => setTheme((t) => t === 'dark' ? 'light' : 'dark');
  return { theme, toggle };
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { hasNew, newCount, bookings, markSeen } = useNotifications();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { theme, toggle: toggleTheme } = useTheme();

  // Close the dropdown when clicking anywhere outside it
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  function toggleDropdown() {
    setDropdownOpen((prev) => !prev);
  }

  function handleBookingClick() {
    setDropdownOpen(false);
    navigate('/planning');
  }

  function handleMarkAllRead() {
    markSeen();
    setDropdownOpen(false);
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/logo.png" alt="BarberClub" style={{ width: '100%', maxWidth: 160, filter: 'var(--logo-filter, invert(1))' }} />
        </div>

        {/* ---- Notification bell ---- */}
        <div className="notif-area" ref={dropdownRef}>
          <button
            className={`notif-bell-btn${hasNew ? ' notif-bell-btn--active' : ''}`}
            onClick={toggleDropdown}
            aria-label="Notifications"
          >
            <BellIcon />
            {hasNew && (
              <span className="notif-badge">
                {newCount > 99 ? '99+' : newCount}
              </span>
            )}
          </button>

          {dropdownOpen && (
            <div className="notif-dropdown">
              <div className="notif-dropdown-header">
                <span className="notif-dropdown-title">Nouvelles reservations</span>
                {hasNew && (
                  <button className="notif-mark-read" onClick={handleMarkAllRead}>
                    Tout marquer comme lu
                  </button>
                )}
              </div>

              <div className="notif-dropdown-body">
                {bookings.length === 0 ? (
                  <div className="notif-empty">Aucune nouvelle reservation</div>
                ) : (
                  bookings.map((b) => (
                    <button
                      key={b.id ?? b._id}
                      className="notif-item"
                      onClick={handleBookingClick}
                    >
                      <span className="notif-item-time">{formatTime(b)}</span>
                      <span className="notif-item-info">
                        <span className="notif-item-client">{clientName(b)}</span>
                        <span className="notif-item-service">{serviceName(b)}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <SearchBar />

        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-bottom-row">
            <div className="sidebar-user" style={{ flex: 1 }} onClick={() => { if (window.confirm('Se déconnecter ?')) logout(); }}>
              {user?.photo_url ? (
                <img
                  src={user.photo_url}
                  alt={user.name}
                  style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div className="sidebar-avatar">
                  {user?.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
              )}
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user?.name || 'Admin'}</div>
                <div className="sidebar-user-role">Deconnexion</div>
              </div>
            </div>
            <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}>
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
