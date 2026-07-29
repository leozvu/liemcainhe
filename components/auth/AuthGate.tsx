import React, { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLocale } from '../../contexts/LocaleContext';
import { EgoricInvite, ROLE_LABELS, getInvite } from '../../services/authService';
import LanguageSwitcher from '../LanguageSwitcher';
import TeamAccessPanel from './TeamAccessPanel';

const copy = {
  vi: {
    secure: 'Không gian sản xuất riêng', loginTitle: 'Đăng nhập Egoric', loginBody: 'Dùng tài khoản nhân sự do Owner cấp. Bạn không cần tài khoản ChatGPT Business.',
    setupTitle: 'Khởi tạo workspace Egoric', setupBody: 'Tạo Owner đầu tiên. Mã khởi tạo chỉ dùng một lần và sẽ vô hiệu sau bước này.',
    inviteTitle: 'Kích hoạt tài khoản', inviteBody: 'Đặt mật khẩu riêng để tham gia không gian sản xuất của Egoric Agency.',
    name: 'Họ và tên', email: 'Email công việc', password: 'Mật khẩu', confirm: 'Nhập lại mật khẩu', bootstrap: 'Mã khởi tạo',
    login: 'Đăng nhập', setup: 'Tạo workspace', accept: 'Kích hoạt và vào app', signingIn: 'Đang xác thực…',
    passwordHint: 'Tối thiểu 10 ký tự, có chữ cái và chữ số.', mismatch: 'Hai mật khẩu chưa khớp.', invalidInvite: 'Không thể mở lời mời này.',
    privacy: 'Phiên đăng nhập được giữ bằng cookie HttpOnly; mật khẩu không bao giờ được lưu dạng văn bản.', retry: 'Thử lại',
  },
  en: {
    secure: 'Private production workspace', loginTitle: 'Sign in to Egoric', loginBody: 'Use the staff account issued by your Owner. No ChatGPT Business account is required.',
    setupTitle: 'Set up the Egoric workspace', setupBody: 'Create the first Owner. The bootstrap code is single-use and becomes invalid after setup.',
    inviteTitle: 'Activate your account', inviteBody: 'Create a private password to join the Egoric Agency production workspace.',
    name: 'Full name', email: 'Work email', password: 'Password', confirm: 'Confirm password', bootstrap: 'Bootstrap code',
    login: 'Sign in', setup: 'Create workspace', accept: 'Activate and enter', signingIn: 'Verifying…',
    passwordHint: 'At least 10 characters with a letter and a number.', mismatch: 'The passwords do not match.', invalidInvite: 'This invitation cannot be opened.',
    privacy: 'Your session uses an HttpOnly cookie; passwords are never stored as plain text.', retry: 'Try again',
  },
} as const;

const PasswordField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}> = ({ label, value, onChange, autoComplete }) => {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold text-zinc-300">{label}</span>
      <span className="relative block">
        <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
          minLength={10}
          maxLength={128}
          className="eg-auth-input w-full pl-11 pr-12"
        />
        <button type="button" onClick={() => setVisible((current) => !current)} className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/[.05] hover:text-white" aria-label={visible ? 'Hide password' : 'Show password'}>
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
};

