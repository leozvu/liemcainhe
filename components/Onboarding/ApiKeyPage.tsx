import React from 'react';
import { ExternalLink, KeyRound, Layers3 } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';

interface ApiKeyPageProps {
  onNext: () => void;
  onSkip: () => void;
}

const ApiKeyPage: React.FC<ApiKeyPageProps> = ({ onNext, onSkip }) => {
  const { t } = useLocale();
  const providers = [
    {
      name: t('onboarding.providerName'),
      description: t('onboarding.providerDescription'),
      href: 'https://shopaikey.com/en',
      icon: Layers3,
    },
  ];

  return <div className="flex flex-col items-center text-center">
    <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200/25 bg-cyan-300/10">
      <KeyRound className="h-8 w-8 text-cyan-300" aria-hidden="true" />
    </div>

    <h2 className="text-2xl font-bold text-white">{t('onboarding.apiTitle')}</h2>
    <p className="mb-5 mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
      {t('onboarding.apiDescription')}
    </p>

    <div className="grid w-full gap-2 text-left">
      {providers.map(({ name, description, href, icon: Icon }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="group flex min-h-14 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/[0.06] focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
        >
          <Icon className="h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-white">{name}</span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">{description}</span>
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-zinc-600 group-hover:text-cyan-300" aria-hidden="true" />
        </a>
      ))}
    </div>

    <button
      type="button"
      onClick={onNext}
      className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-cyan-300 px-8 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition-colors hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-100/50"
    >
      {t('onboarding.continue')}
    </button>
    <button
      type="button"
      onClick={onSkip}
      className="mt-3 min-h-11 px-4 text-xs text-zinc-600 transition-colors hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
    >
      {t('onboarding.skip')}
    </button>
  </div>;
};

export default ApiKeyPage;
