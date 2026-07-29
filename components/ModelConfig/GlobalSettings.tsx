import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react';
import { DEFAULT_CHAT_PARAMS, DEFAULT_IMAGE_PARAMS, DEFAULT_VIDEO_PARAMS_SORA, ModelProvider, ModelType } from '../../types/model';
import {
  getProviders,
  getModels,
  registerModel,
  setProviderApiKey,
} from '../../services/modelRegistry';
import { DiscoveredProviderModel, discoverProviderModels, verifyProviderApiKey } from '../../services/providerService';
import { clearProviderModelAvailability } from '../../services/providerCapabilities';
import { useLocale } from '../../contexts/LocaleContext';
import { TranslationKey } from '../../services/i18n';

interface GlobalSettingsProps {
  onRefresh: () => void;
}

type VerificationState = {
  state: 'idle' | 'checking' | 'success' | 'error';
  message: string;
};

const CAPABILITY_LABEL_KEYS: Record<ModelType, TranslationKey> = {
  chat: 'model.chat',
  image: 'model.image',
  video: 'model.video',
};

const CAPABILITY_ICONS: Record<ModelType, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquareText,
  image: ImageIcon,
  video: Video,
};

const GlobalSettings: React.FC<GlobalSettingsProps> = ({ onRefresh }) => {
  const { t } = useLocale();
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [statuses, setStatuses] = useState<Record<string, VerificationState>>({});
  const [discoveredCounts, setDiscoveredCounts] = useState<Record<string, number>>({});
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, DiscoveredProviderModel[]>>({});
  const [selectedDiscovered, setSelectedDiscovered] = useState<Record<string, string>>({});

  const refreshProviders = () => {
    const nextProviders = getProviders();
    setProviders(nextProviders);
    setDraftKeys(
      Object.fromEntries(nextProviders.map((provider) => [provider.id, provider.apiKey || '']))
    );
    setStatuses(
      Object.fromEntries(
        nextProviders.map((provider) => [
          provider.id,
          {
            state: provider.apiKey ? 'success' : 'idle',
            message: provider.apiKey ? t('model.sessionSafe') : '',
          },
        ])
      )
    );
  };

  useEffect(() => {
    refreshProviders();
  }, [t]);

  const setStatus = (providerId: string, status: VerificationState) => {
    setStatuses((current) => ({ ...current, [providerId]: status }));
  };

  const handleKeyChange = (providerId: string, value: string) => {
    setDraftKeys((current) => ({ ...current, [providerId]: value }));
    setStatus(providerId, { state: 'idle', message: '' });
  };

  const handleVerifyAndSave = async (provider: ModelProvider) => {
    const key = (draftKeys[provider.id] || '').trim();
    if (!key) {
      setStatus(provider.id, { state: 'error', message: t('model.enterKey') });
      return;
    }

    setStatus(provider.id, { state: 'checking', message: t('model.checkingConnection') });
    const result = await verifyProviderApiKey(provider.id, key);
    if (!result.success) {
      setStatus(provider.id, { state: 'error', message: result.message });
      return;
    }

    setProviderApiKey(provider.id, key);
    try {
      const discovered = await discoverProviderModels(provider.id, key);
      setDiscoveredCounts((current) => ({ ...current, [provider.id]: discovered.length }));
      setDiscoveredModels((current) => ({ ...current, [provider.id]: discovered }));
      setSelectedDiscovered((current) => ({ ...current, [provider.id]: discovered[0]?.id || '' }));
    } catch {
      setDiscoveredCounts((current) => ({ ...current, [provider.id]: 0 }));
    }
    setProviders(getProviders());
    setStatus(provider.id, { state: 'success', message: `${result.message} · ${t('model.sessionActive')}` });
    onRefresh();
  };

  const importDiscoveredModel = (provider: ModelProvider) => {
    const item = discoveredModels[provider.id]?.find((model) => model.id === selectedDiscovered[provider.id]);
    if (!item) return;
    const params = item.type === 'chat' ? { ...DEFAULT_CHAT_PARAMS } : item.type === 'image' ? { ...DEFAULT_IMAGE_PARAMS } : { ...DEFAULT_VIDEO_PARAMS_SORA };
    const modelId = `${provider.id}:${item.id}`;
    if (getModels().some((model) => model.id === modelId)) {
      setStatus(provider.id, { state: 'success', message: t('model.alreadyInCatalog', { model: item.name }) });
      return;
    }
    registerModel({
      id: modelId,
      apiModel: item.id,
      name: item.name,
      type: item.type,
      providerId: provider.id,
      endpoint: item.type === 'chat' ? (provider.id === 'google-ai-studio' ? '/chat/completions' : '/v1/chat/completions') : undefined,
      description: t('model.discoveredDescription', { provider: provider.name }),
      isEnabled: true,
      params,
    } as any);
    setStatus(provider.id, { state: 'success', message: t('model.importedToCatalog', { model: item.name }) });
    onRefresh();
  };

  const handleClear = (provider: ModelProvider) => {
    setProviderApiKey(provider.id, '');
    clearProviderModelAvailability(provider.id);
    setDraftKeys((current) => ({ ...current, [provider.id]: '' }));
    setVisibleKeys((current) => ({ ...current, [provider.id]: false }));
    setProviders(getProviders());
    setStatus(provider.id, { state: 'idle', message: t('model.keyCleared') });
    onRefresh();
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-cyan-200/20 bg-gradient-to-r from-cyan-300/10 via-sky-400/10 to-fuchsia-400/10 p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-300 to-sky-400">
            <ShieldCheck className="h-6 w-6 text-slate-950" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">{t('model.gatewayTitle')}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
              {t('model.gatewayDescription')}
            </p>
            <p className="mt-2 max-w-2xl text-[10px] leading-4 text-amber-100/70">
              {t('model.gatewayWarning')}
            </p>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        {providers.map((provider) => {
          const status = statuses[provider.id] || { state: 'idle', message: '' };
          const isChecking = status.state === 'checking';
          const hasStoredKey = Boolean(provider.apiKey);

          return (
            <section
              key={provider.id}
              className="rounded-2xl border border-white/10 bg-white/[0.045] p-5"
              aria-labelledby={`provider-${provider.id}`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 id={`provider-${provider.id}`} className="text-sm font-bold text-white">
                      {provider.name}
                    </h4>
                    {hasStoredKey && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        {t('model.configured')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                    {provider.id === 'shopaikey' ? t('model.providerDescription') : provider.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {provider.supportedModelTypes.map((capability) => {
                      const Icon = CAPABILITY_ICONS[capability];
                      return (
                        <span
                          key={capability}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[10px] text-zinc-400"
                        >
                          <Icon className="h-3 w-3" aria-hidden="true" />
                          {t(CAPABILITY_LABEL_KEYS[capability])}
                        </span>
                      );
                    })}
                    {typeof discoveredCounts[provider.id] === 'number' && (
                      <span className="inline-flex items-center rounded-lg border border-cyan-200/15 bg-cyan-200/[.05] px-2.5 py-1.5 font-mono text-[10px] text-cyan-100/70">
                        {t('model.discoveredCount', { count: discoveredCounts[provider.id] })}
                      </span>
                    )}
                  </div>
                </div>

                {provider.keyUrl && (
                  <a
                    href={provider.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 text-xs font-semibold text-zinc-300 transition-colors hover:border-cyan-300/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
                  >
                    {t('model.getApiKey')}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>

              <div className="mt-4">
                <label
                  htmlFor={`key-${provider.id}`}
                  className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500"
                >
                  <KeyRound className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                  {t('model.apiKeyLabel', { provider: provider.name })}
                </label>
                <div className="relative">
                  <input
                    id={`key-${provider.id}`}
                    type={visibleKeys[provider.id] ? 'text' : 'password'}
                    value={draftKeys[provider.id] || ''}
                    onChange={(event) => handleKeyChange(provider.id, event.target.value)}
                    disabled={isChecking}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('model.apiKeyPlaceholder', { provider: provider.name })}
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 pr-12 font-mono text-sm text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-300/10 disabled:cursor-wait disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleKeys((current) => ({
                        ...current,
                        [provider.id]: !current[provider.id],
                      }))
                    }
                    className="absolute right-1 top-1 flex h-9 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
                    aria-label={visibleKeys[provider.id] ? t('model.hideKey') : t('model.showKey')}
                  >
                    {visibleKeys[provider.id] ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                {status.message && (
                  <div
                    role="status"
                    className={`mt-2 flex items-start gap-2 text-xs ${
                      status.state === 'error'
                        ? 'text-rose-300'
                        : status.state === 'success'
                          ? 'text-emerald-300'
                          : 'text-zinc-500'
                    }`}
                  >
                    {status.state === 'checking' ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    ) : status.state === 'error' ? (
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : status.state === 'success' ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : null}
                    <span>{status.message}</span>
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  {hasStoredKey && (
                    <button
                      type="button"
                      onClick={() => handleClear(provider)}
                      disabled={isChecking}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-xs font-semibold text-zinc-400 transition-colors hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-300/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('model.removeKey')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleVerifyAndSave(provider)}
                    disabled={isChecking || !(draftKeys[provider.id] || '').trim()}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-xs font-bold text-slate-950 transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-100/50"
                  >
                    {isChecking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {isChecking ? t('model.checking') : t('model.verifyAndUse')}
                  </button>
                </div>

                {(discoveredModels[provider.id]?.length || 0) > 0 && (
                  <div className="mt-4 rounded-xl border border-cyan-200/15 bg-cyan-200/[.035] p-3">
                    <label htmlFor={`discovered-${provider.id}`} className="text-[10px] font-semibold uppercase tracking-wider text-cyan-100/70">{t('model.discoveredDirectly')}</label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <select id={`discovered-${provider.id}`} value={selectedDiscovered[provider.id] || ''} onChange={(event) => setSelectedDiscovered((current) => ({ ...current, [provider.id]: event.target.value }))} className="eg-input min-w-0 flex-1 px-3 text-xs">
                        {discoveredModels[provider.id].slice(0, 500).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                      </select>
                      <button type="button" onClick={() => importDiscoveredModel(provider)} className="eg-button-secondary inline-flex items-center justify-center px-4 text-xs font-semibold">{t('model.addToCatalog')}</button>
                    </div>
                    {discoveredModels[provider.id].length > 500 && <p className="mt-2 text-[10px] text-zinc-600">{t('model.first500')}</p>}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default GlobalSettings;
