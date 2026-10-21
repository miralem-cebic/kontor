import { useId } from 'react';
import { currentLang, isLang, LANG_NAMES, LANGS, t } from '../i18n';
import { setLanguage, usePrefs } from '../store/prefs';

export function LanguageSelect() {
  const id = useId();
  usePrefs((s) => s.language);
  return (
    <div className="lang">
      <label htmlFor={id}>{t('common.language')}</label>
      <select id={id} value={currentLang()} onChange={(e) => isLang(e.target.value) && setLanguage(e.target.value)}>
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
