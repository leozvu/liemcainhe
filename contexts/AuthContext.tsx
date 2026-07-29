import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AuthState,
  EgoricPermission,
  EgoricUser,
  acceptInvite as acceptInviteRequest,
  bootstrapWorkspace,
  loadAuthState,
  login as loginRequest,
  logout as logoutRequest,
  roleCan,
} from '../services/authService';

interface AuthContextValue extends AuthState {
  loading: boolean;
  error: string | null;
  teamPanelOpen: boolean;
  can: (permission: EgoricPermission) => boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  bootstrap: (input: { email: string; displayName: string; password: string; bootstrapToken: string }) => Promise<void>;
  acceptInvite: (token: string, displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  openTeamPanel: () => void;
  closeTeamPanel: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const initialState: AuthState = { authEnabled: true, setupRequired: false, user: null };

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [state, setState] = useState<AuthState>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamPanelOpen, setTeamPanelOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await loadAuthState();
      setState(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không kiểm tra được phiên đăng nhập.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const adoptUser = (user: EgoricUser) => {
    setState((current) => ({ ...current, setupRequired: false, user }));
    setError(null);
  };

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    loading,
    error,
    teamPanelOpen,
    can: (permission) => roleCan(state.user?.role, permission),
    refresh,
    login: async (email, password) => adoptUser((await loginRequest(email, password)).user),
    bootstrap: async (input) => adoptUser((await bootstrapWorkspace(input)).user),
    acceptInvite: async (token, displayName, password) => adoptUser((await acceptInviteRequest(token, displayName, password)).user),
    logout: async () => {
      await logoutRequest();
      setState((current) => ({ ...current, user: null }));
      setTeamPanelOpen(false);
    },
    openTeamPanel: () => setTeamPanelOpen(true),
    closeTeamPanel: () => setTeamPanelOpen(false),
  }), [state, loading, error, teamPanelOpen, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
};
