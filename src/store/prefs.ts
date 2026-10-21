import { create } from 'zustand';
import { brandId, type CompanyId } from '../data/ids';
import { isRecord, isValidId } from '../data/validate';
import { isLang, type Lang } from '../i18n/languages';

// Settings of this browser, not of a company folder: interface language and the company opened last.

const KEY = 'kontor.prefs.v1';

export interface Prefs {
  /** Interface language; when unset, the browser language is used */
  language?: Lang;
  /** The company opened last; it is opened again on the next start */
  lastCompany?: CompanyId;
}

/** Stored settings are checked like any other stored data; an unknown value is dropped */
export function parsePrefs(raw: string | null): Prefs {
  try {
    const v: unknown = JSON.parse(raw ?? '{}');
    if (!isRecord(v)) return {};
    return {
      ...(isLang(v['language']) ? { language: v['language'] } : {}),
      ...(isValidId(v['lastCompany']) ? { lastCompany: brandId<'CompanyId'>(v['lastCompany']) } : {}),
    };
  } catch {
    return {};
  }
}

function read(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return {}; // localStorage not available
  }
}

export const usePrefs = create<Prefs>()(() => read());
usePrefs.subscribe((p) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
});

export const setLanguage = (language: Lang) => usePrefs.setState({ language });
export const setLastCompany = (lastCompany: CompanyId) => usePrefs.setState({ lastCompany });
