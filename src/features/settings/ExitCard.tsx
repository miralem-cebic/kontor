import { useState } from 'react';
import { exportCompanyArchive, type ExitFailure } from '../../app/exit';
import { ARCHIVE_LIMITS } from '../../data/export/exit';
import { currentLang, t } from '../../i18n';
import { errorText } from '../../lib/labels';
import { showToast } from '../../store/appStore';

// Settings, app: the company folder as a ZIP file to take away (F12). Nothing in the folder changes.

function failureText(f: ExitFailure): string {
  switch (f) {
    case 'notReady':
      return t('exit.notReady');
    case 'unsaved':
      return t('exit.unsaved');
    case 'tooLarge':
      return t('exit.tooLarge', { files: ARCHIVE_LIMITS.files.toLocaleString(currentLang()), gb: String(ARCHIVE_LIMITS.bytes / 1024 ** 3) });
    case 'permission':
    case 'notFound':
    case 'quota':
    case 'locked':
    case 'newerSchema':
    case 'invalid':
    case 'conflict':
    case 'other':
      return t('exit.failed', { reason: errorText(f) });
  }
}

export function ExitCard() {
  // set when changes are not in the folder: the person may export the folder as it is, without them
  const [unsaved, setUnsaved] = useState(false);
  const run = async (leaveOutUnsaved: boolean) => {
    const result = await exportCompanyArchive(leaveOutUnsaved);
    setUnsaved(!result.ok && result.failure === 'unsaved');
    if (!result.ok && result.failure !== 'unsaved') showToast(failureText(result.failure));
    if (result.ok && result.skipped > 0) showToast(t('exit.skipped', { n: result.skipped }));
  };
  return (
    <div className="exit-card">
      <p className="hint">{t('exit.hint')}</p>
      <button type="button" className="btn" onClick={() => void run(false)}>
        {t('exit.button')}
      </button>
      {unsaved && (
        <div className="confirm" role="group" aria-label={t('exit.unsaved')}>
          <span>{t('exit.unsaved')}</span>
          <button type="button" className="btn" onClick={() => void run(true)}>
            {t('exit.exportAnyway')}
          </button>
        </div>
      )}
    </div>
  );
}
