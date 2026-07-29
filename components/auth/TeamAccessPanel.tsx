import React, { FormEvent, useEffect, useState } from 'react';
import { Check, Copy, Loader2, LogOut, Mail, MailPlus, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLocale } from '../../contexts/LocaleContext';
import { EgoricInvite, EgoricInviteDelivery, EgoricRole, TeamState, ROLE_LABELS, createInvite, loadTeam, updateTeamUser } from '../../services/authService';

const STAFF_ROLES: Array<Exclude<EgoricRole, 'owner'>> = ['director', 'editor', 'account'];

const TeamAccessPanel: React.FC = () => {
  const auth = useAuth();
  const { locale, localeTag } = useLocale();
  const vi = locale === 'vi';
  const [team, setTeam] = useState<TeamState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<EgoricRole, 'owner'>>('editor');
  const [submitting, setSubmitting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<EgoricInvite | null>(null);
  const [delivery, setDelivery] = useState<EgoricInviteDelivery | null>(null);
  const [copied, setCopied] = useState(false);

  const canSeeTeam = auth.can('team:read') || auth.user?.role === 'owner';
  const canManage = auth.user?.role === 'owner';

  const refresh = async () => {
    if (!canSeeTeam) return;
    setLoading(true);
    try { setTeam(await loadTeam()); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được đội ngũ.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!auth.teamPanelOpen) return;
    setInviteUrl(null);
    setCreatedInvite(null);
    setDelivery(null);
    setCopied(false);
    void refresh();
  }, [auth.teamPanelOpen, canSeeTeam]);

  if (!auth.teamPanelOpen || !auth.user) return null;

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createInvite({ email, displayName, role });
      setInviteUrl(result.inviteUrl);
      setCreatedInvite(result.invite);
      setDelivery(result.delivery);
      setEmail('');
      setDisplayName('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được lời mời.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateUser = async (userId: string, patch: { role?: EgoricRole; status?: 'active' | 'disabled' }) => {
    setError(null);
    try { await updateTeamUser(userId, patch); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không đổi được quyền nhân sự.'); }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  const emailInvite = () => {
    if (!inviteUrl || !createdInvite) return;
    const roleLabel = ROLE_LABELS[createdInvite.role][locale];
    const subject = vi ? 'Lời mời tham gia Egoric Film Studio' : 'Invitation to Egoric Film Studio';
    const body = vi
      ? `Chào ${createdInvite.displayName},\n\nBạn được mời tham gia Egoric Film Studio với vai trò ${roleLabel}.\nKích hoạt tài khoản trong 7 ngày tại:\n${inviteUrl}`
      : `Hi ${createdInvite.displayName},\n\nYou have been invited to Egoric Film Studio as ${roleLabel}.\nActivate your account within 7 days:\n${inviteUrl}`;
    window.location.href = `mailto:${encodeURIComponent(createdInvite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const deliveryLabel = (status: EgoricInvite['deliveryStatus']) => {
    if (status === 'sent') return vi ? 'Email đã được provider tiếp nhận' : 'Email accepted by provider';
    if (status === 'failed') return vi ? 'Email tự động thất bại · link vẫn dùng được' : 'Automatic email failed · the link still works';
    return vi ? 'Email tự động chưa cấu hình · hãy gửi link thủ công' : 'Automatic email is not configured · send the link manually';
  };

  return (
    <div className="fixed inset-0 z-[420] flex justify-end bg-black/65 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="team-access-title" onMouseDown={(event) => { if (event.target === event.currentTarget) auth.closeTeamPanel(); }}>
      <aside className="eg-safe-scroll h-full w-full max-w-[620px] overflow-y-auto border-l border-white/[.09] bg-[var(--eg-canvas-soft)] shadow-2xl shadow-black/50">
        <header className="sticky top-0 z-10 flex min-h-[76px] items-center justify-between border-b border-white/[.08] bg-[rgba(9,13,18,.9)] px-5 backdrop-blur-2xl md:px-7">
          <div><div className="eg-kicker">{vi ? 'Egoric access control' : 'Egoric access control'}</div><h2 id="team-access-title" className="mt-1 text-lg font-semibold text-white">{vi ? 'Tài khoản và đội ngũ' : 'Account & team'}</h2></div>
          <button type="button" onClick={auth.closeTeamPanel} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label={vi ? 'Đóng' : 'Close'}><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-6 p-5 md:p-7">
          <section className="rounded-2xl border border-cyan-200/10 bg-cyan-200/[.035] p-5">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-200/[.08] text-cyan-100"><UserRound className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-white">{auth.user.displayName}</div><div className="mt-1 truncate text-xs text-zinc-500">{auth.user.email}</div><div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/[.08] bg-black/20 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-zinc-300"><ShieldCheck className="h-3 w-3 text-cyan-200" />{ROLE_LABELS[auth.user.role][locale]}</div></div>
              <button type="button" onClick={() => void auth.logout()} className="eg-button-secondary flex min-h-11 items-center gap-2 px-3 text-xs"><LogOut className="h-4 w-4" />{vi ? 'Đăng xuất' : 'Sign out'}</button>
            </div>
          </section>

          {canManage && (
            <section className="rounded-2xl border border-white/[.08] bg-white/[.025] p-5">
              <div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[.04] text-cyan-100"><MailPlus className="h-4 w-4" /></div><div><h3 className="text-sm font-semibold text-white">{vi ? 'Mời nhân sự' : 'Invite team member'}</h3><p className="mt-1 text-[10px] text-zinc-600">{vi ? 'Link dùng một lần · hết hạn sau 7 ngày' : 'Single-use link · expires after 7 days'}</p></div></div>
              <form onSubmit={invite} className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="mb-2 block text-[10px] font-semibold text-zinc-400">{vi ? 'Họ và tên' : 'Full name'}</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={100} autoComplete="off" className="eg-auth-input w-full" /></label>
                <label className="block"><span className="mb-2 block text-[10px] font-semibold text-zinc-400">Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="off" className="eg-auth-input w-full" /></label>
                <label className="block sm:col-span-2"><span className="mb-2 block text-[10px] font-semibold text-zinc-400">{vi ? 'Vai trò' : 'Role'}</span><select value={role} onChange={(event) => setRole(event.target.value as Exclude<EgoricRole, 'owner'>)} className="eg-auth-input w-full">{STAFF_ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item][locale]}</option>)}</select></label>
                <button type="submit" disabled={submitting} className="eg-button-primary flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold sm:col-span-2">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}{vi ? 'Tạo link mời' : 'Create invitation link'}</button>
              </form>
              {inviteUrl && <div className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[.05] p-3"><div className="mb-2 text-[10px] font-semibold text-emerald-100">{vi ? 'Link chỉ hiển thị ở lần tạo này' : 'This link is shown only once'}</div>{delivery && <div className={`mb-3 rounded-lg border px-3 py-2 text-[10px] ${delivery.status === 'sent' ? 'border-emerald-300/15 text-emerald-200' : delivery.status === 'failed' ? 'border-rose-300/15 text-rose-200' : 'border-amber-300/15 text-amber-100'}`}>{deliveryLabel(delivery.status)}</div>}<div className="flex flex-col gap-2 sm:flex-row"><input readOnly value={inviteUrl} className="eg-auth-input min-w-0 flex-1 font-mono text-[10px]" /><button type="button" onClick={() => void copyInvite()} className="eg-button-secondary flex min-h-11 shrink-0 items-center justify-center gap-2 px-3 text-xs">{copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}{copied ? (vi ? 'Đã chép' : 'Copied') : (vi ? 'Sao chép' : 'Copy')}</button>{delivery?.status !== 'sent' && <button type="button" onClick={emailInvite} className="eg-button-secondary flex min-h-11 shrink-0 items-center justify-center gap-2 px-3 text-xs"><Mail className="h-4 w-4" />{vi ? 'Mở email' : 'Open email'}</button>}</div></div>}
            </section>
          )}

          {error && <div role="alert" className="rounded-xl border border-rose-300/15 bg-rose-300/[.05] p-3 text-xs text-rose-100">{error}</div>}

          {canSeeTeam && (
            <section className="rounded-2xl border border-white/[.08] bg-white/[.02] p-5">
              <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-cyan-100" /><h3 className="text-sm font-semibold text-white">{vi ? 'Đội ngũ' : 'Team'}</h3></div>{loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />}</div>
              <div className="space-y-2">
                {(team?.users || []).map((user) => (
                  <article key={user.id} className="grid gap-3 rounded-xl border border-white/[.06] bg-black/15 p-3 sm:grid-cols-[minmax(0,1fr)_150px_110px] sm:items-center">
                    <div className="min-w-0"><div className="truncate text-xs font-semibold text-zinc-200">{user.displayName}</div><div className="mt-1 truncate text-[10px] text-zinc-600">{user.email}{user.lastLoginAt ? ` · ${new Intl.DateTimeFormat(localeTag, { day: '2-digit', month: 'short' }).format(user.lastLoginAt)}` : ''}</div></div>
                    {canManage && user.id !== auth.user?.id ? <select value={user.role} onChange={(event) => void updateUser(user.id, { role: event.target.value as EgoricRole })} className="eg-auth-input min-h-10 w-full py-2 text-[10px]">{(['owner', ...STAFF_ROLES] as EgoricRole[]).map((item) => <option key={item} value={item}>{ROLE_LABELS[item][locale]}</option>)}</select> : <span className="text-[10px] text-zinc-500">{ROLE_LABELS[user.role][locale]}</span>}
                    {canManage && user.id !== auth.user?.id ? <button type="button" onClick={() => void updateUser(user.id, { status: user.status === 'active' ? 'disabled' : 'active' })} className={`min-h-10 rounded-lg border px-3 text-[10px] font-semibold ${user.status === 'active' ? 'border-rose-300/10 text-rose-200/70 hover:bg-rose-300/[.05]' : 'border-emerald-300/10 text-emerald-200 hover:bg-emerald-300/[.05]'}`}>{user.status === 'active' ? (vi ? 'Tạm khóa' : 'Disable') : (vi ? 'Mở lại' : 'Enable')}</button> : <span className="text-[10px] text-emerald-300/70">{user.status === 'active' ? (vi ? 'Đang hoạt động' : 'Active') : (vi ? 'Đã khóa' : 'Disabled')}</span>}
                  </article>
                ))}
                {!loading && !team?.users.length && <div className="rounded-xl border border-dashed border-white/[.07] p-6 text-center text-xs text-zinc-600">{vi ? 'Chưa có nhân sự.' : 'No team members yet.'}</div>}
              </div>
              {!!team?.invites.length && <div className="mt-5 border-t border-white/[.06] pt-4"><div className="mb-3 text-[9px] font-semibold uppercase tracking-[.16em] text-zinc-600">{vi ? 'Đang chờ kích hoạt' : 'Pending invitations'}</div><div className="space-y-2">{team.invites.map((item) => <div key={`${item.email}-${item.expiresAt}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/[.02] px-3 py-2 text-[10px]"><span className="min-w-0"><span className="block truncate text-zinc-400">{item.email}</span><span className={`mt-1 block text-[9px] ${item.deliveryStatus === 'sent' ? 'text-emerald-300/70' : item.deliveryStatus === 'failed' ? 'text-rose-300/70' : 'text-zinc-600'}`}>{deliveryLabel(item.deliveryStatus)}</span></span><span className="shrink-0 text-zinc-600">{ROLE_LABELS[item.role][locale]}</span></div>)}</div></div>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};

export default TeamAccessPanel;
