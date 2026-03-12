import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';

// Keys to persist for offline mode
const OFFLINE_CACHE_KEYS = ['bookings', 'barbers', 'services', 'dashboard', 'blockedSlots'];

// Restore cache from localStorage on startup
function restoreCache(qc) {
  try {
    const raw = localStorage.getItem('bc_offline_cache');
    if (!raw) return;
    const entries = JSON.parse(raw);
    entries.forEach(({ key, data, dataUpdatedAt }) => {
      qc.setQueryData(key, data, { updatedAt: dataUpdatedAt });
    });
  } catch { /* corrupt cache, ignore */ }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  },
});

// Restore offline cache before first render
restoreCache(queryClient);

// Lazy-loaded pages (code splitting per route)
const SalonSelector = lazy(() => import('./pages/SalonSelector'));
const Login = lazy(() => import('./pages/Login'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Planning = lazy(() => import('./pages/Planning'));
const Services = lazy(() => import('./pages/Services'));
const Barbers = lazy(() => import('./pages/Barbers'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));
const History = lazy(() => import('./pages/History'));
const Messages = lazy(() => import('./pages/Messages'));
const Waitlist = lazy(() => import('./pages/Waitlist'));
const System = lazy(() => import('./pages/System'));
const PageLoader = () => (
  <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a8a29e' }}>
    Chargement...
  </div>
);

function AppRoutes() {
  const { user, salon, loading } = useAuth();

  if (loading) {
    return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0a0a0a',color:'#fff',fontFamily:'sans-serif'}}>Chargement...</div>;
  }

  if (!salon) {
    return (
      <Suspense fallback={<PageLoader />}>
        <SalonSelector />
      </Suspense>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Login />
      </Suspense>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Suspense fallback={<PageLoader />}><Planning /></Suspense>} />
        <Route path="analytics" element={<Suspense fallback={<PageLoader />}><Analytics /></Suspense>} />
        <Route path="planning" element={<Suspense fallback={<PageLoader />}><Planning /></Suspense>} />
        <Route path="services" element={<Suspense fallback={<PageLoader />}><Services /></Suspense>} />
        <Route path="barbers" element={<Suspense fallback={<PageLoader />}><Barbers /></Suspense>} />
        <Route path="clients" element={<Suspense fallback={<PageLoader />}><Clients /></Suspense>} />
        <Route path="clients/:id" element={<Suspense fallback={<PageLoader />}><ClientDetail /></Suspense>} />
        <Route path="history" element={<Suspense fallback={<PageLoader />}><History /></Suspense>} />
        <Route path="messages" element={<Suspense fallback={<PageLoader />}><Messages /></Suspense>} />
        <Route path="waitlist" element={<Suspense fallback={<PageLoader />}><Waitlist /></Suspense>} />
        <Route path="system" element={<Suspense fallback={<PageLoader />}><System /></Suspense>} />

      </Route>
    </Routes>
  );
}

function CachePersister() {
  useEffect(() => {
    let timer = null;
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const all = queryClient.getQueryCache().getAll();
          const entries = all
            .filter(q => q.state.data !== undefined && OFFLINE_CACHE_KEYS.some(k => q.queryKey[0] === k))
            .map(q => ({ key: q.queryKey, data: q.state.data, dataUpdatedAt: q.state.dataUpdatedAt }));
          localStorage.setItem('bc_offline_cache', JSON.stringify(entries));
          localStorage.setItem('bc_offline_cache_ts', new Date().toISOString());
        } catch { /* quota exceeded, ignore */ }
      }, 2000);
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, []);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <CachePersister />
        <AuthProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
