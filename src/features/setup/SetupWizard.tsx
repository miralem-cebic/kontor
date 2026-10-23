import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cancelSetup, chooseSetupFolder, finishSetup, useSession, type FolderChoice, type LogoUpload, type SessionError } from '../../app/session';
import { Icon } from '../../components/Icon';
import { LanguageSelect } from '../../components/LanguageSelect';
import { emptyDraft, readProfile, readSection, type CompanyDraft, type Section } from '../../domain/company';
import { checkSupport } from '../../data/fs/support';
import { t, type MessageKey } from '../../i18n';
import { errorText } from '../../lib/labels';
import { BankFields, InvoiceFields, LogoField, MasterFields, TaxFields, thisYear } from '../company/CompanyFields';
import { ProfileSummary } from '../company/ProfileSummary';

// Setup assistant for the first start and for "Add company". Every step is checked before the next one;
// "Back" is always possible. Nothing is written before "Finish" (drafts never reach the disk).

const STEPS = ['browser', 'folder', 'master', 'tax', 'bank', 'invoice', 'summary'] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLE: Record<Step, MessageKey> = {
  browser: 'setup.step.browser',
  folder: 'setup.step.folder',
  master: 'setup.step.master',
  tax: 'setup.step.tax',
  bank: 'setup.step.bank',
  invoice: 'setup.step.invoice',
  summary: 'setup.step.summary',
};

const SECTION_OF: Partial<Record<Step, Section>> = { master: 'master', tax: 'tax', bank: 'bank', invoice: 'invoice' };

type Folder = Extract<FolderChoice, { kind: 'empty' | 'notEmpty' }>;

