import { t } from '../../i18n';
import { UstvaSection } from './UstvaSection';

// The taxes area: filling aids for returns. For now the advance VAT return (R1); the income tax prepayments (R2) and the
// Anlage EÜR (R3) follow. Every figure is an estimate and a filling aid, not tax advice.

export function TaxesView() {
  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('taxes.title')}</h1>
      </header>
      <p className="lead">{t('taxes.lead')}</p>
      <UstvaSection />
    </div>
  );
}
