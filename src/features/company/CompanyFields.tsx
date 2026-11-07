import { useId, useState } from 'react';
import type { LogoUpload } from '../../app/session';
import { ExternalLink } from '../../components/ExternalLink';
import { CheckField, CheckGroup, Choice, Row, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import type { AccountDetails } from '../../domain/bankAccount';
import { checkLogo, FOOTER_PARTS, LIMITS, TRADE_TAX_MULTIPLIER_SOURCE, type CompanyDraft, type CompanyFieldError, type FooterPart, type VatMethod, type VatPeriod } from '../../domain/company';
import { normalizeIban } from '../../domain/iban';
import { normalizeVatId } from '../../domain/taxIds';
import { footerColumns } from '../../pdf/content';
import { formatNumber, nextFreeNumber, patternProblem } from '../../domain/numbering';
import { taxParams } from '../../domain/tax/params';
import { upcomingMinimum } from '../../domain/tax/tradeTax';
import { currentLang, t, type MessageKey } from '../../i18n';
import { fieldError, logoProblemText } from '../../lib/labels';

// The form fields of the company profile, shared by the setup assistant and the settings page. The bank fields are
// the first account of the setup assistant; the settings edit the accounts in their own card (BankAccountsCard).

export interface FieldsProps {
  draft: CompanyDraft;
  set: (patch: Partial<CompanyDraft>) => void;
  errors: readonly CompanyFieldError[];
  /** The account the footer preview shows (the settings pass the default account); without it, the account of the draft */
  account?: AccountDetails | null;
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

/** The year the forms check against: the legal minimum of the trade tax multiplier depends on it */
export const thisYear = (): number => new Date().getFullYear();

export function TaxFields({ draft, set, errors }: FieldsProps) {
  const e = (f: keyof CompanyDraft) => fieldError(errors, f);
  return (
    <>
      <div className="note" role="note">
        <p>{t('tax.scope')}</p>
        <p>{t('tax.scopeVat')}</p>
      </div>
      <p className="f-intro">{t('tax.idsIntro')}</p>
      <Row>
        <TextField label={t('tax.taxNumber')} hint={t('tax.taxNumberHint')} value={draft.taxNumber} onChange={(taxNumber) => set({ taxNumber })} error={e('taxNumber')} maxLength={40} />
        <TextField label={t('tax.vatId')} hint={t('tax.vatIdHint')} value={draft.vatId} onChange={(vatId) => set({ vatId })} error={e('vatId')} maxLength={20} />
      </Row>
      <div className="note" role="note" aria-label={t('smallBusiness.waiverTitle')}>
        <p>
          <strong>{t('smallBusiness.waiverTitle')}</strong>
        </p>
        <p>{t('smallBusiness.waiverText')}</p>
        <p>{t('smallBusiness.waiverBinding', { years: taxParams(thisYear()).smallBusiness.waiverBindingYears })}</p>
        <p>{t('smallBusiness.waiverNo')}</p>
      </div>
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
        <>
          <Row>
            <TextField label={t('tax.municipality')} value={draft.municipality} onChange={(municipality) => set({ municipality })} error={e('municipality')} required maxLength={LIMITS.municipality} />
            <TextField className="w-num" label={t('tax.multiplier')} hint={t('tax.multiplierHint')} value={draft.multiplier} onChange={(multiplier) => set({ multiplier })} error={e('multiplier')} required inputMode="numeric" maxLength={4} />
          </Row>
          <RaisedMinimum multiplier={draft.multiplier} />
          <p className="f-hint">
            {t('tax.multiplierSource')} <ExternalLink href={TRADE_TAX_MULTIPLIER_SOURCE}>{t('tax.multiplierSourceLink')}</ExternalLink>
          </p>
        </>
      )}
    </>
  );
}

/** A multiplier that is allowed this year but below the legal minimum of a later year: from then on the minimum applies */
function RaisedMinimum({ multiplier }: { multiplier: string }) {
  const value = multiplier.trim();
  const raised = /^\d+$/.test(value) ? upcomingMinimum(Number(value), thisYear()) : null;
  return raised ? <p className="f-hint">{t('tax.multiplierRaised', { year: raised.year, min: raised.percent })}</p> : null;
}

export function BankFields({ draft, set, errors }: FieldsProps) {
  const e = (f: keyof CompanyDraft) => fieldError(errors, f);
  return (
    <>
      <p className="f-intro">{t('bank.setupNote')}</p>
      <TextField label={t('bank.holder')} value={draft.bankHolder} onChange={(bankHolder) => set({ bankHolder })} error={e('bankHolder')} required maxLength={LIMITS.bankHolder} />
      <TextField label={t('bank.iban')} value={draft.iban} onChange={(iban) => set({ iban })} error={e('iban')} required maxLength={42} />
      <TextField className="w-bic" label={t('bank.bic')} hint={t('bank.bicHint')} value={draft.bic} onChange={(bic) => set({ bic })} error={e('bic')} maxLength={11} />
    </>
  );
}

