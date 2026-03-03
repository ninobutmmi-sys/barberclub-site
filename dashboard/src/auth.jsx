import { createContext, useContext, useState } from 'react';
import { login as apiLogin, logout as apiLogout, getStoredUser } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [salon, setSalon] = useState(() => localStorage.getItem('bc_salon') || null);
  const [loading] = useState(false);

  const selectSalon = (id) => {
    localStorage.setItem('bc_salon', id);
    setSalon(id);
  };

  const clearSalon = () => {
    localStorage.removeItem('bc_salon');
    setSalon(null);
  };

  const login = async (email, password) => {
    const u = await apiLogin(email, password);
    setUser(u);
    return u;
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, salon, login, logout, selectSalon, clearSalon, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
