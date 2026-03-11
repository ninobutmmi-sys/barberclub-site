import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  },
});

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
        <Route path="system" element={<Suspense fallback={<PageLoader />}><System /></Suspense>} />

      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
