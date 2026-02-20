import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Analytics from './pages/Analytics';
import Planning from './pages/Planning';
import Services from './pages/Services';
import Barbers from './pages/Barbers';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import History from './pages/History';
import Sms from './pages/Sms';
import Mailing from './pages/Mailing';
import Boutique from './pages/Boutique';
import Automation from './pages/Automation';
import Campaigns from './pages/Campaigns';
import Caisse from './pages/Caisse';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<Analytics />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="planning" element={<Planning />} />
            <Route path="services" element={<Services />} />
            <Route path="barbers" element={<Barbers />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<ClientDetail />} />
            <Route path="history" element={<History />} />
            <Route path="sms" element={<Sms />} />
            <Route path="mailing" element={<Mailing />} />
            <Route path="boutique" element={<Boutique />} />
            <Route path="automation" element={<Automation />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="caisse" element={<Caisse />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
