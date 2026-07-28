import React from 'react';
import { Languages } from 'lucide-react';
import { AppLocale, SUPPORTED_LOCALES } from '../services/i18n';
import { useLocale } from '../contexts/LocaleContext';

interface LanguageSwitcherProps {
  compact?: boolean;
}

const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ compact = false }) => {
  const { locale, setLocale, t } = useLocale();

  if (compact) {
    const nextLocale: AppLocale = locale === 'vi' ? 'en' : 'vi';
    return (
      <button
        type="button"
        onClick={() => setLocale(nextLocale)}
        className="eg-sidebar-tool flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-500 transition-colors hover:bg-white/[.035] hover:text-white"
        aria-label={t('language.switchTo', { language: t(`language.${nextLocale}` as const) })}
        title={t('language.switchTo', { language: t(`language.${nextLocale}` as const) })}
      >
        <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="eg-sidebar-copy flex flex-1 items-center justify-between text-[11px] font-medium">
          <span>{t('language.control')}</span>
          <span className="font-mono text-[9px] font-bold text-cyan-100/80">{locale.toUpperCase()}</span>
        </span>
      </button>
    );
  }

  return (
    <div
      className="flex min-h-11 items-center rounded-xl border border-white/[.08] bg-black/20 p-1"
      role="group"
      aria-label={t('language.control')}
    >
      <Languages className="mx-2 hidden h-4 w-4 text-zinc-600 lg:block" aria-hidden="true" />
      {SUPPORTED_LOCALES.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => setLocale(item)}
          aria-pressed={locale === item}
          aria-label={t(`language.${item}` as const)}
          className={`flex h-9 min-w-11 items-center justify-center rounded-lg px-2 font-mono text-[10px] font-bold transition-colors ${
            locale === item
              ? 'bg-cyan-200/[.12] text-cyan-50'
              : 'text-zinc-600 hover:bg-white/[.035] hover:text-zinc-200'
          }`}
        >
          {item.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

export default LanguageSwitcher;
