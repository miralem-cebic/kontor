import { format as dfFormat, type Locale } from 'date-fns';
import { de, enGB } from 'date-fns/locale';
import { usePrefs } from '../store/prefs';
import { detectLang, type Lang } from './languages';
import { MESSAGES, type MessageKey } from './messages';

export { LANGS, LANG_NAMES, detectLang, isLang, type Lang } from './languages';
export type { MessageKey } from './messages';

const LOCALES: Record<Lang, Locale> = { de, en: enGB };

// The browser language does not change while the app runs: detect it once, not for every string
let systemLang: Lang | null = null;

/** Current interface language (stored per browser in prefs). */
export const currentLang = (): Lang => usePrefs.getState().language ?? (systemLang ??= detectLang());

/** Translate a message. `{name}` placeholders are replaced from `vars`. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = MESSAGES[key][currentLang()];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** date-fns format() in the current interface language. */
export const fmt = (d: Date, pattern: string): string => dfFormat(d, pattern, { locale: LOCALES[currentLang()] });
