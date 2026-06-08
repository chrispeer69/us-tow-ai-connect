'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  token: string | null;
  setToken: (token: string | null) => void;
  logout: () => void;
  isSuperAdmin: boolean;
}

function parseJwt(token: string) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('access_token');
    if (stored) {
      setTokenState(stored);
      const payload = parseJwt(stored);
      if (payload && payload.email) {
        const allowedEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_DEV_EMAIL || '')
          .split(',')
          .map((e: string) => e.trim().toLowerCase())
          .filter(Boolean);
        setIsSuperAdmin(allowedEmails.includes(payload.email.toLowerCase()));
      }
    }
    setLoading(false);
  }, []);

  const setToken = (newToken: string | null) => {
    setTokenState(newToken);
    if (newToken) {
      localStorage.setItem('access_token', newToken);
    } else {
      localStorage.removeItem('access_token');
    }
  };

  const logout = () => {
    setToken(null);
    window.location.href = '/sign-in';
  };

  if (loading) return null;

  return (
    <AuthContext.Provider value={{ token, setToken, logout, isSuperAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
