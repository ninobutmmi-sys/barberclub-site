import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';

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
const Sms = lazy(() => import('./pages/Sms'));
const Mailing = lazy(() => import('./pages/Mailing'));
const SystemHealth = lazy(() => import('./pages/SystemHealth'));
const Automation = lazy(() => import('./pages/Automation'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const Caisse = lazy(() => import('./pages/Caisse'));

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
        <Route path="sms" element={<Suspense fallback={<PageLoader />}><Sms /></Suspense>} />
        <Route path="mailing" element={<Suspense fallback={<PageLoader />}><Mailing /></Suspense>} />
        <Route path="system" element={<Suspense fallback={<PageLoader />}><SystemHealth /></Suspense>} />
        <Route path="automation" element={<Suspense fallback={<PageLoader />}><Automation /></Suspense>} />
        <Route path="campaigns" element={<Suspense fallback={<PageLoader />}><Campaigns /></Suspense>} />
        <Route path="caisse" element={<Suspense fallback={<PageLoader />}><Caisse /></Suspense>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
