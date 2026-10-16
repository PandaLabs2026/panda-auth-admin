import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * 应用内 i18n 最小框架（v0.5.0）：不引重型库——字典类型化 + Provider + useI18n + 持久化。
 * 设计要点：
 * - 字典是「应用层资产」：每个应用自带 dict，缺 key 回退默认语言并 console.warn（开发态）；
 * - locale 持久化 localStorage（i18n-locale），未来接账号偏好时替换读取源即可；
 * - 身份/服务端文案不进该框架（那是 IDP 与后端的契约），只管应用自身 UI 文案。
 */
export type Locale = string;

export type Dictionary = Record<string, string>;

export interface I18nConfig {
  /** 默认语言（缺 key 与未设置时的回退）。 */
  defaultLocale: Locale;
  /** 可选语言列表（含默认）；用于语言切换组件枚举。 */
  locales: Locale[];
  /** 字典表：locale → 字典。 */
  dictionaries: Record<Locale, Dictionary>;
  /** localStorage 持久化键；置空则不持久化。 */
  storageKey?: string;
}

export interface I18nApi {
  locale: Locale;
  locales: Locale[];
  setLocale(locale: Locale): void;
  t(key: string, params?: Record<string, string | number>): string;
}

const I18nContext = createContext<I18nApi | null>(null);

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

export function I18nProvider({ config, children }: { config: I18nConfig; children: ReactNode }) {
  const { defaultLocale, dictionaries, storageKey = 'i18n-locale' } = config;
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined' || !storageKey) return defaultLocale;
    const stored = window.localStorage.getItem(storageKey);
    return stored && stored in dictionaries ? stored : defaultLocale;
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && storageKey) window.localStorage.setItem(storageKey, locale);
    document.documentElement.lang = locale;
  }, [locale, storageKey]);

  const setLocale = useCallback((next: Locale) => {
    if (next in dictionaries) setLocaleState(next);
  }, [dictionaries]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = dictionaries[locale] ?? dictionaries[defaultLocale];
      const fallback = dictionaries[defaultLocale];
      const template = dict[key] ?? fallback[key];
      if (template === undefined) {
        if (import.meta.env.DEV) console.warn(`[i18n] missing key "${key}" for locale "${locale}"`);
        return key;
      }
      return interpolate(template, params);
    },
    [locale, dictionaries, defaultLocale],
  );

  const api = useMemo<I18nApi>(
    () => ({ locale, locales: config.locales, setLocale, t }),
    [locale, config.locales, setLocale, t],
  );
  return <I18nContext.Provider value={api}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nApi {
  const api = useContext(I18nContext);
  if (!api) throw new Error('useI18n 必须在 I18nProvider 内使用');
  return api;
}
