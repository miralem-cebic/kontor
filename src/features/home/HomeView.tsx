import { t } from '../../i18n';
import { useApp } from '../../store/appStore';

/** Start page. The dashboard ("Wo stehe ich?") follows in a later phase. */
export function HomeView() {
  const name = useApp((s) => s.company?.name ?? '');
  return (
    <div className="page">
      <header className="top">
        <h1>{t('home.title')}</h1>
      </header>
      <div className="page-body">
        <p className="lead">{t('home.welcome', { name })}</p>
        <p className="muted">{t('home.next')}</p>
        <p className="disclaimer">{t('disclaimer.text')}</p>
      </div>
    </div>
  );
}
