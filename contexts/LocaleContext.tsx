import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AppLocale,
  intlLocale,
  normalizeLocale,
  translate,
  TranslationKey,
  TranslationVariables,
} from '../services/i18n';

const STORAGE_KEY = 'egoric_ui_locale_v1';

interface LocaleContextValue {
  locale: AppLocale;
  localeTag: string;
  setLocale: (locale: AppLocale) => void;
  t: (key: TranslationKey, variables?: TranslationVariables) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const readInitialLocale = (): AppLocale => {
  if (typeof window === 'undefined') return 'vi';
  return normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
};

export const LocaleProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [locale, setLocale] = useState<AppLocale>(readInitialLocale);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, variables?: TranslationVariables) => translate(locale, key, variables),
    [locale],
  );

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    localeTag: intlLocale(locale),
    setLocale,
    t,
  }), [locale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = (): LocaleContextValue => {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
};

export { STORAGE_KEY as UI_LOCALE_STORAGE_KEY };
