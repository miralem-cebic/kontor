import { useId, useMemo, useState } from 'react';
import { planImport, readImportFile, runImport, undoImport, type ImportFileProblem, type ImportPlan, type ImportSheet } from '../../app/imports';
import { SelectField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import type { ImportBatchId } from '../../data/ids';
import { batchesOf, isImportOnlyProblem, suggestMapping, CONTACT_IMPORT_FIELDS, ITEM_IMPORT_FIELDS, type ImportField, type ImportKind, type ImportOnlyProblem, type Mapping, type PlannedRow, type RowProblem } from '../../domain/import';
import type { MoneyLocale } from '../../domain/money';
import { t, type MessageKey } from '../../i18n';
import { problemText } from '../../lib/labels';
import { showToast, useApp } from '../../store/appStore';
import { formatDate } from '../documents/common';

// Imports contacts or items from a file: choose the file, match its columns to the fields, check the rows, and import
// the rows that are fine as one batch. The imports that still have records are listed at the bottom; one can be taken
// back as a whole. The rules are in domain/import.ts, the work with the store in app/imports.ts.

const READ_ERROR_KEY: Record<ImportFileProblem, MessageKey> = {
  empty: 'import.readError.empty',
  tooLarge: 'import.readError.tooLarge',
  tooManyRows: 'import.readError.tooManyRows',
  tooManyColumns: 'import.readError.tooManyColumns',
  cellTooLong: 'import.readError.cellTooLong',
  invalid: 'import.readError.invalid',
  unsupported: 'import.readError.unsupported',
  unsafeName: 'import.readError.unsafeName',
  tooManyEntries: 'import.readError.tooManyEntries',
  noSheet: 'import.readError.noSheet',
};

/** The fields a file must give a value to, per kind */
const REQUIRED: Record<ImportKind, readonly ImportField[]> = { contacts: ['name'], items: ['name', 'netPrice'] };

const FIELD_KEY: Record<ImportField, MessageKey> = {
  name: 'import.field.name',
  customerNumber: 'import.field.customerNumber',
  kind: 'import.field.kind',
  roles: 'import.field.roles',
  email: 'import.field.email',
  phone: 'import.field.phone',
  street: 'import.field.street',
  postalCode: 'import.field.postalCode',
  city: 'import.field.city',
  country: 'import.field.country',
  vatId: 'import.field.vatId',
  leitwegId: 'import.field.leitwegId',
  notes: 'import.field.notes',
  number: 'import.field.number',
  description: 'import.field.description',
  unit: 'import.field.unit',
  netPrice: 'import.field.netPrice',
  vatRate: 'import.field.vatRate',
};

const IMPORT_PROBLEM_KEY: Record<ImportOnlyProblem, MessageKey> = {
  kindUnknown: 'import.problem.kindUnknown',
  rolesUnknown: 'import.problem.rolesUnknown',
  unitUnknown: 'import.problem.unitUnknown',
  vatRateUnknown: 'import.problem.vatRateUnknown',
};

/** What is wrong with a row, in words. The problems of the forms have their words already. */
function problemWords(p: RowProblem): string {
  if (isImportOnlyProblem(p.problem)) return t(IMPORT_PROBLEM_KEY[p.problem]);
  return problemText(p.problem);
}

type Step =
  | { kind: 'file' }
  | { kind: 'map'; sheet: ImportSheet; mapping: Mapping; decimal: MoneyLocale; missing: readonly ImportField[] }
  | { kind: 'preview'; sheet: ImportSheet; mapping: Mapping; decimal: MoneyLocale; plan: ImportPlan }
  | { kind: 'done'; imported: number; skipped: number };

export function ImportView({ kind, onDone }: { kind: ImportKind; onDone: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'file' });
  const [readError, setReadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ImportBatchId | null>(null);
  const contacts = useApp((s) => s.contacts);
  const items = useApp((s) => s.items);
  const batches = useMemo(() => (kind === 'contacts' ? batchesOf([...contacts.values()]) : batchesOf([...items.values()])), [kind, contacts, items]);
  const fileId = useId();
  const fields: readonly ImportField[] = kind === 'contacts' ? CONTACT_IMPORT_FIELDS : ITEM_IMPORT_FIELDS;
  const title = t(kind === 'contacts' ? 'import.title.contacts' : 'import.title.items');

  const onFile = async (file: File) => {
    const r = await readImportFile(new Uint8Array(await file.arrayBuffer()));
    if (!r.ok) {
      setReadError(t(READ_ERROR_KEY[r.error.kind]));
      return;
    }
    setReadError(null);
    setStep({ kind: 'map', sheet: r.value, mapping: suggestMapping(kind, r.value.header), decimal: 'de', missing: [] });
  };

  const back = () => setStep({ kind: 'file' });

  return (
    <div className="page wide">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('import.back')}>
          <Icon n="chevL" />
        </button>
        <h1>{title}</h1>
      </header>

      {step.kind === 'file' && (
        <section className="card" aria-label={t('import.fileTitle')}>
          <h2>{t('import.fileTitle')}</h2>
          <p>{t('import.fileHint')}</p>
          <label htmlFor={fileId} className="btn primary">
            {t('import.chooseFile')}
          </label>
          <input
            id={fileId}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = '';
            }}
          />
          {readError && (
            <p className="f-error" role="alert">
              {readError}
            </p>
          )}
        </section>
      )}

      {step.kind === 'map' && (
        <section className="card" aria-label={t('import.mapTitle')}>
          <h2>{t('import.mapTitle')}</h2>
          <p>{t('import.mapHint')}</p>
          {step.missing.length > 0 && (
            <p className="f-error" role="alert">
              {t('import.mapRequired', { fields: step.missing.map((f) => t(FIELD_KEY[f])).join(', ') })}
            </p>
          )}
          {fields.map((field) => {
            const index = step.mapping[field];
            return (
              <SelectField
                key={field}
                label={t(FIELD_KEY[field])}
                value={index === undefined ? '' : String(index)}
                options={[{ value: '', label: t('import.noColumn') }, ...step.sheet.header.map((h, i) => ({ value: String(i), label: `${i + 1}: ${h || '–'}` }))]}
                onChange={(v) => {
                  const next: Mapping = { ...step.mapping };
                  if (v === '') delete next[field];
                  else next[field] = Number(v);
                  setStep({ ...step, mapping: next, missing: [] });
                }}
              />
            );
          })}
          {kind === 'items' && (
            <SelectField<MoneyLocale>
              label={t('import.decimal')}
              value={step.decimal}
              options={[
                { value: 'de', label: t('import.decimalDe') },
                { value: 'en', label: t('import.decimalEn') },
              ]}
              onChange={(decimal) => setStep({ ...step, decimal })}
            />
          )}
          <div className="card-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                const missing = REQUIRED[kind].filter((f) => step.mapping[f] === undefined);
                if (missing.length > 0) {
                  setStep({ ...step, missing });
                  return;
                }
                setStep({ kind: 'preview', sheet: step.sheet, mapping: step.mapping, decimal: step.decimal, plan: planImport(kind, step.sheet, step.mapping, step.decimal) });
              }}
            >
              {t('import.previewButton')}
            </button>
            <button type="button" className="btn" onClick={back}>
              {t('common.back')}
            </button>
          </div>
        </section>
      )}

      {step.kind === 'preview' && <Preview step={step} onBack={() => setStep({ kind: 'map', sheet: step.sheet, mapping: step.mapping, decimal: step.decimal, missing: [] })} onDone={(imported, skipped) => setStep({ kind: 'done', imported, skipped })} />}

      {step.kind === 'done' && (
        <section className="card" aria-label={t('import.done', { n: step.imported })}>
          {step.imported > 0 ? <p role="status">{t('import.done', { n: step.imported })}</p> : <p role="status">{t('import.nothing')}</p>}
          {step.skipped > 0 && <p>{t('import.doneSkipped', { n: step.skipped })}</p>}
          <div className="card-actions">
            <button type="button" className="btn primary" onClick={onDone}>
              {t('import.back')}
            </button>
            <button type="button" className="btn" onClick={back}>
              {t('import.restart')}
            </button>
          </div>
        </section>
      )}

      <section className="card" aria-label={t('import.batchesTitle')}>
        <h2>{t('import.batchesTitle')}</h2>
        {batches.length === 0 ? (
          <p>{t('import.batchesNone')}</p>
        ) : (
          <ul className="plain-list">
            {batches.map((b) => (
              <li key={b.id}>
                <span>{t('import.batchLine', { date: formatDate(b.createdAt.slice(0, 10)), n: b.count })}</span>{' '}
                {confirming === b.id ? (
                  <span className="confirm" role="group" aria-label={t('import.undoConfirm')}>
                    <span>{t('import.undoConfirm')}</span>
                    <button
                      type="button"
                      className="btn danger"
                      autoFocus
                      onClick={() => {
                        const n = undoImport(kind, b.id);
                        setConfirming(null);
                        showToast(t('import.undone', { n }));
                      }}
                    >
                      {t('import.undoNow')}
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirming(null)}>
                      {t('common.cancel')}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn ghost danger-text" onClick={() => setConfirming(b.id)}>
                    {t('import.undo')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Preview({ step, onBack, onDone }: { step: Extract<Step, { kind: 'preview' }>; onBack: () => void; onDone: (imported: number, skipped: number) => void }) {
  const plan = step.plan;
  const rows: readonly PlannedRow<unknown>[] = plan.rows;
  const ok = rows.filter((r) => r.outcome.ok).length;
  return (
    <section className="card" aria-label={t('import.preview')}>
      <h2>{t('import.preview')}</h2>
      <p role="status">{t('import.summary', { ok, bad: rows.length - ok })}</p>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t('import.colLine')}</th>
            <th scope="col">{t('import.colName')}</th>
            <th scope="col">{t('import.colResult')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.line}>
              <td>{r.line}</td>
              <td>{r.name}</td>
              <td>{r.outcome.ok ? t('import.fine') : r.outcome.error.map(problemWords).join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card-actions">
        <button
          type="button"
          className="btn primary"
          disabled={ok === 0}
          onClick={() => {
            const r = runImport(plan);
            showToast(r.imported > 0 ? t('import.done', { n: r.imported }) : t('import.nothing'));
            onDone(r.imported, r.skipped);
          }}
        >
          {t('import.runButton')}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          {t('common.back')}
        </button>
      </div>
    </section>
  );
}

