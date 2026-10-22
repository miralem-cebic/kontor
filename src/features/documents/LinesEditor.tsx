import { useId, useMemo, useState } from 'react';
import { SelectField, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { DOCUMENT_LIMITS, draftLineNet, emptyLineDraft, lineDraftFromItem, type LineDraft, type LineFieldPath, linePath } from '../../domain/document';
import { byItemName, ITEM_LIMITS, itemMatches } from '../../domain/item';
import { formatCents, formatRate, type TaxTotals } from '../../domain/money';
import { UNITS, type UnitCode } from '../../domain/units';
import { VAT_RATES } from '../../domain/vat';
import type { ItemFile } from '../../data/types';
import { currentLang, t } from '../../i18n';
import { unitText } from '../../lib/labels';
import { useApp } from '../../store/appStore';

// The lines of a quote (later also of an invoice): taken from the catalogue or typed freely, moved and removed.
// The editor works on drafts; the document form checks them on "Save".

let lineSeq = 0;
/** A key for a new line in the editor */
export const newLineKey = (): string => `line-${++lineSeq}`;

/** Moves the focus to a field of a line once it has rendered */
const focusLine = (key: string, field: 'name' | 'quantity') =>
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line="${key}"] .l-${field} input`)?.focus());

interface Props {
  lines: readonly LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  /** The error text of a field, if any */
  errorFor: (path: LineFieldPath | 'lines') => string | undefined;
  smallBusiness: boolean;
}

export function LinesEditor({ lines, onChange, errorFor, smallBusiness }: Props) {
  const [picking, setPicking] = useState(false);
  const full = lines.length >= DOCUMENT_LIMITS.lines;

  const change = (index: number, patch: Partial<LineDraft>) => onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const add = (line: LineDraft, focus: 'name' | 'quantity') => {
    onChange([...lines, line]);
    focusLine(line.key, focus);
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...lines];
    const [line] = next.splice(index, 1);
    if (!line) return;
    next.splice(index + by, 0, line);
    onChange(next);
  };

  return (
    <div className="lines">
      {lines.length === 0 ? (
        <p className="empty">{t('lines.empty')}</p>
      ) : (
        lines.map((line, i) => (
          <LineFields
            key={line.key}
            line={line}
            index={i}
            last={i === lines.length - 1}
            smallBusiness={smallBusiness}
            errorFor={errorFor}
            onChange={(patch) => change(i, patch)}
            onMove={(by) => move(i, by)}
            onRemove={() => onChange(lines.filter((_, j) => j !== i))}
          />
        ))
      )}
      {errorFor('lines') && (
        <p className="f-error" role="alert">
          {errorFor('lines')}
        </p>
      )}
      {picking ? (
        <CataloguePicker
          onPick={(item) => {
            setPicking(false);
            add(lineDraftFromItem(newLineKey(), item, currentLang()), 'quantity');
          }}
          onClose={() => setPicking(false)}
        />
      ) : (
        <div className="card-actions">
          <button type="button" className="btn" onClick={() => setPicking(true)} disabled={full}>
            <Icon n="item" s={14} />
            {t('lines.addFromCatalogue')}
          </button>
          <button type="button" className="btn" onClick={() => add(emptyLineDraft(newLineKey()), 'name')} disabled={full}>
            <Icon n="plus" s={14} />
            {t('lines.addFree')}
          </button>
        </div>
      )}
      {full && <p className="f-hint">{t('lines.limit', { max: DOCUMENT_LIMITS.lines })}</p>}
    </div>
  );
}

interface LineProps {
  line: LineDraft;
  index: number;
  last: boolean;
  smallBusiness: boolean;
  errorFor: Props['errorFor'];
  onChange: (patch: Partial<LineDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

function LineFields({ line, index, last, smallBusiness, errorFor, onChange, onMove, onRemove }: LineProps) {
  const lang = currentLang();
  const n = index + 1;
  const e = (field: Parameters<typeof linePath>[1]) => errorFor(linePath(index, field));
  const net = draftLineNet(line, lang);
  const legendId = useId();
  const totalId = useId();
  return (
    <fieldset className="line" data-line={line.key} aria-labelledby={legendId}>
      <legend id={legendId} className="visually-hidden">
        {t('lines.line', { n })}
      </legend>
      <div className="line-main">
        <span className="line-no" aria-hidden="true">
          {n}
        </span>
        <TextField className="l-name" label={t('lines.name')} value={line.name} onChange={(name) => onChange({ name })} error={e('name')} required maxLength={ITEM_LIMITS.name} />
        <TextField className="l-quantity" label={t('lines.quantity')} value={line.quantity} onChange={(quantity) => onChange({ quantity })} error={e('quantity')} required inputMode="decimal" maxLength={15} />
        <SelectField<UnitCode> className="l-unit" label={t('lines.unit')} value={line.unit} options={UNITS.map((u) => ({ value: u, label: unitText(u) }))} onChange={(unit) => onChange({ unit })} />
        <TextField
          className="l-price"
          label={smallBusiness ? t('lines.unitPrice') : t('lines.unitPriceNet')}
          value={line.unitPrice}
          onChange={(unitPrice) => onChange({ unitPrice })}
          error={e('unitPrice')}
          required
          inputMode="decimal"
          maxLength={20}
        />
        {!smallBusiness && (
          <SelectField
            className="l-rate"
            label={t('lines.vatRate')}
            value={String(line.vatRate)}
            options={VAT_RATES.map((r) => ({ value: String(r), label: formatRate(r, lang) }))}
            onChange={(v) => {
              const vatRate = VAT_RATES.find((r) => String(r) === v);
              if (vatRate !== undefined) onChange({ vatRate });
            }}
          />
        )}
        <div className="field l-total">
          <span className="f-label" id={totalId}>
            {t('lines.total')}
          </span>
          <output aria-labelledby={totalId}>{net === null ? '–' : formatCents(net, lang)}</output>
        </div>
      </div>
      <div className="line-sub">
        <TextArea className="l-description" label={t('lines.description')} value={line.description} onChange={(description) => onChange({ description })} error={e('description')} maxLength={ITEM_LIMITS.description} rows={2} />
        <div className="l-actions">
          <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t('lines.moveUp', { n })}>
            <Icon n="chevU" s={14} />
          </button>
          <button type="button" className="icon-btn" onClick={() => onMove(1)} disabled={last} aria-label={t('lines.moveDown', { n })}>
            <Icon n="chevD" s={14} />
          </button>
          <button type="button" className="icon-btn" onClick={onRemove} aria-label={t('lines.remove', { n })}>
            <Icon n="x" s={14} />
          </button>
        </div>
      </div>
    </fieldset>
  );
}

/** Search the catalogue and take an item over as a new line */
function CataloguePicker({ onPick, onClose }: { onPick: (item: ItemFile) => void; onClose: () => void }) {
  const all = useApp((s) => s.items);
  const [query, setQuery] = useState('');
  const lang = currentLang();
  const searchId = useId();
  const active = useMemo(() => [...all.values()].filter((i) => !i.deletedAt).sort(byItemName), [all]);
  const shown = active.filter((i) => itemMatches(i, query));
  return (
    <section className="picker" aria-label={t('lines.catalogue')}>
      {active.length === 0 ? (
        <p className="empty">{t('lines.catalogueEmpty')}</p>
      ) : (
        <>
          <label className="visually-hidden" htmlFor={searchId}>
            {t('lines.catalogueSearch')}
          </label>
          <input id={searchId} className="search-in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('lines.catalogueSearch')} autoFocus />
          {shown.length === 0 ? (
            <p className="empty" role="status">
              {t('lines.catalogueNoMatch')}
            </p>
          ) : (
            <ul className="picker-list">
              {shown.map((item) => (
                <li key={item.id}>
                  <button type="button" className="row-link" onClick={() => onPick(item)}>
                    <span>
                      {item.name}
                      <small>
                        {[item.number, t('lines.perUnit', { price: formatCents(item.netPrice, lang), unit: unitText(item.unit) })].filter(Boolean).join(' · ')}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="card-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('lines.catalogueClose')}
        </button>
      </div>
    </section>
  );
}

/** Net, VAT per rate and gross; for a small business the total and the note on § 19 UStG */
export function Totals({ totals, smallBusiness }: { totals: TaxTotals; smallBusiness: boolean }) {
  const lang = currentLang();
  return (
    <div className="totals-box">
      <dl className="totals" aria-label={t('totals.label')}>
        {!smallBusiness && (
          <>
            <dt>{t('totals.net')}</dt>
            <dd>{formatCents(totals.net, lang)}</dd>
            {totals.byRate.map((r) => (
              <Pair key={r.rate} label={t('totals.vat', { rate: formatRate(r.rate, lang) })} value={formatCents(r.tax, lang)} />
            ))}
          </>
        )}
        <dt className="grand">{t('totals.gross')}</dt>
        <dd className="grand">{formatCents(totals.gross, lang)}</dd>
      </dl>
      {smallBusiness && <p className="f-hint">{t('totals.smallBusiness')}</p>}
    </div>
  );
}

const Pair = ({ label, value }: { label: string; value: string }) => (
  <>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </>
);
