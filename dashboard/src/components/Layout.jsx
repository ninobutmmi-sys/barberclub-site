import { useState, useRef, useEffect, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { useNotifications } from '../hooks/useNotifications';
import { useWaitlistCount, useSystemHealth, useTasksOverdueCount } from '../hooks/useApi';
import TasksBell from './TasksBell';
import useMobile from '../hooks/useMobile';
import useOffline from '../hooks/useOffline';
import usePushNotifications from '../hooks/usePushNotifications';
import SearchBar from './SearchBar';
import LiveToasts from './LiveToasts';

/** Bell SVG icon */
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function formatTime(booking) {
  const raw = booking.time || booking.start_time || booking.datetime || '';
  if (!raw) return '--:--';
  if (raw.includes('T')) {
    const d = new Date(raw);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return raw.slice(0, 5);
}

function clientName(booking) {
  if (booking.client_name) return booking.client_name;
  if (booking.client?.name) return booking.client.name;
  const first = booking.client_first_name || booking.client?.first_name || '';
  const last = booking.client_last_name || booking.client?.last_name || '';
  if (first || last) return `${first} ${last}`.trim();
  return 'Client inconnu';
}

function serviceName(booking) {
  return booking.service_name || booking.service?.name || 'Service';
}

function barberName(booking) {
  return booking.barber_name || booking.barber?.first_name || '';
}

const NAV_GROUPS = [
  {
    label: null, // No label for main group
    items: [
      {
        to: '/analytics', label: 'Analytics',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>,
      },
      {
        to: '/planning', label: 'Planning',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
      },
      {
        to: '/objectives', label: 'Objectifs',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>,
      },
      {
        to: '/tasks', label: 'Tâches', badgeTasks: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
      },
    ],
  },
  {
    label: 'Gestion',
    items: [
      {
        to: '/services', label: 'Prestations',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12L12 12"/><path d="M20 4L8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8L20 20"/></svg>,
      },
      {
        to: '/boutique', label: 'Boutique',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
      },
      {
        to: '/portfolio', label: 'Portfolio',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
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
        to: '/faux-plans', label: 'Faux Plans',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>,
      },
      {
        to: '/history', label: 'Historique',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      },
      {
        to: '/waitlist', label: 'Liste d\'attente', badge: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></svg>,
      },
    ],
  },
  {
    label: 'Communication',
    items: [
      {
        to: '/messages', label: 'Messages',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
      },
    ],
  },
  {
    label: 'Système',
    items: [
      {
        to: '/system', label: 'Système',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>,
      },
    ],
  },
];

// Flat list for DRAWER_NAV compatibility
const NAV = NAV_GROUPS.flatMap((g) => g.items);

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

// Items shown in the "Plus" drawer on mobile
const DRAWER_NAV = [
  { to: '/objectives', label: 'Objectifs', icon: NAV.find(n => n.to === '/objectives').icon },
  { to: '/tasks', label: 'Tâches', icon: NAV.find(n => n.to === '/tasks').icon, badgeTasks: true },
  { to: '/services', label: 'Prestations', icon: NAV.find(n => n.to === '/services').icon },
  { to: '/boutique', label: 'Boutique', icon: NAV.find(n => n.to === '/boutique').icon },
  { to: '/portfolio', label: 'Portfolio', icon: NAV.find(n => n.to === '/portfolio').icon },
  { to: '/barbers', label: 'Barbers', icon: NAV.find(n => n.to === '/barbers').icon },
  { to: '/faux-plans', label: 'Faux Plans', icon: NAV.find(n => n.to === '/faux-plans').icon },
  { to: '/history', label: 'Historique', icon: NAV.find(n => n.to === '/history').icon },
  { to: '/waitlist', label: 'Liste d\'attente', icon: NAV.find(n => n.to === '/waitlist').icon, badge: true },
  { to: '/messages', label: 'Messages', icon: NAV.find(n => n.to === '/messages').icon },
];

const SALON_LABELS = { meylan: 'Meylan', grenoble: 'Grenoble' };

export default function Layout() {
  const { user, salon, logout, clearSalon } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMobile();
  const { hasNew, newCount, bookings, clientActions, markSeen } = useNotifications();
  const waitlistCountQuery = useWaitlistCount();
  const waitlistCount = waitlistCountQuery.data?.count ?? 0;
  const tasksOverdueQuery = useTasksOverdueCount();
  const tasksOverdueCount = tasksOverdueQuery.data?.count ?? 0;
  const push = usePushNotifications();
  const isOffline = useOffline();
  const healthQuery = useSystemHealth({ refetchInterval: 5 * 60 * 1000, staleTime: 4 * 60 * 1000 });
  const brevoAlert = useMemo(() => {
    const status = healthQuery.data?.notifications?.brevo_status;
    if (!status) return null;
    const disabled = Object.entries(status).filter(([, v]) => v?.keyDisabled);
    if (disabled.length === 0) return null;
    return disabled.map(([salon]) => salon);
  }, [healthQuery.data]);
  const brevoCreditsAlert = useMemo(() => {
    const status = healthQuery.data?.notifications?.brevo_status;
    if (!status) return null;
    const low = Object.entries(status)
      .filter(([, v]) => typeof v?.smsCredits === 'number' && v.smsCredits < (v.lowCreditThreshold ?? 50))
      .map(([salon, v]) => ({ salon, credits: v.smsCredits }));
    return low.length ? low : null;
  }, [healthQuery.data]);
  const offlineSince = useMemo(() => {
    if (!isOffline) return null;
    try {
      const ts = localStorage.getItem('bc_offline_cache_ts');
      if (ts) return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch {}
    return null;
  }, [isOffline]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const expandedDropdownRef = useRef(null);
  const collapsedDropdownRef = useRef(null);
  const { theme, toggle: toggleTheme } = useTheme();
  const [plusOpen, setPlusOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [logoutAction, setLogoutAction] = useState(null); // 'logout' or 'switch-salon'
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('bc_sidebar_collapsed');
    return saved === null ? true : saved === 'true';
  });

  function toggleSidebar() {
    setCollapsed((prev) => {
      localStorage.setItem('bc_sidebar_collapsed', String(!prev));
      return !prev;
    });
  }

  // Close the dropdown when clicking anywhere outside it
  useEffect(() => {
    function handleClickOutside(e) {
      const activeRef = collapsed ? collapsedDropdownRef : expandedDropdownRef;
      if (activeRef.current && !activeRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen, collapsed]);

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
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        {/* Logo + collapse toggle */}
        <div className="sidebar-logo">
          <img src="/logo.png" alt="BarberClub" className="sidebar-logo-img" style={{ filter: 'var(--logo-filter, invert(1))' }} />
          <button className="sidebar-collapse-btn" onClick={toggleSidebar} title={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'} aria-label={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
            </svg>
          </button>
        </div>

        {/* ---- Salon badge ---- */}
        {!collapsed && salon && (
          <button className="salon-badge" onClick={() => { setLogoutAction('switch-salon'); setShowLogoutModal(true); }} title="Changer de salon">
            <span className="salon-badge-name">{SALON_LABELS[salon] || salon}</span>
            <span className="salon-badge-change">Changer</span>
          </button>
        )}

        {/* ---- Tasks + Notification bells (expanded) ---- */}
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px' }}>
            <TasksBell collapsed={false} overdueCount={tasksOverdueCount} />
          </div>
        )}

        {/* ---- Notification bell ---- */}
        {!collapsed && (
          <div className="notif-area" ref={expandedDropdownRef}>
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

            {dropdownOpen && (() => {
              const rect = expandedDropdownRef.current?.getBoundingClientRect();
              const top = rect ? rect.bottom + 4 : 60;
              const left = rect ? rect.left : 16;
              return (
              <div className="notif-dropdown" role="region" aria-label="Notifications" aria-live="polite" style={{ top, left }}>
                <div className="notif-dropdown-header">
                  <span className="notif-dropdown-title">Notifications</span>
                  {hasNew && (
                    <button className="notif-mark-read" onClick={handleMarkAllRead}>
                      Tout marquer comme lu
                    </button>
                  )}
                </div>

                <div className="notif-dropdown-body">
                  {bookings.length === 0 && clientActions.length === 0 ? (
                    <div className="notif-empty">Aucune nouvelle notification</div>
                  ) : (
                    <>
                      {clientActions.map((a) => (
                        <button
                          key={a._id}
                          className="notif-item"
                          onClick={handleBookingClick}
                          style={{ borderLeft: `3px solid ${a.type === 'cancelled' ? '#ef4444' : '#f59e0b'}` }}
                        >
                          <span className="notif-item-time" style={{ color: a.type === 'cancelled' ? '#ef4444' : '#f59e0b', fontSize: 10, fontWeight: 700 }}>
                            {a.type === 'cancelled' ? 'ANNULÉ' : 'DÉPLACÉ'}
                          </span>
                          <span className="notif-item-info">
                            <span className="notif-item-client">{a.clientName || 'Client'}</span>
                            <span className="notif-item-service">{a.date} à {a.time}{a.barberName ? ` · ${a.barberName}` : ''}</span>
                          </span>
                        </button>
                      ))}
                      {bookings.map((b) => (
                        <button
                          key={b.id ?? b._id}
                          className="notif-item"
                          onClick={handleBookingClick}
                          style={{ borderLeft: '3px solid #22c55e' }}
                        >
                          <span className="notif-item-time">{formatTime(b)}</span>
                          <span className="notif-item-info">
                            <span className="notif-item-client">{clientName(b)}</span>
                            <span className="notif-item-service">{barberName(b) ? `${barberName(b)} · ${serviceName(b)}` : serviceName(b)}</span>
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
              );
            })()}
          </div>
        )}

        {/* Collapsed: salon initial */}
        {collapsed && salon && (
          <button
            className="sidebar-icon-btn"
            onClick={() => { setLogoutAction('switch-salon'); setShowLogoutModal(true); }}
            title={`Salon: ${SALON_LABELS[salon] || salon} — Cliquer pour changer`}
            aria-label="Changer de salon"
            style={{ fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            {(SALON_LABELS[salon] || salon).charAt(0)}
          </button>
        )}

        {/* Collapsed: tasks icon */}
        {collapsed && (
          <div className="sidebar-collapsed-bell">
            <TasksBell collapsed={true} overdueCount={tasksOverdueCount} />
          </div>
        )}

        {/* Collapsed: small bell icon */}
        {collapsed && (
          <div className="sidebar-collapsed-bell" ref={collapsedDropdownRef}>
            <button
              className={`sidebar-icon-btn${hasNew ? ' has-notif' : ''}`}
              onClick={toggleDropdown}
              title="Notifications"
              aria-label="Notifications"
            >
              <BellIcon />
              {hasNew && <span className="sidebar-icon-badge">{newCount > 9 ? '9+' : newCount}</span>}
            </button>
            {dropdownOpen && (
              <div className="notif-dropdown" style={{ position: 'fixed', left: 70, top: 80, width: 300 }}>
                <div className="notif-dropdown-header">
                  <span className="notif-dropdown-title">Notifications</span>
                  {hasNew && (
                    <button className="notif-mark-read" onClick={handleMarkAllRead}>
                      Tout marquer comme lu
                    </button>
                  )}
                </div>
                <div className="notif-dropdown-body">
                  {bookings.length === 0 && clientActions.length === 0 ? (
                    <div className="notif-empty">Aucune nouvelle notification</div>
                  ) : (
                    <>
                    {clientActions.map((a) => (
                      <button key={a._id} className="notif-item" onClick={handleBookingClick} style={{ borderLeft: `3px solid ${a.type === 'cancelled' ? '#ef4444' : '#f59e0b'}` }}>
                        <span className="notif-item-time" style={{ color: a.type === 'cancelled' ? '#ef4444' : '#f59e0b', fontSize: 10, fontWeight: 700 }}>{a.type === 'cancelled' ? 'ANNULÉ' : 'DÉPLACÉ'}</span>
                        <span className="notif-item-info">
                          <span className="notif-item-client">{a.clientName || 'Client'}</span>
                          <span className="notif-item-service">{a.date} à {a.time}</span>
                        </span>
                      </button>
                    ))}
                    {bookings.map((b) => (
                      <button key={b.id ?? b._id} className="notif-item" onClick={handleBookingClick} style={{ borderLeft: '3px solid #22c55e' }}>
                        <span className="notif-item-time">{formatTime(b)}</span>
                        <span className="notif-item-info">
                          <span className="notif-item-client">{clientName(b)}</span>
                          <span className="notif-item-service">{barberName(b) ? `${barberName(b)} · ${serviceName(b)}` : serviceName(b)}</span>
                        </span>
                      </button>
                    ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!collapsed && <SearchBar />}

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="sidebar-nav-group">
              {group.label && <div className="sidebar-nav-group-label">{group.label}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                  data-tooltip={item.label}
                  title={collapsed ? item.label : undefined}
                >
                  {item.icon}
                  <span className="sidebar-link-label">{item.label}</span>
                  {item.badge && waitlistCount > 0 && (
                    <span style={{
                      marginLeft: 'auto', background: '#3b82f6', color: '#fff',
                      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                      minWidth: 18, textAlign: 'center', lineHeight: '16px',
                    }}>
                      {waitlistCount}
                    </span>
                  )}
                  {item.badgeTasks && tasksOverdueCount > 0 && (
                    <span style={{
                      marginLeft: 'auto', background: '#ef4444', color: '#fff',
                      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                      minWidth: 18, textAlign: 'center', lineHeight: '16px',
                    }}>
                      {tasksOverdueCount}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Push notification toggle */}
        {push.supported && !collapsed && (
          <div style={{ padding: '0 16px 8px' }}>
            <button
              onClick={push.subscribed ? push.unsubscribe : push.subscribe}
              disabled={push.loading}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 12,
                background: push.subscribed ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
                color: push.subscribed ? '#22c55e' : 'var(--text-secondary)',
                border: `1px solid ${push.subscribed ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: 'var(--font)', transition: 'all 0.2s',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {push.loading ? '...' : push.subscribed ? 'Notifs push actives' : 'Activer les notifs push'}
            </button>
          </div>
        )}

        <div className="sidebar-bottom">
          {collapsed ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <button className="sidebar-icon-btn" onClick={() => { setLogoutAction('logout'); setShowLogoutModal(true); }} title={user?.name || 'Déconnexion'} aria-label="Déconnexion">
                {user?.photo_url ? (
                  <img src={user.photo_url} alt={user.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{user?.name?.charAt(0)?.toUpperCase() || '?'}</span>
                )}
              </button>
              <button className="sidebar-icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'} aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}>
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          ) : (
            <div className="sidebar-bottom-row">
              <div className="sidebar-user" style={{ flex: 1 }} onClick={() => { setLogoutAction('logout'); setShowLogoutModal(true); }}>
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
                  <div className="sidebar-user-role">Déconnexion</div>
                </div>
              </div>
              <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'} aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}>
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className={`main-content${collapsed ? ' sidebar-is-collapsed' : ''}`}>
        {brevoAlert && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 101,
            padding: '10px 16px',
            background: 'rgba(220,38,38,0.15)',
            borderBottom: '1px solid rgba(220,38,38,0.3)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13, fontWeight: 600, color: '#ef4444',
            backdropFilter: 'blur(8px)',
          }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>
              Cle Brevo desactivee pour <strong>{brevoAlert.join(', ')}</strong> — les emails et SMS ne fonctionnent pas.
              {' '}Reactiver la cle sur <a href="https://app.brevo.com" target="_blank" rel="noopener noreferrer" style={{ color: '#ef4444', textDecoration: 'underline' }}>app.brevo.com</a>
            </span>
          </div>
        )}
        {brevoCreditsAlert && !brevoAlert && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 101,
            padding: '10px 16px',
            background: 'rgba(245,158,11,0.15)',
            borderBottom: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13, fontWeight: 600, color: '#f59e0b',
            backdropFilter: 'blur(8px)',
          }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>
              Credits SMS Brevo bas : {brevoCreditsAlert.map(c => `${c.salon} (${c.credits} restants)`).join(', ')}.
              {' '}Recharger sur <a href="https://app.brevo.com" target="_blank" rel="noopener noreferrer" style={{ color: '#f59e0b', textDecoration: 'underline' }}>app.brevo.com</a>
            </span>
          </div>
        )}
        {isOffline && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 100,
            padding: '8px 16px',
            background: 'rgba(245,158,11,0.15)',
            borderBottom: '1px solid rgba(245,158,11,0.25)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13, fontWeight: 600, color: '#f59e0b',
            backdropFilter: 'blur(8px)',
          }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
            </svg>
            Vous etes hors-ligne{offlineSince ? ` — donnees depuis ${offlineSince}` : ''}
          </div>
        )}
        <Outlet />
        <LiveToasts />
      </main>

      {/* ---- Mobile bottom nav ---- */}
      {isMobile && (
        <>
          <nav className="mob-bottom-nav">
            <NavLink to="/planning" className={({ isActive }) => `mob-nav-item${isActive ? ' active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Planning
            </NavLink>
            <NavLink to="/clients" className={({ isActive }) => `mob-nav-item${isActive ? ' active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Clients
            </NavLink>
            <NavLink to="/analytics" className={({ isActive }) => `mob-nav-item${isActive ? ' active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
              Analytics
            </NavLink>
            <NavLink to="/system" className={({ isActive }) => `mob-nav-item${isActive ? ' active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              Système
            </NavLink>
            <button
              className={`mob-nav-item${plusOpen || DRAWER_NAV.some(d => location.pathname === d.to) ? ' active' : ''}`}
              onClick={() => setPlusOpen(v => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Plus
            </button>
          </nav>

          {/* ---- Plus drawer ---- */}
          {plusOpen && (
            <>
              <div className="mob-plus-backdrop" onClick={() => setPlusOpen(false)} />
              <div className="mob-plus-drawer">
                <div className="mob-drawer-handle" />

                {DRAWER_NAV.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `mob-drawer-link${isActive ? ' active' : ''}`}
                    onClick={() => setPlusOpen(false)}
                  >
                    {item.icon}
                    <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                    {item.badge && waitlistCount > 0 && (
                      <span style={{ background: '#3b82f6', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>
                        {waitlistCount}
                      </span>
                    )}
                    {item.badgeTasks && tasksOverdueCount > 0 && (
                      <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>
                        {tasksOverdueCount}
                      </span>
                    )}
                  </NavLink>
                ))}

                <div className="mob-drawer-sep" />

                {/* Notifications */}
                <button
                  className="mob-drawer-link"
                  onClick={() => { setPlusOpen(false); navigate('/planning'); }}
                  style={{ border: 'none', width: '100%', background: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}
                >
                  <BellIcon />
                  <span style={{ flex: 1, textAlign: 'left' }}>Notifications</span>
                  {hasNew && (
                    <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>
                      {newCount > 99 ? '99+' : newCount}
                    </span>
                  )}
                </button>

                {/* Push notification toggle */}
                {push.supported && (
                  <button
                    className="mob-drawer-link"
                    onClick={push.subscribed ? push.unsubscribe : push.subscribe}
                    disabled={push.loading}
                    style={{
                      border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'var(--font)',
                      background: push.subscribed ? 'rgba(34,197,94,0.1)' : 'none',
                      color: push.subscribed ? '#22c55e' : 'var(--text)',
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      {push.subscribed && <path d="M2 2l20 20" stroke="#ef4444" strokeWidth="2" />}
                    </svg>
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      {push.loading ? 'Chargement...' : push.subscribed ? 'Désactiver notifs push' : 'Activer les notifs push'}
                    </span>
                    {push.subscribed && (
                      <span style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>ON</span>
                    )}
                  </button>
                )}

                <div className="mob-drawer-sep" />

                {/* Salon switch */}
                {salon && (
                  <button
                    className="mob-drawer-link"
                    onClick={() => { setPlusOpen(false); setLogoutAction('switch-salon'); setShowLogoutModal(true); }}
                    style={{ border: 'none', width: '100%', background: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      Salon: <strong>{SALON_LABELS[salon] || salon}</strong>
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Changer</span>
                  </button>
                )}

                <div className="mob-drawer-sep" />

                {/* User + theme */}
                <div className="mob-drawer-row">
                  <div className="mob-drawer-user" onClick={() => { setPlusOpen(false); setLogoutAction('logout'); setShowLogoutModal(true); }}>
                    <div className="mob-drawer-user-avatar">
                      {user?.photo_url
                        ? <img src={user.photo_url} alt={user.name} />
                        : <span>{user?.name?.charAt(0)?.toUpperCase() || '?'}</span>
                      }
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name || 'Admin'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Déconnexion</div>
                    </div>
                  </div>
                  <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'} aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}>
                    {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {/* ---- Logout/Switch confirmation modal ---- */}
      {showLogoutModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        }} onClick={() => setShowLogoutModal(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '28px 32px', maxWidth: 360, width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {logoutAction === 'switch-salon' ? 'Changer de salon ?' : 'Se déconnecter ?'}
            </h3>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {logoutAction === 'switch-salon'
                ? 'Vous serez déconnecté et redirigé vers le choix du salon.'
                : 'Vous devrez vous reconnecter pour accéder au dashboard.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '8px 20px', fontSize: 13 }}
                onClick={() => setShowLogoutModal(false)}
              >
                Annuler
              </button>
              <button
                className="btn btn-danger"
                style={{ padding: '8px 20px', fontSize: 13, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => {
                  setShowLogoutModal(false);
                  if (logoutAction === 'switch-salon') { clearSalon(); }
                  logout();
                }}
              >
                {logoutAction === 'switch-salon' ? 'Changer' : 'Déconnexion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
