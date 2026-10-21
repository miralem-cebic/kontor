// Supported interface languages. Kept free of imports so prefs.ts can use the type.

export const LANGS = ['de', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAMES: Record<Lang, string> = {
  de: 'Deutsch',
  en: 'English',
};

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** Browser language → interface language. German is the primary language and the fallback. */
export function detectLang(): Lang {
  const code = (typeof navigator !== 'undefined' ? navigator.language : 'de').slice(0, 2).toLowerCase();
  return code === 'en' ? 'en' : 'de';
}
