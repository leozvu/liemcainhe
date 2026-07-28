import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mic2,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  VoiceProviderCredentials,
  clearVoiceCredentials,
  getVoiceCredentials,
  getVoiceProvider,
  setVoiceCredentials,
} from '../../services/voiceRegistry';
import { verifyProviderApiKey } from '../../services/providerService';
import { SHOPAIKEY_PROVIDER_ID } from '../../types/model';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

type SaveState = 'idle' | 'checking' | 'saved' | 'warning' | 'error';

const VoiceSettingsModal: React.FC<Props> = ({ isOpen, onClose, onSaved }) => {
  const provider = getVoiceProvider('shopaikey');
  const [draft, setDraft] = useState<VoiceProviderCredentials>({});
  const [visible, setVisible] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDraft(getVoiceCredentials('shopaikey'));
    setVisible(false);
    setSaveState('idle');
    setFeedback('');
  }, [isOpen]);

  if (!isOpen) return null;

  const save = async () => {
    const apiKey = draft.apiKey?.trim();
    if (!apiKey) return;
    setSaveState('checking');
    setFeedback('Đang xác thực cổng ShopAIKey…');
    try {
      const result = await verifyProviderApiKey(SHOPAIKEY_PROVIDER_ID, apiKey);
      if (!result.success) throw new Error(result.message);
      setVoiceCredentials('shopaikey', { apiKey });
      setSaveState('saved');
      setFeedback(`${result.message} · giọng nói dùng cùng khóa này.`);
      onSaved?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể kiểm tra khóa ShopAIKey.';
      if (message.includes('không hợp lệ') || message.includes('hết hiệu lực')) {
        clearVoiceCredentials('shopaikey');
        setSaveState('error');
      } else {
        setSaveState('warning');
        onSaved?.();
      }
      setFeedback(message);
    }
  };

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/70 p-4 backdrop-blur-lg" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">
      <div className="eg-panel flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden">
        <header className="flex items-start justify-between border-b eg-divider px-5 py-5 md:px-7">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-200/10 text-cyan-100">
              <Mic2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="voice-settings-title" className="text-lg font-semibold text-white">Kết nối ShopAIKey</h2>
                {getVoiceCredentials('shopaikey').apiKey && saveState !== 'error' && (
                  <span className="eg-chip border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Đã có khóa
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-xl text-xs leading-5 text-zinc-500">Gemini TTS dùng chung một khóa với cổng AI nội bộ Egoric.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng cấu hình ShopAIKey">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
          <div className="rounded-2xl border border-cyan-200/15 bg-cyan-200/[.055] p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
              <p className="text-xs leading-5 text-zinc-400">
                Khóa chỉ được giữ trong phiên trình duyệt hiện tại, không ghi vào dự án, localStorage hay cloud. Khi đóng phiên, bạn cần nhập lại khóa.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="voice-key-shopaikey" className="text-xs font-semibold text-zinc-300">Khóa API ShopAIKey</label>
              <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 px-2 text-xs font-medium text-cyan-200 hover:text-cyan-100">
                Mở trang lấy khóa <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-zinc-600" aria-hidden="true" />
              <input
                id="voice-key-shopaikey"
                type={visible ? 'text' : 'password'}
                value={draft.apiKey || ''}
                onChange={(event) => { setDraft({ apiKey: event.target.value }); setSaveState('idle'); setFeedback(''); }}
                className="eg-input px-10 pr-12 font-mono text-sm"
                placeholder="Dán khóa ShopAIKey"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="shopaikey-key-help shopaikey-key-feedback"
              />
              <button type="button" onClick={() => setVisible((value) => !value)} className="absolute right-1 top-1 flex h-9 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/[.06] hover:text-white" aria-label={visible ? 'Ẩn khóa' : 'Hiện khóa'}>
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p id="shopaikey-key-help" className="mt-2 text-[11px] leading-5 text-zinc-600">
              Khóa này đồng thời mở model hội thoại, ảnh, video và Gemini TTS. Chỉ nạp số dư nhỏ đủ cho một ca sản xuất.
            </p>

            {feedback && (
              <div id="shopaikey-key-feedback" role={saveState === 'error' ? 'alert' : 'status'} className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs leading-5 ${
                saveState === 'saved'
                  ? 'border-emerald-300/15 bg-emerald-300/[.05] text-emerald-200'
                  : saveState === 'error'
                    ? 'border-rose-300/15 bg-rose-300/[.05] text-rose-200'
                    : saveState === 'warning'
                      ? 'border-amber-200/15 bg-amber-200/[.05] text-amber-100'
                      : 'border-cyan-200/15 bg-cyan-200/[.04] text-cyan-100'
              }`}>
                {saveState === 'checking' ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : saveState === 'saved' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{feedback}</span>
              </div>
            )}
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t eg-divider bg-black/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
          <p className="text-[11px] text-zinc-600">Kore, Aoede, Leda, Orus và Puck có sẵn trong hồ sơ casting.</p>
          <button type="button" onClick={() => void save()} disabled={!draft.apiKey?.trim() || saveState === 'checking'} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold">
            {saveState === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : saveState === 'saved' ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saveState === 'checking' ? 'Đang kiểm tra…' : saveState === 'saved' ? 'Đã kết nối' : 'Kiểm tra và sử dụng'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default VoiceSettingsModal;
