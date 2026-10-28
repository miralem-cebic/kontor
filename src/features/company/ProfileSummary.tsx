import type { ReactNode } from 'react';
import type { NewCompany, Section } from '../../domain/company';
import { formatIban } from '../../domain/iban';
import { formatNumber } from '../../domain/numbering';
import { t, type MessageKey } from '../../i18n';

// Read-only view of what the setup assistant collected, grouped like the sections of the forms.

const METHOD: Record<'cash' | 'accrual', MessageKey> = { cash: 'tax.methodCash', accrual: 'tax.methodAccrual' };
const PERIOD: Record<'monthly' | 'quarterly' | 'yearly', MessageKey> = { monthly: 'tax.periodMonthly', quarterly: 'tax.periodQuarterly', yearly: 'tax.periodYearly' };

function Group({ title, section, onEdit, children }: { title: string; section: Section; onEdit: (s: Section) => void; children: ReactNode }) {
  return (
    <section className="sum-group" aria-label={title}>
      <div className="sum-head">
        <h2>{title}</h2>
        <button type="button" className="link" onClick={() => onEdit(section)} aria-label={t('summary.editNamed', { name: title })}>
          {t('summary.edit')}
        </button>
      </div>
      <dl>{children}</dl>
    </section>
  );
}

const Item = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

export function ProfileSummary({ profile: p, hasLogo, onEdit }: { profile: NewCompany; hasLogo: boolean; onEdit: (s: Section) => void }) {
  const vat = p.tax.vat;
  const business = p.tax.business;
  const now = new Date();
  const none = t('summary.none');
  return (
    <div className="summary">
      <Group title={t('setup.step.master')} section="master" onEdit={onEdit}>
        <Item label={t('company.name')}>{p.name}</Item>
        <Item label={t('company.owner')}>{p.owner}</Item>
        <Item label={t('summary.address')}>
          {p.address.street}, {p.address.postalCode} {p.address.city}, {p.address.country}
        </Item>
        <Item label={t('company.email')}>{p.contact.email}</Item>
        <Item label={t('company.phone')}>{p.contact.phone || none}</Item>
        <Item label={t('logo.label')}>{hasLogo ? t('summary.logoYes') : none}</Item>
      </Group>
      <Group title={t('setup.step.tax')} section="tax" onEdit={onEdit}>
        <Item label={t('tax.taxNumber')}>{p.tax.taxNumber || none}</Item>
        <Item label={t('tax.vatId')}>{p.tax.vatId || none}</Item>
        <Item label={t('summary.vat')}>
          {vat.kind === 'smallBusiness'
            ? t('summary.smallBusiness')
            : [t(METHOD[vat.method]), t(PERIOD[vat.period]), ...(vat.permanentExtension ? [t('summary.extension')] : [])].join(' · ')}
        </Item>
        <Item label={t('tax.business')}>
          {business.kind === 'freelance' ? t('tax.freelance') : t('summary.trade', { municipality: business.municipality, multiplier: business.multiplierPercent })}
        </Item>
      </Group>
      <Group title={t('setup.step.bank')} section="bank" onEdit={onEdit}>
        <Item label={t('bank.holder')}>{p.account.holder}</Item>
        <Item label={t('bank.iban')}>{formatIban(p.account.iban)}</Item>
        <Item label={t('bank.bic')}>{p.account.bic || none}</Item>
      </Group>
      <Group title={t('setup.step.invoice')} section="invoice" onEdit={onEdit}>
        <Item label={t('invoice.pattern')}>
          {p.invoiceDefaults.numberPattern} ({t('summary.firstNumber', { number: formatNumber(p.invoiceDefaults.numberPattern, { year: now.getFullYear(), month: now.getMonth() + 1, counter: 1 }) })})
        </Item>
        <Item label={t('invoice.quotePattern')}>
          {p.invoiceDefaults.quotePattern} ({t('summary.firstNumber', { number: formatNumber(p.invoiceDefaults.quotePattern, { year: now.getFullYear(), month: now.getMonth() + 1, counter: 1 }) })})
        </Item>
        <Item label={t('invoice.paymentTerm')}>{t('summary.days', { n: p.invoiceDefaults.paymentTermDays })}</Item>
        <Item label={t('invoice.footer')}>{p.invoiceDefaults.footer || none}</Item>
      </Group>
    </div>
  );
}
