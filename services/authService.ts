export type EgoricRole = 'owner' | 'director' | 'editor' | 'account';
export type EgoricPermission =
  | 'workspace:read'
  | 'workspace:write'
  | 'production:use'
  | 'review:write'
  | 'distribution:write'
  | 'finance:read'
  | 'finance:write'
  | 'team:read'
  | 'team:manage';

export interface EgoricUser {
  id: string;
  email: string;
  displayName: string;
  role: EgoricRole;
  workspaceOwnerEmail: string;
  status: 'active' | 'disabled';
  createdAt?: number;
  lastLoginAt?: number;
}

export interface EgoricInvite {
  email: string;
  displayName: string;
  role: Exclude<EgoricRole, 'owner'>;
  expiresAt: number;
  createdAt?: number;
}

export interface AuthState {
  authEnabled: boolean;
  setupRequired: boolean;
  user: EgoricUser | null;
  ownerEmailHint?: string;
}

export interface TeamState {
  users: EgoricUser[];
  invites: EgoricInvite[];
  canManage: boolean;
}

const ROLE_PERMISSIONS: Record<EgoricRole, Set<EgoricPermission | '*'>> = {
  owner: new Set(['*']),
  director: new Set(['workspace:read', 'workspace:write', 'production:use', 'review:write', 'distribution:write', 'finance:read', 'team:read']),
  editor: new Set(['workspace:read', 'workspace:write', 'production:use', 'review:write']),
  account: new Set(['workspace:read', 'workspace:write', 'review:write', 'distribution:write', 'finance:read', 'finance:write']),
};

export const roleCan = (role: EgoricRole | undefined, permission: EgoricPermission): boolean => (
  Boolean(role && (ROLE_PERMISSIONS[role].has('*') || ROLE_PERMISSIONS[role].has(permission)))
);

const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Yêu cầu thất bại (${response.status}).`);
  return payload;
};

export const loadAuthState = async (): Promise<AuthState> => {
  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    try {
      return await requestJson('/api/auth/state');
    } catch {
      return {
        authEnabled: false,
        setupRequired: false,
        user: {
          id: 'local-development',
          email: 'local@egoric.test',
          displayName: 'Egoric Local',
          role: 'owner',
          workspaceOwnerEmail: 'local@egoric.test',
          status: 'active',
        },
      };
    }
  }
  return requestJson('/api/auth/state');
};

export const bootstrapWorkspace = (input: {
  email: string;
  displayName: string;
  password: string;
  bootstrapToken: string;
}): Promise<{ user: EgoricUser }> => requestJson('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify(input) });

export const login = (email: string, password: string): Promise<{ user: EgoricUser }> => (
  requestJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
);

export const logout = (): Promise<{ signedOut: boolean }> => requestJson('/api/auth/logout', { method: 'POST', body: '{}' });

export const getInvite = (token: string): Promise<{ invite: EgoricInvite }> => (
  requestJson(`/api/auth/invites/${encodeURIComponent(token)}`)
);

export const acceptInvite = (token: string, displayName: string, password: string): Promise<{ user: EgoricUser }> => (
  requestJson('/api/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, displayName, password }) })
);

export const loadTeam = (): Promise<TeamState> => requestJson('/api/auth/team');

export const createInvite = (input: { email: string; displayName: string; role: Exclude<EgoricRole, 'owner'> }): Promise<{ invite: EgoricInvite; inviteUrl: string }> => (
  requestJson('/api/auth/invites', { method: 'POST', body: JSON.stringify(input) })
);

export const updateTeamUser = (userId: string, patch: Partial<Pick<EgoricUser, 'role' | 'status'>>): Promise<{ updated: true }> => (
  requestJson(`/api/auth/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(patch) })
);

export const ROLE_LABELS: Record<EgoricRole, { vi: string; en: string }> = {
  owner: { vi: 'Chủ sở hữu', en: 'Owner' },
  director: { vi: 'Đạo diễn', en: 'Director' },
  editor: { vi: 'Dựng phim', en: 'Editor' },
  account: { vi: 'Quản lý khách hàng', en: 'Account' },
};
