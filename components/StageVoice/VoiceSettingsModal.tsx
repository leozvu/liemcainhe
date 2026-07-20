import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Mic2,
  Radio,
  Save,
  ServerCog,
  ShieldCheck,
  X,
} from 'lucide-react';
import { VoiceProviderId } from '../../types';
import {
  VOICE_PROVIDERS,
  VoiceProviderCredentials,
  getVoiceCredentials,
  setVoiceCredentials,
} from '../../services/voiceRegistry';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialProviderId?: VoiceProviderId;
}

const CONFIGURABLE_PROVIDERS = VOICE_PROVIDERS.filter((provider) => provider.id !== 'human');

const VoiceSettingsModal: React.FC<Props> = ({ isOpen, onClose, initialProviderId = 'fpt' }) => {
  const [providerId, setProviderId] = useState<VoiceProviderId>(initialProviderId);
  const [drafts, setDrafts] = useState<Partial<Record<VoiceProviderId, VoiceProviderCredentials>>>({});
  const [visible, setVisible] = useState(false);
  const [savedProvider, setSavedProvider] = useState<VoiceProviderId | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setProviderId(initialProviderId);
    setDrafts(
      Object.fromEntries(
        CONFIGURABLE_PROVIDERS.map((provider) => [provider.id, getVoiceCredentials(provider.id)]),
      ),
    );
    setSavedProvider(null);
    setVisible(false);
  }, [isOpen, initialProviderId]);

  if (!isOpen) return null;

  const provider = VOICE_PROVIDERS.find((item) => item.id === providerId) || CONFIGURABLE_PROVIDERS[0];
  const draft = drafts[provider.id] || {};
  const setDraft = (updates: Partial<VoiceProviderCredentials>) => {
    setDrafts((current) => ({
      ...current,
      [provider.id]: { ...(current[provider.id] || {}), ...updates },
    }));
    setSavedProvider(null);
  };

  const save = () => {
    setVoiceCredentials(provider.id, draft);
    setSavedProvider(provider.id);
  };

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/70 p-4 backdrop-blur-lg" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">
      <div className="eg-panel flex max-h-[90vh] w-full max-w-5xl overflow-hidden">
        <aside className="hidden w-64 shrink-0 border-r eg-divider bg-black/15 p-4 md:block">
          <div className="px-3 pb-5 pt-2">
            <div className="eg-kicker">Kết nối âm thanh</div>
            <h2 id="voice-settings-title" className="mt-2 text-xl font-semibold text-white">Nhà cung cấp giọng</h2>
          </div>
          <nav className="space-y-2" aria-label="Nhà cung cấp giọng nói">
            {CONFIGURABLE_PROVIDERS.map((item) => {
              const configured = Boolean(getVoiceCredentials(item.id).apiKey);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setProviderId(item.id); setVisible(false); setSavedProvider(null); }}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors ${
                    provider.id === item.id
                      ? 'border-cyan-200/30 bg-cyan-200/10 text-white'
                      : 'border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/[.04] hover:text-white'
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/20">
                    {item.id === 'vbee' ? <ServerCog className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{item.shortName}</span>
                    <span className="mt-0.5 block text-[10px] text-zinc-600">{configured ? 'Đã có khóa' : 'Chưa cấu hình'}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between border-b eg-divider px-5 py-5 md:px-7">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-200/10 text-cyan-100">
                <Mic2 className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">{provider.name}</h3>
                  {getVoiceCredentials(provider.id).apiKey && (
                    <span className="eg-chip border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
                      <CheckCircle2 className="h-3 w-3" /> Đã cấu hình
                    </span>
                  )}
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">{provider.description}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng cấu hình giọng nói">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="border-b eg-divider p-3 md:hidden">
            <select value={provider.id} onChange={(event) => setProviderId(event.target.value as VoiceProviderId)} className="eg-input px-3 text-sm" aria-label="Chọn nhà cung cấp giọng">
              {CONFIGURABLE_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>

          <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
            <div className="rounded-2xl border border-cyan-200/15 bg-cyan-200/[.055] p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />
                <p className="text-xs leading-5 text-zinc-400">
                  Khóa được lưu cục bộ trên thiết bị này và chỉ gửi qua proxy cùng miền đến đúng nhà cung cấp. Với bản triển khai nhiều người dùng, nên thay bằng kho bí mật phía máy chủ.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor={`voice-key-${provider.id}`} className="text-xs font-semibold text-zinc-300">{provider.id === 'viettel' ? 'Token truy cập' : 'Khóa API'}</label>
                  {provider.keyUrl && (
                    <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 px-2 text-xs font-medium text-cyan-200 hover:text-cyan-100">
                      Mở trang lấy khóa <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-zinc-600" />
                  <input
                    id={`voice-key-${provider.id}`}
                    type={visible ? 'text' : 'password'}
                    value={draft.apiKey || ''}
                    onChange={(event) => setDraft({ apiKey: event.target.value })}
                    className="eg-input px-10 pr-12 font-mono text-sm"
                    placeholder={provider.id === 'viettel' ? 'Dán token Viettel AI' : `Dán khóa ${provider.shortName}`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="button" onClick={() => setVisible((value) => !value)} className="absolute right-1 top-1 flex h-9 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/[.06] hover:text-white" aria-label={visible ? 'Ẩn khóa' : 'Hiện khóa'}>
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {provider.requiresAppId && (
                <div>
                  <label htmlFor={`voice-app-${provider.id}`} className="mb-2 block text-xs font-semibold text-zinc-300">App ID</label>
                  <input id={`voice-app-${provider.id}`} value={draft.appId || ''} onChange={(event) => setDraft({ appId: event.target.value })} className="eg-input px-4 font-mono text-sm" placeholder="App ID do Vbee cấp" />
                </div>
              )}

              {provider.requiresCallback && (
                <div>
                  <label htmlFor={`voice-callback-${provider.id}`} className="mb-2 block text-xs font-semibold text-zinc-300">Callback URL công khai</label>
                  <input id={`voice-callback-${provider.id}`} type="url" value={draft.callbackUrl || ''} onChange={(event) => setDraft({ callbackUrl: event.target.value })} className="eg-input px-4 text-sm" placeholder="https://api.tenmien.vn/hooks/vbee" />
                  <p className="mt-2 text-[11px] leading-5 text-amber-200/70">Vbee xử lý bất đồng bộ. Bản web tĩnh chưa thể nhận callback; hiện có thể dùng Vbee bên ngoài rồi nhập bản âm thanh vào Voice Studio.</p>
                </div>
              )}

              {provider.requiresVoiceId && provider.id === 'elevenlabs' && (
                <div className="eg-card p-4 text-xs leading-5 text-zinc-400">
                  Voice ID được đặt riêng cho từng nhân vật ở bảng Casting. Hãy chọn một voice gốc có ngữ âm Việt để tránh giọng ngoại lai.
                </div>
              )}
            </div>
          </div>

          <footer className="flex flex-col-reverse gap-3 border-t eg-divider bg-black/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
            <p className="text-[11px] text-zinc-600">Không chia sẻ khóa API trong ảnh chụp màn hình hoặc tệp dự án.</p>
            <button type="button" onClick={save} disabled={!draft.apiKey?.trim()} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold">
              {savedProvider === provider.id ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {savedProvider === provider.id ? 'Đã lưu trên thiết bị' : 'Lưu kết nối'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default VoiceSettingsModal;