const AuthGate: React.FC<React.PropsWithChildren> = ({ children }) => {
  const auth = useAuth();
  const { locale } = useLocale();
  const text = copy[locale];
  const inviteToken = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('invite') : null;
  const [invite, setInvite] = useState<EgoricInvite | null>(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteToken || auth.user) {
      setInviteLoading(false);
      return;
    }
    setInviteLoading(true);
    getInvite(inviteToken)
      .then(({ invite: next }) => {
        setInvite(next);
        setEmail(next.email);
        setDisplayName(next.displayName || '');
        setFormError(null);
      })
      .catch((cause) => setFormError(cause instanceof Error ? cause.message : text.invalidInvite))
      .finally(() => setInviteLoading(false));
  }, [inviteToken, auth.user, text.invalidInvite]);

  useEffect(() => {
    if (auth.setupRequired && auth.ownerEmailHint && !email) setEmail(auth.ownerEmailHint);
  }, [auth.setupRequired, auth.ownerEmailHint, email]);

  if (auth.loading || inviteLoading) {
    return <div className="eg-auth-page"><div className="flex items-center gap-3 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" />{text.signingIn}</div></div>;
  }

  if (auth.user) return <>{children}<TeamAccessPanel /></>;

  const setup = auth.setupRequired;
  const acceptingInvite = Boolean(inviteToken && invite);
  const title = setup ? text.setupTitle : acceptingInvite ? text.inviteTitle : text.loginTitle;
  const description = setup ? text.setupBody : acceptingInvite ? text.inviteBody : text.loginBody;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if ((setup || acceptingInvite) && password !== confirmPassword) {
      setFormError(text.mismatch);
      return;
    }
    setSubmitting(true);
    try {
      if (setup) await auth.bootstrap({ email, displayName, password, bootstrapToken });
      else if (acceptingInvite && inviteToken) await auth.acceptInvite(inviteToken, displayName, password);
      else await auth.login(email, password);
      if (acceptingInvite) window.history.replaceState({}, '', window.location.pathname);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="eg-auth-page">
      <div className="absolute right-4 top-4 z-10"><LanguageSwitcher /></div>
      <main className="eg-auth-shell" aria-labelledby="egoric-auth-title">
        <section className="eg-auth-brand-panel">
          <div>
            <img src="/egoric-agency-logo.png" alt="Egoric Agency" className="h-auto w-44 object-contain" />
            <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-cyan-200/15 bg-cyan-200/[.06] px-3 py-2 text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-100/80">
              <ShieldCheck className="h-3.5 w-3.5" />{text.secure}
            </div>
          </div>
          <div className="hidden border-t border-white/[.08] pt-6 text-xs leading-6 text-zinc-500 lg:block">
            Egoric Film Studio<br /><span className="font-mono text-[10px] uppercase tracking-[.15em] text-zinc-700">Agency production operating system</span>
          </div>
        </section>

        <section className="eg-auth-form-panel">
          <div className="mb-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[.04] text-cyan-100">
              {acceptingInvite ? <UserRound className="h-5 w-5" /> : setup ? <KeyRound className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
            </div>
            <h1 id="egoric-auth-title" className="text-2xl font-semibold tracking-tight text-white md:text-[30px]">{title}</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">{description}</p>
            {acceptingInvite && invite && <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/[.08] bg-black/20 px-3 py-2 text-[11px] text-zinc-400"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />{invite.email} · {ROLE_LABELS[invite.role][locale]}</div>}
          </div>

          <form onSubmit={submit} className="space-y-5" noValidate={false}>
            {(setup || acceptingInvite) && (
              <label className="block">
                <span className="mb-2 block text-[11px] font-semibold text-zinc-300">{text.name}</span>
                <span className="relative block"><UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" /><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required maxLength={100} className="eg-auth-input w-full pl-11" /></span>
              </label>
            )}
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold text-zinc-300">{text.email}</span>
              <span className="relative block"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} readOnly={acceptingInvite} autoComplete="email" required className="eg-auth-input w-full pl-11" /></span>
            </label>
            <PasswordField label={text.password} value={password} onChange={setPassword} autoComplete={setup || acceptingInvite ? 'new-password' : 'current-password'} />
            {(setup || acceptingInvite) && <><p className="-mt-2 text-[10px] leading-5 text-zinc-600">{text.passwordHint}</p><PasswordField label={text.confirm} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" /></>}
            {setup && (
              <label className="block">
                <span className="mb-2 block text-[11px] font-semibold text-zinc-300">{text.bootstrap}</span>
                <input type="password" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} autoComplete="one-time-code" required className="eg-auth-input w-full font-mono" />
              </label>
            )}
            {(formError || auth.error) && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[.06] p-3 text-xs leading-5 text-rose-100"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{formError || auth.error}</span></div>}
            <button type="submit" disabled={submitting} className="eg-button-primary flex min-h-12 w-full items-center justify-center gap-2 px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{submitting ? text.signingIn : setup ? text.setup : acceptingInvite ? text.accept : text.login}
            </button>
          </form>
          <p className="mt-6 text-[10px] leading-5 text-zinc-700">{text.privacy}</p>
        </section>
      </main>
    </div>
  );
};

export default AuthGate;
