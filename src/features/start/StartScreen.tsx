import { openCompany, reconnect, startSetup, useSession } from '../../app/session';
import { Icon } from '../../components/Icon';
import { LanguageSelect } from '../../components/LanguageSelect';
import { t } from '../../i18n';
import { errorText } from '../../lib/labels';

/** Screens before a company is open: loading, unsupported browser, permission needed, opening failed. */
export function StartScreen() {
  const s = useSession();
  const current = s.companies.find((c) => c.id === s.currentId);
  const others = s.companies.filter((c) => c.id !== s.currentId);
  return (
    <main className="onb">
      <div className="onb-card">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <Icon n="building" s={14} />
          </span>
          kontor
        </div>
        {(s.phase === 'checking' || s.phase === 'loading') && (
          <p className="onb-text" role="status">
            {t('common.loading')}
          </p>
        )}
        {s.phase === 'unsupported' && (
          <>
            <h1>{t('start.unsupportedTitle')}</h1>
            <p className="onb-text">{t('start.unsupportedText')}</p>
          </>
        )}
        {s.phase === 'reconnect' && (
          <>
            <h1>{t('start.reconnectTitle')}</h1>
            <p className="onb-text">{t('start.reconnectText')}</p>
            <button type="button" className="btn primary lg" onClick={() => void reconnect()} autoFocus>
              {t('start.continueWith', { name: current?.name ?? '' })}
            </button>
          </>
        )}
        {s.phase === 'failed' && (
          <>
            <h1>{t('start.failedTitle')}</h1>
            <p className="onb-text err" role="alert">
              {errorText(s.error ?? 'other')}
            </p>
            <button type="button" className="btn primary lg" onClick={() => void reconnect()} autoFocus>
              {t('start.retry')}
            </button>
          </>
        )}
        {(s.phase === 'reconnect' || s.phase === 'failed') && (
          <div className="onb-actions">
            {others.map((c) => (
              <button key={c.id} type="button" className="btn lg" onClick={() => void openCompany(c.id)}>
                {t('start.open', { name: c.name })}
              </button>
            ))}
            <button type="button" className="btn lg" onClick={startSetup}>
              <Icon n="plus" s={14} />
              {t('switcher.add')}
            </button>
          </div>
        )}
        <div className="wz-foot">
          <LanguageSelect />
        </div>
      </div>
    </main>
  );
}
