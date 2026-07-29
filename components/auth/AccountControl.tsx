import React from 'react';
import { LogOut, UsersRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLocale } from '../../contexts/LocaleContext';
import { ROLE_LABELS } from '../../services/authService';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join('') || 'EG';

const AccountControl: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const auth = useAuth();
  const { locale } = useLocale();
  if (!auth.user) return null;
  if (compact) {
    return (
      <button type="button" onClick={auth.openTeamPanel} className="eg-icon-button flex h-11 w-11 items-center justify-center rounded-xl" aria-label={locale === 'vi' ? 'Tài khoản và đội ngũ' : 'Account and team'} title={auth.user.displayName}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-200/10 text-[9px] font-bold text-cyan-100">{initials(auth.user.displayName)}</span>
      </button>
    );
  }
  return (
    <div className="space-y-1">
      <button type="button" onClick={auth.openTeamPanel} className="eg-sidebar-tool flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-400 hover:bg-white/[.035] hover:text-white">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-200/10 text-[9px] font-bold text-cyan-100">{initials(auth.user.displayName)}</span>
        <span className="eg-sidebar-copy min-w-0 flex-1"><strong className="block truncate text-[11px] font-semibold text-zinc-200">{auth.user.displayName}</strong><span className="block truncate text-[9px] text-zinc-600">{ROLE_LABELS[auth.user.role][locale]}</span></span>
        <UsersRound className="eg-sidebar-copy h-3.5 w-3.5 text-zinc-700" />
      </button>
      <button type="button" onClick={() => void auth.logout()} className="eg-sidebar-tool flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-600 hover:bg-rose-300/[.05] hover:text-rose-200">
        <LogOut className="h-4 w-4 shrink-0" /><span className="eg-sidebar-copy text-[11px] font-medium">{locale === 'vi' ? 'Đăng xuất' : 'Sign out'}</span>
      </button>
    </div>
  );
};

export default AccountControl;
