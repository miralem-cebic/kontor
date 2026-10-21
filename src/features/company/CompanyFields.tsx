import { useId, useState } from 'react';
import type { LogoUpload } from '../../app/session';
import { CheckField, Choice, Row, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { checkLogo, LIMITS, type CompanyDraft, type CompanyFieldError, type VatMethod, type VatPeriod } from '../../domain/company';
import { formatNumber, patternProblem } from '../../domain/numbering';
import { t } from '../../i18n';
import { fieldError, logoProblemText } from '../../lib/labels';

// The form fields of the company profile, shared by the setup assistant and the settings page.

export interface FieldsProps {
  draft: CompanyDraft;
  set: (patch: Partial<CompanyDraft>) => void;
  errors: readonly CompanyFieldError[];
}

export function MasterFields({ draft, set, errors }: FieldsProps) {
  const e = (f: keyof CompanyDraft) => fieldError(errors, f);
  return (
    <>
      <TextField label={t('company.name')} value={draft.name} onChange={(name) => set({ name })} error={e('name')} required autoComplete="organization" maxLength={LIMITS.name} />
      <TextField label={t('company.owner')} hint={t('company.ownerHint')} value={draft.owner} onChange={(owner) => set({ owner })} error={e('owner')} required autoComplete="name" maxLength={LIMITS.owner} />
      <TextField label={t('company.street')} value={draft.street} onChange={(street) => set({ street })} error={e('street')} required autoComplete="street-address" maxLength={LIMITS.street} />
      <Row>
        <TextField className="w-postal" label={t('company.postalCode')} value={draft.postalCode} onChange={(postalCode) => set({ postalCode })} error={e('postalCode')} required autoComplete="postal-code" inputMode="numeric" />
        <TextField label={t('company.city')} value={draft.city} onChange={(city) => set({ city })} error={e('city')} required autoComplete="address-level2" maxLength={LIMITS.city} />
        <TextField className="w-country" label={t('company.country')} hint={t('company.countryHint')} value={draft.country} onChange={(country) => set({ country })} error={e('country')} required autoComplete="country" maxLength={2} />
      </Row>
      <Row>
        <TextField label={t('company.email')} type="email" value={draft.email} onChange={(email) => set({ email })} error={e('email')} required autoComplete="email" inputMode="email" maxLength={LIMITS.email} />
        <TextField label={t('company.phone')} type="tel" value={draft.phone} onChange={(phone) => set({ phone })} error={e('phone')} autoComplete="tel" inputMode="tel" maxLength={LIMITS.phone} />
      </Row>
    </>
  );
}

const yesNo = (v: boolean | null) => (v === null ? null : v ? 'yes' : 'no');

export function TaxFields({ draft, set, errors }: FieldsProps) {
  const e = (f: keyof CompanyDraft) => fieldError(errors, f);
  return (
    <>
      <p className="f-intro">{t('tax.idsIntro')}</p>
      <Row>
        <TextField label={t('tax.taxNumber')} hint={t('tax.taxNumberHint')} value={draft.taxNumber} onChange={(taxNumber) => set({ taxNumber })} error={e('taxNumber')} maxLength={40} />
        <TextField label={t('tax.vatId')} hint={t('tax.vatIdHint')} value={draft.vatId} onChange={(vatId) => set({ vatId })} error={e('vatId')} maxLength={20} />
      </Row>
      <Choice
        label={t('tax.smallBusiness')}
        hint={t('tax.smallBusinessHint')}
        value={yesNo(draft.smallBusiness)}
        options={[
          { value: 'yes', label: t('tax.smallBusinessYes') },
          { value: 'no', label: t('tax.smallBusinessNo') },
        ]}
        onChange={(v) => set({ smallBusiness: v === 'yes' })}
        error={e('smallBusiness')}
        required
      />
      {draft.smallBusiness === false && (
        <>
          <Choice<VatMethod>
            label={t('tax.method')}
            value={draft.vatMethod}
            options={[
              { value: 'accrual', label: t('tax.methodAccrual'), hint: t('tax.methodAccrualHint') },
              { value: 'cash', label: t('tax.methodCash'), hint: t('tax.methodCashHint') },
            ]}
            onChange={(vatMethod) => set({ vatMethod })}
            error={e('vatMethod')}
            required
          />
          <Choice<VatPeriod>
            label={t('tax.period')}
            value={draft.vatPeriod}
            options={[
              { value: 'monthly', label: t('tax.periodMonthly') },
              { value: 'quarterly', label: t('tax.periodQuarterly') },
              { value: 'yearly', label: t('tax.periodYearly') },
            ]}
            onChange={(vatPeriod) => set({ vatPeriod })}
            error={e('vatPeriod')}
            required
          />
          {draft.vatPeriod !== 'yearly' && draft.vatPeriod !== null && (
            <CheckField label={t('tax.extension')} hint={t('tax.extensionHint')} checked={draft.permanentExtension} onChange={(permanentExtension) => set({ permanentExtension })} />
          )}
        </>
      )}
      <Choice
        label={t('tax.business')}
        value={draft.businessKind}
        options={[
          { value: 'freelance', label: t('tax.freelance'), hint: t('tax.freelanceHint') },
          { value: 'trade', label: t('tax.trade'), hint: t('tax.tradeHint') },
        ]}
        onChange={(businessKind) => set({ businessKind })}
        error={e('businessKind')}
        required
      />
      {draft.businessKind === 'trade' && (
        <Row>
          <TextField label={t('tax.municipality')} value={draft.municipality} onChange={(municipality) => set({ municipality })} error={e('municipality')} required maxLength={LIMITS.municipality} />
          <TextField className="w-num" label={t('tax.multiplier')} hint={t('tax.multiplierHint')} value={draft.multiplier} onChange={(multiplier) => set({ multiplier })} error={e('multiplier')} required inputMode="numeric" maxLength={4} />
        </Row>
      )}
    </>
  );
}

export function BankFields({ draft, set, errors }: FieldsProps) {
  const e = (f: keyof CompanyDraft) => fieldError(errors, f);
  return (
    <>
      <TextField label={t('bank.holder')} value={draft.bankHolder} onChange={(bankHolder) => set({ bankHolder })} error={e('bankHolder')} required maxLength={LIMITS.bankHolder} />
      <TextField label={t('bank.iban')} value={draft.iban} onChange={(iban) => set({ iban })} error={e('iban')} required maxLength={42} />
      <TextField className="w-bic" label={t('bank.bic')} hint={t('bank.bicHint')} value={draft.bic} onChange={(bic) => set({ bic })} error={e('bic')} maxLength={11} />
    </>
  );
}

export function InvoiceFields({ draft, set, errors }: FieldsProps) {
  const e = (f: keyof CompanyDraft) => fieldError(errors, f);
  const now = new Date();
  const pattern = draft.numberPattern.trim();
  const preview = patternProblem(pattern) === null ? formatNumber(pattern, { year: now.getFullYear(), month: now.getMonth() + 1, counter: 1 }) : null;
  return (
    <>
      <TextField
        label={t('invoice.pattern')}
        hint={preview ? t('invoice.patternPreview', { number: preview }) : t('invoice.patternHint')}
        value={draft.numberPattern}
        onChange={(numberPattern) => set({ numberPattern })}
        error={e('numberPattern')}
        required
        maxLength={60}
      />
      <TextField className="w-num" label={t('invoice.paymentTerm')} hint={t('invoice.paymentTermHint')} value={draft.paymentTermDays} onChange={(paymentTermDays) => set({ paymentTermDays })} error={e('paymentTermDays')} required inputMode="numeric" maxLength={3} />
      <TextArea label={t('invoice.footer')} hint={t('invoice.footerHint')} value={draft.footer} onChange={(footer) => set({ footer })} error={e('footer')} maxLength={LIMITS.footer} />
    </>
  );
}

/** Choose a logo file. The content is checked (PNG, JPEG or SVG by its bytes, size limit) before it is used. */
export function LogoField({ url, onPick, onRemove }: { url: string | null; onPick: (logo: LogoUpload) => void; onRemove: () => void }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="field logo-field">
      <span className="f-label" id={`${id}-label`}>
        {t('logo.label')}
      </span>
      <div className="logo-row">
        <div className="logo-box">{url ? <img src={url} alt={t('logo.preview')} /> : <Icon n="image" s={22} />}</div>
        <div className="logo-actions">
          <label className="btn sm" htmlFor={id}>
            {url ? t('logo.replace') : t('logo.choose')}
          </label>
          <input
            id={id}
            className="visually-hidden"
            type="file"
            accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-hint`}
            onChange={async (ev) => {
              const input = ev.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (!file) return;
              const bytes = new Uint8Array(await file.arrayBuffer());
              const res = checkLogo(bytes);
              if (!res.ok) return setError(logoProblemText(res.error));
              setError(null);
              onPick({ bytes, type: res.value });
            }}
          />
          {url && (
            <button type="button" className="btn sm ghost" onClick={onRemove}>
              {t('logo.remove')}
            </button>
          )}
        </div>
      </div>
      <p className="f-hint" id={`${id}-hint`}>
        {t('logo.hint')}
      </p>
      {error && (
        <p className="f-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
