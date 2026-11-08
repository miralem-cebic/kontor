import { exportCompanyArchive, type ExitFailure } from '../../app/exit';
import { t } from '../../i18n';
import { errorText } from '../../lib/labels';
import { showToast } from '../../store/appStore';

// Settings, app: the company folder as a ZIP file to take away (F12). Nothing in the folder changes.

function failureText(f: ExitFailure): string {
  switch (f) {
    case 'notReady':
      return t('exit.notReady');
    case 'unsaved':
      return t('exit.unsaved');
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
  const run = async () => {
    const failure = await exportCompanyArchive();
    if (failure !== null) showToast(failureText(failure));
  };
  return (
    <div className="exit-card">
      <p className="hint">{t('exit.hint')}</p>
      <button type="button" className="btn" onClick={() => void run()}>
        {t('exit.button')}
      </button>
    </div>
  );
}