/** The first number of a pattern in the current year, or null while the pattern cannot be used */
function firstNumber(pattern: string): string | null {
  const now = new Date();
  const p = pattern.trim();
  return patternProblem(p) === null ? formatNumber(p, { year: now.getFullYear(), month: now.getMonth() + 1, counter: 1 }) : null;
}

/** The first contact or item number of a pattern, or null while the pattern cannot number them (F28) */
const firstCounterNumber = (pattern: string): string | null => nextFreeNumber(pattern.trim(), []);

/** The account typed into the setup assistant, as the footer will show it; null while there is no IBAN */
const draftAccount = (d: CompanyDraft): AccountDetails | null =>
  d.iban.trim() === '' ? null : { kind: 'bank', name: '', holder: d.bankHolder.trim(), iban: normalizeIban(d.iban), bic: d.bic.trim().toUpperCase() };

const FOOTER_PART_LABEL = { address: 'invoice.footerPartAddress', phone: 'invoice.footerPartPhone', email: 'invoice.footerPartEmail' } as const satisfies Record<FooterPart, MessageKey>;

/** The footer of a document as it will print, built from what is typed so far (not saved) */
function FooterPreview({ draft, account }: { draft: CompanyDraft; account: AccountDetails | null }) {
  const columns = footerColumns(
    {
      name: draft.name.trim(),
      owner: draft.owner.trim(),
      address: { street: draft.street.trim(), postalCode: draft.postalCode.trim(), city: draft.city.trim(), country: draft.country.trim() },
      contact: { email: draft.email.trim(), phone: draft.phone.trim() },
      tax: { taxNumber: draft.taxNumber.trim(), vatId: normalizeVatId(draft.vatId) },
      invoiceDefaults: { footerParts: draft.footerParts },
    },
    account,
    currentLang(),
  );
  const extra = draft.footer.trim();
  return (
    <div className="field">
      <span className="f-label">{t('invoice.footerPreview')}</span>
      <div className="footer-preview" role="group" aria-label={t('invoice.footerPreview')} data-testid="footer-preview">
        {extra !== '' && <p className="footer-extra">{extra}</p>}
        <div className="footer-cols">
          {columns.map((lines, i) => (
            <div key={i} className="footer-col">
              {lines.map((line, j) => (
                <span key={j}>{line}</span>
              ))}
            </div>
          ))}
        </div>
        {columns.length === 0 && <span className="f-hint">{t('invoice.footerPreviewEmpty')}</span>}
      </div>
    </div>
  );
}

export function InvoiceFields({ draft, set, errors, account }: FieldsProps) {
  const e = (f: keyof CompanyDraft) => fieldError(errors, f);
  const preview = firstNumber(draft.numberPattern);
  const quotePreview = firstNumber(draft.quotePattern);
  const contactPreview = firstCounterNumber(draft.contactPattern);
  const itemPreview = firstCounterNumber(draft.itemPattern);
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
      <TextField
        label={t('invoice.quotePattern')}
        hint={quotePreview ? `${t('invoice.quotePatternPreview', { number: quotePreview })} ${t('invoice.quotePatternHint')}` : t('invoice.quotePatternHint')}
        value={draft.quotePattern}
        onChange={(quotePattern) => set({ quotePattern })}
        error={e('quotePattern')}
        required
        maxLength={60}
      />
      <TextField
        label={t('invoice.contactPattern')}
        hint={contactPreview ? `${t('invoice.contactPatternPreview', { number: contactPreview })} ${t('invoice.contactPatternHint')}` : t('invoice.contactPatternHint')}
        value={draft.contactPattern}
        onChange={(contactPattern) => set({ contactPattern })}
        error={e('contactPattern')}
        required
        maxLength={60}
      />
      <TextField
        label={t('invoice.itemPattern')}
        hint={itemPreview ? `${t('invoice.itemPatternPreview', { number: itemPreview })} ${t('invoice.itemPatternHint')}` : t('invoice.itemPatternHint')}
        value={draft.itemPattern}
        onChange={(itemPattern) => set({ itemPattern })}
        error={e('itemPattern')}
        required
        maxLength={60}
      />
      <TextField className="w-num" label={t('invoice.paymentTerm')} hint={t('invoice.paymentTermHint')} value={draft.paymentTermDays} onChange={(paymentTermDays) => set({ paymentTermDays })} error={e('paymentTermDays')} required inputMode="numeric" maxLength={3} />
      <CheckGroup<FooterPart>
        label={t('invoice.footerParts')}
        options={FOOTER_PARTS.map((key) => ({ key, label: t(FOOTER_PART_LABEL[key]), checked: draft.footerParts[key] }))}
        onChange={(key, checked) => set({ footerParts: { ...draft.footerParts, [key]: checked } })}
      />
      <p className="f-hint">{t('invoice.footerPartsHint')}</p>
      <TextArea label={t('invoice.footer')} hint={t('invoice.footerHint')} value={draft.footer} onChange={(footer) => set({ footer })} error={e('footer')} maxLength={LIMITS.footer} />
      <FooterPreview draft={draft} account={account === undefined ? draftAccount(draft) : account} />
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
