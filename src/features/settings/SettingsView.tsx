import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { removeLogo, replaceLogo, useSession } from '../../app/session';
import { Icon, type IconName } from '../../components/Icon';
import { LanguageSelect } from '../../components/LanguageSelect';
import { draftFromProfile, readSection, type CompanyDraft, type CompanyFieldError, type Section } from '../../domain/company';
import type { CompanyFile } from '../../data/types';
import { t, type MessageKey } from '../../i18n';
import { errorText } from '../../lib/labels';
import { showToast, updateCompany, useApp } from '../../store/appStore';
import { InvoiceFields, LogoField, MasterFields, TaxFields, type FieldsProps } from '../company/CompanyFields';
import { BankAccountsCard } from './BankAccountsCard';

// Settings: the fields of the setup assistant, one section at a time. A side panel on the right lists the sections
// and shows one of them. A section is edited as a draft and applied with "Save" after its check; issued documents keep their
// own copy of the values (from Phase 1 on). The other sections stay mounted while hidden, so a draft that is not
// saved yet survives switching; the side panel marks it. The bank accounts have their own card: the assistant asks
// for the first one, here they become a list.

type ProfileSection = Exclude<Section, 'bank'>;
type Pane = ProfileSection | 'accounts' | 'logo' | 'app';

const SECTIONS: { section: ProfileSection; title: MessageKey; Fields: ComponentType<FieldsProps> }[] = [
  { section: 'master', title: 'setup.step.master', Fields: MasterFields },
  { section: 'tax', title: 'setup.step.tax', Fields: TaxFields },
  { section: 'invoice', title: 'setup.step.invoice', Fields: InvoiceFields },
];

const PANES: { pane: Pane; title: MessageKey; icon: IconName }[] = [
  { pane: 'master', title: 'setup.step.master', icon: 'building' },
  { pane: 'tax', title: 'setup.step.tax', icon: 'tax' },
  { pane: 'invoice', title: 'setup.step.invoice', icon: 'invoice' },
  { pane: 'accounts', title: 'accounts.title', icon: 'expense' },
  { pane: 'logo', title: 'logo.label', icon: 'image' },
  { pane: 'app', title: 'settings.app', icon: 'settings' },
];

export function SettingsView() {
  const company = useApp((s) => s.company);
  const [pane, setPane] = useState<Pane>('master');
  const [unsaved, setUnsaved] = useState<ReadonlySet<Pane>>(new Set());
  const markUnsaved = useCallback((p: Pane, dirty: boolean) => {
    setUnsaved((u) => {
      if (u.has(p) === dirty) return u;
      const next = new Set(u);
      if (dirty) next.add(p);
      else next.delete(p);
      return next;
    });
  }, []);
  if (!company) return null;
  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('settings.title')}</h1>
      </header>
      <div className="split">
        <nav className="subnav" aria-label={t('settings.sections')}>
          <ul>
            {PANES.map((p) => (
              <li key={p.pane}>
                <button type="button" className={'nav' + (pane === p.pane ? ' on' : '')} aria-current={pane === p.pane ? 'true' : undefined} onClick={() => setPane(p.pane)}>
                  <Icon n={p.icon} />
                  <span>{t(p.title)}</span>
                  {unsaved.has(p.pane) && (
                    <small className="dot" title={t('settings.unsaved')}>
                      <span className="visually-hidden">{t('settings.unsaved')}</span>
                    </small>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="page-body settings">
          {SECTIONS.map((s) => (
            <SectionCard key={s.section} company={company} {...s} hidden={pane !== s.section} onDirty={markUnsaved} />
          ))}
          <div hidden={pane !== 'accounts'}>
            <BankAccountsCard />
          </div>
          <div hidden={pane !== 'logo'}>
            <LogoCard />
          </div>
          <section className="card" aria-labelledby="settings-app" hidden={pane !== 'app'}>
            <h2 id="settings-app">{t('settings.app')}</h2>
            <LanguageSelect />
            <FolderInfo />
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  company,
  section,
  title,
  Fields,
  hidden,
  onDirty,
}: {
  company: CompanyFile;
  section: ProfileSection;
  title: MessageKey;
  Fields: ComponentType<FieldsProps>;
  hidden: boolean;
  onDirty: (pane: Pane, dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<CompanyDraft>(() => draftFromProfile(company));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<readonly CompanyFieldError[]>([]);
  const headingId = `settings-${section}`;

  // a change from elsewhere (another device, the logo) shows up unless this section is being edited
  useEffect(() => {
    if (!dirty) setDraft(draftFromProfile(company));
  }, [company, dirty]);
  useEffect(() => onDirty(section, dirty), [onDirty, section, dirty]);

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
    <section className="card" aria-labelledby={headingId} hidden={hidden}>
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
