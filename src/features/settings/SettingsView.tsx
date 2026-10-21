import { useEffect, useState, type ComponentType } from 'react';
import { removeLogo, replaceLogo, useSession } from '../../app/session';
import { LanguageSelect } from '../../components/LanguageSelect';
import { draftFromProfile, readSection, type CompanyDraft, type FieldError, type Section } from '../../domain/company';
import type { CompanyFile } from '../../data/types';
import { t, type MessageKey } from '../../i18n';
import { errorText } from '../../lib/labels';
import { showToast, updateCompany, useApp } from '../../store/appStore';
import { BankFields, InvoiceFields, LogoField, MasterFields, TaxFields, type FieldsProps } from '../company/CompanyFields';

// Settings: the fields of the setup assistant, one section at a time. A section is edited as a draft and
// applied with "Save" after its check; issued documents keep their own copy of the values (from Phase 1 on).

const SECTIONS: { section: Section; title: MessageKey; Fields: ComponentType<FieldsProps> }[] = [
  { section: 'master', title: 'setup.step.master', Fields: MasterFields },
  { section: 'tax', title: 'setup.step.tax', Fields: TaxFields },
  { section: 'bank', title: 'setup.step.bank', Fields: BankFields },
  { section: 'invoice', title: 'setup.step.invoice', Fields: InvoiceFields },
];

export function SettingsView() {
  const company = useApp((s) => s.company);
  if (!company) return null;
  return (
    <div className="page">
      <header className="top">
        <h1>{t('settings.title')}</h1>
      </header>
      <div className="page-body settings">
        {SECTIONS.map((s) => (
          <SectionCard key={s.section} company={company} {...s} />
        ))}
        <LogoCard />
        <section className="card" aria-labelledby="settings-app">
          <h2 id="settings-app">{t('settings.app')}</h2>
          <LanguageSelect />
          <FolderInfo />
        </section>
      </div>
    </div>
  );
}

function SectionCard({ company, section, title, Fields }: { company: CompanyFile; section: Section; title: MessageKey; Fields: ComponentType<FieldsProps> }) {
  const [draft, setDraft] = useState<CompanyDraft>(() => draftFromProfile(company));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const headingId = `settings-${section}`;

  // a change from elsewhere (another device, the logo) shows up unless this section is being edited
  useEffect(() => {
    if (!dirty) setDraft(draftFromProfile(company));
  }, [company, dirty]);

  const set = (patch: Partial<CompanyDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    if (errors.length) {
      const r = readSection(section, { ...draft, ...patch });
      setErrors(r.ok ? [] : r.error);
    }
  };

  const save = () => {
    const r = readSection(section, draft);
    if (!r.ok) {
      setErrors(r.error);
      return;
    }
    updateCompany(r.value);
    setErrors([]);
    setDirty(false);
    showToast(t('settings.applied', { section: t(title) }));
  };

  const discard = () => {
    setDraft(draftFromProfile(company));
    setErrors([]);
    setDirty(false);
  };

  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId}>{t(title)}</h2>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Fields draft={draft} set={set} errors={errors} />
        <div className="card-actions">
          <button type="submit" className="btn primary" disabled={!dirty}>
            {t('settings.save')}
          </button>
          <button type="button" className="btn" onClick={discard} disabled={!dirty}>
            {t('settings.discard')}
          </button>
        </div>
      </form>
    </section>
  );
}

function LogoCard() {
  const url = useApp((s) => s.logoUrl);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card" aria-labelledby="settings-logo">
      <h2 id="settings-logo">{t('logo.label')}</h2>
      <LogoField
        url={url}
        onPick={async (logo) => {
          const failed = await replaceLogo(logo);
          setError(failed ? errorText(failed) : null);
        }}
        onRemove={removeLogo}
      />
      {error && (
        <p className="f-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function FolderInfo() {
  const companies = useSession((s) => s.companies);
  const company = useApp((s) => s.company);
  if (!company) return null;
  return (
    <dl className="facts">
      <dt>{t('settings.companyId')}</dt>
      <dd>
        <code>{company.id}</code>
      </dd>
      <dt>{t('settings.knownCompanies')}</dt>
      <dd>{companies.length}</dd>
    </dl>
  );
}