export function SetupWizard() {
  const cancelable = useSession((s) => s.setupCancelable);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<CompanyDraft>(emptyDraft);
  const [checked, setChecked] = useState<ReadonlySet<Section>>(new Set());
  const [folder, setFolder] = useState<Folder | null>(null);
  const [logo, setLogo] = useState<{ upload: LogoUpload; url: string } | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const step = STEPS[index] ?? 'browser';

  useEffect(() => {
    // move the focus to the new step, so that keyboard and screen reader users start at its top
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [index]);

  useEffect(() => () => void (logo && URL.revokeObjectURL(logo.url)), [logo]);

  const set = (patch: Partial<CompanyDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const section = SECTION_OF[step];
  const sectionResult = section ? readSection(section, draft, thisYear()) : null;
  const errors = section && checked.has(section) && sectionResult && !sectionResult.ok ? sectionResult.error : [];

  const go = (i: number) => {
    setError(null);
    setIndex(i);
  };

  const next = () => {
    if (section && sectionResult && !sectionResult.ok) {
      setChecked((s) => new Set(s).add(section));
      requestAnimationFrame(focusFirstInvalid);
      return;
    }
    // the account holder is usually the owner: suggest it once
    if (step === 'master' && !draft.bankHolder.trim()) set({ bankHolder: draft.owner.trim() });
    go(index + 1);
  };

  const pick = async () => {
    setBusy(true);
    setError(null);
    const choice = await chooseSetupFolder();
    setBusy(false);
    if (!choice || choice.kind === 'opened') return;
    if (choice.kind === 'error') return setError(choice.error);
    setFolder(choice);
  };

  const finish = async () => {
    const profile = readProfile(draft, thisYear());
    if (!profile.ok) {
      // every step was checked on the way here; should a section still fail, go back to it with its errors shown
      setChecked(new Set(Object.values(SECTION_OF)));
      return go(Math.max(0, STEPS.findIndex((s) => { const sec = SECTION_OF[s]; return sec !== undefined && !readSection(sec, draft, thisYear()).ok; })));
    }
    setBusy(true);
    const failed = await finishSetup(profile.value, logo?.upload ?? null);
    setBusy(false);
    if (failed) setError(failed);
  };

  const canContinue = step !== 'folder' || folder !== null;

  return (
    <main className="onb">
      <div className="onb-card wizard">
        <div className="wz-top">
          <div className="brand">
            <span className="logo" aria-hidden="true">
              <Icon n="building" s={14} />
            </span>
            kontor
          </div>
          {cancelable && (
            <button type="button" className="btn sm ghost" onClick={cancelSetup}>
              {t('common.cancel')}
            </button>
          )}
        </div>
        <ol className="steps" aria-label={t('setup.progress')}>
          {STEPS.map((s, i) => (
            <li key={s} className={i === index ? 'on' : i < index ? 'done' : ''} aria-current={i === index ? 'step' : undefined}>
              <span className="n">{i < index ? <Icon n="check" s={12} /> : i + 1}</span>
              <span className="l">{t(STEP_TITLE[s])}</span>
            </li>
          ))}
        </ol>
        <h1 ref={heading} tabIndex={-1}>
          {t(STEP_TITLE[step])}
        </h1>

        {step === 'browser' && <BrowserStep />}
        {step === 'folder' && <FolderStep folder={folder} busy={busy} onPick={() => void pick()} />}
        {step === 'master' && (
          <Form>
            <MasterFields draft={draft} set={set} errors={errors} />
            <LogoField
              url={logo?.url ?? null}
              onPick={(upload) => setLogo({ upload, url: URL.createObjectURL(new Blob([upload.bytes], { type: upload.type })) })}
              onRemove={() => setLogo(null)}
            />
          </Form>
        )}
        {step === 'tax' && (
          <Form>
            <TaxFields draft={draft} set={set} errors={errors} />
          </Form>
        )}
        {step === 'bank' && (
          <Form>
            <BankFields draft={draft} set={set} errors={errors} />
          </Form>
        )}
        {step === 'invoice' && (
          <Form>
            <InvoiceFields draft={draft} set={set} errors={errors} />
          </Form>
        )}
        {step === 'summary' && (
          <SummaryStep draft={draft} folder={folder} hasLogo={logo !== null} onEdit={(s) => go(STEPS.indexOf(s))} />
        )}

        {error && (
          <p className="onb-text err" role="alert">
            {errorText(error)}
          </p>
        )}

        <div className="wz-nav">
          {index > 0 && (
            <button type="button" className="btn" onClick={() => go(index - 1)} disabled={busy}>
              <Icon n="chevL" s={14} />
              {t('common.back')}
            </button>
          )}
          <span className="sp" />
          {step === 'summary' ? (
            <button type="button" className="btn primary" onClick={() => void finish()} disabled={busy}>
              {t('setup.finish')}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={next} disabled={!canContinue || busy}>
              {t('common.next')}
              <Icon n="chevR" s={14} />
            </button>
          )}
        </div>
        <div className="wz-foot">
          <LanguageSelect />
        </div>
      </div>
    </main>
  );
}

/** After the errors of a step have rendered: focus the first invalid field (or the first option of a group) */
function focusFirstInvalid() {
  const el = document.querySelector('.wizard [aria-invalid="true"]');
  const target = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : el?.querySelector('input');
  target?.focus();
}

function Form({ children }: { children: ReactNode }) {
  // Enter in a field does not submit anything: the step buttons move on
  return (
    <form className="form" noValidate onSubmit={(e) => e.preventDefault()}>
      {children}
    </form>
  );
}

function BrowserStep() {
  const s = checkSupport();
  const items: { ok: boolean; label: MessageKey }[] = [
    { ok: s.hasDirectoryPicker, label: 'setup.browser.folderAccess' },
    { ok: s.hasIndexedDb, label: 'setup.browser.storage' },
    { ok: s.secureContext, label: 'setup.browser.secure' },
  ];
  return (
    <>
      <p className="onb-text">{t('setup.browser.text')}</p>
      <ul className="checks">
        {items.map((i) => (
          <li key={i.label} className={i.ok ? 'ok' : 'bad'}>
            <Icon n={i.ok ? 'check' : 'x'} s={14} />
            {t(i.label)}
          </li>
        ))}
      </ul>
      <p className="onb-text small">{t('setup.browser.privacy')}</p>
    </>
  );
}

function FolderStep({ folder, busy, onPick }: { folder: Folder | null; busy: boolean; onPick: () => void }) {
  return (
    <>
      <p className="onb-text">{t('setup.folder.text')}</p>
      <p className="onb-text small">{t('setup.folder.existing')}</p>
      <button type="button" className="btn lg" onClick={onPick} disabled={busy}>
        <Icon n="folder" />
        {folder ? t('setup.folder.other') : t('setup.folder.choose')}
      </button>
      {folder && (
        <p className="onb-note" role="status">
          {folder.kind === 'empty' ? t('setup.folder.empty', { name: folder.name }) : t('setup.folder.notEmpty', { name: folder.name })}
        </p>
      )}
    </>
  );
}

function SummaryStep({ draft, folder, hasLogo, onEdit }: { draft: CompanyDraft; folder: Folder | null; hasLogo: boolean; onEdit: (step: Step) => void }) {
  const profile = readProfile(draft, thisYear());
  return (
    <>
      <p className="onb-text">{t('setup.summary.text')}</p>
      {folder && (
        <p className="onb-note">
          {folder.kind === 'empty' ? t('setup.summary.folder', { name: folder.name }) : t('setup.summary.subfolder', { name: folder.name, sub: draft.name.trim() })}
        </p>
      )}
      {profile.ok && <ProfileSummary profile={profile.value} hasLogo={hasLogo} onEdit={(s) => onEdit(s)} />}
      <p className="disclaimer">{t('disclaimer.text')}</p>
    </>
  );
}
