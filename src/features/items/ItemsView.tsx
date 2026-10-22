import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Row, SelectField, TextArea, TextField } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { byItemName, draftFromItem, emptyItemDraft, ITEM_LIMITS, itemMatches, readItem, type ItemDraft, type ItemField, type ItemFieldError } from '../../domain/item';
import { formatCents, formatRate } from '../../domain/money';
import { UNITS, type UnitCode } from '../../domain/units';
import { VAT_RATES } from '../../domain/vat';
import type { ItemId } from '../../data/ids';
import type { ItemFile } from '../../data/types';
import { currentLang, t } from '../../i18n';
import { fieldError, unitText } from '../../lib/labels';
import { addItem, deleteItem, showToast, updateItem, useApp } from '../../store/appStore';

// The catalogue: a searchable list of items and services, and a form for a new or an existing item.
// The form edits a draft; only "Save" puts the checked item into the store (and the persister writes it).

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: ItemId };

const useSmallBusiness = () => useApp((s) => s.company?.tax.vat.kind === 'smallBusiness');

export function ItemsView() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const back = () => setMode({ kind: 'list' });
  switch (mode.kind) {
    case 'list':
      return <ItemList onNew={() => setMode({ kind: 'new' })} onOpen={(id) => setMode({ kind: 'edit', id })} />;
    case 'new':
      return <ItemEditor item={null} onDone={back} />;
    case 'edit':
      return <EditExisting id={mode.id} onDone={back} />;
  }
}

function EditExisting({ id, onDone }: { id: ItemId; onDone: () => void }) {
  const item = useApp((s) => s.items.get(id));
  // deleted or gone (for example merged away from another device): back to the list
  useEffect(() => {
    if (!item || item.deletedAt) onDone();
  }, [item, onDone]);
  return item && !item.deletedAt ? <ItemEditor key={id} item={item} onDone={onDone} /> : null;
}

/* ---------- List ---------- */

function ItemList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: ItemId) => void }) {
  const all = useApp((s) => s.items);
  const smallBusiness = useSmallBusiness();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const active = useMemo(() => [...all.values()].filter((i) => !i.deletedAt).sort(byItemName), [all]);
  const shown = active.filter((i) => itemMatches(i, query));

  return (
    <div className="page wide">
      <header className="top">
        <h1>{t('items.title')}</h1>
        <span className="sp" />
        <button type="button" className="btn primary" onClick={onNew}>
          <Icon n="plus" s={14} />
          {t('items.new')}
        </button>
      </header>
      {active.length === 0 ? (
        <p className="empty">{t('items.empty')}</p>
      ) : (
        <>
          <div className="list-tools">
            <label className="visually-hidden" htmlFor={searchId}>
              {t('items.search')}
            </label>
            <input id={searchId} className="search-in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('items.searchPlaceholder')} />
          </div>
          {shown.length === 0 ? (
            <p className="empty" role="status">
              {t('items.noMatch')}
            </p>
          ) : (
            <table className="table">
              <caption className="visually-hidden">{t('items.count', { n: shown.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('items.colNumber')}</th>
                  <th scope="col">{t('items.colName')}</th>
                  <th scope="col">{t('items.colUnit')}</th>
                  <th scope="col" className="num">
                    {smallBusiness ? t('items.colPrice') : t('items.colNetPrice')}
                  </th>
                  {!smallBusiness && (
                    <th scope="col" className="num">
                      {t('items.colVat')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <ItemRow key={i.id} item={i} showVat={!smallBusiness} onOpen={onOpen} />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function ItemRow({ item: i, showVat, onOpen }: { item: ItemFile; showVat: boolean; onOpen: (id: ItemId) => void }) {
  const lang = currentLang();
  const firstLine = i.description.split('\n', 1)[0] ?? '';
  return (
    <tr>
      <td>{i.number}</td>
      <td>
        <button type="button" className="row-link" onClick={() => onOpen(i.id)}>
          <span>
            {i.name}
            {firstLine && <small>{firstLine}</small>}
          </span>
        </button>
      </td>
      <td>{unitText(i.unit)}</td>
      <td className="num">{formatCents(i.netPrice, lang)}</td>
      {showVat && <td className="num">{formatRate(i.vatRate, lang)}</td>}
    </tr>
  );
}

/* ---------- Form ---------- */

function ItemEditor({ item, onDone }: { item: ItemFile | null; onDone: () => void }) {
  const items = useApp((s) => s.items);
  const smallBusiness = useSmallBusiness();
  const lang = currentLang();
  const [draft, setDraft] = useState<ItemDraft>(() => (item ? draftFromItem(item, lang) : emptyItemDraft()));
  const [errors, setErrors] = useState<readonly ItemFieldError[]>([]);
  const [checked, setChecked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  /** Another active item with the same number (ignoring case and surrounding spaces) */
  const isNumberTaken = (n: string) => [...items.values()].some((i) => i.id !== item?.id && !i.deletedAt && i.number.trim().toLowerCase() === n.toLowerCase());

  const set = (patch: Partial<ItemDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (checked) {
      const r = readItem(next, lang, isNumberTaken);
      setErrors(r.ok ? [] : r.error);
    }
  };
  const e = (f: ItemField) => fieldError(errors, f);

  const save = () => {
    const r = readItem(draft, lang, isNumberTaken);
    if (!r.ok) {
      setChecked(true);
      setErrors(r.error);
      requestAnimationFrame(() => {
        const el = document.querySelector('.item-form [aria-invalid="true"]');
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus();
      });
      return;
    }
    if (item) updateItem(item.id, r.value);
    else addItem(r.value);
    showToast(t('items.saved', { name: r.value.name }));
    onDone();
  };

  const remove = () => {
    if (!item) return;
    deleteItem(item.id);
    showToast(t('items.deleted', { name: item.name }));
    onDone();
  };

  const unitOptions = UNITS.map((u) => ({ value: u, label: unitText(u) }));
  const rateOptions = VAT_RATES.map((r) => ({ value: String(r), label: formatRate(r, lang) }));

  return (
    <div className="page">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('items.backToList')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {item ? item.name : t('items.new')}
        </h1>
      </header>
      <form
        className="form item-form"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
      >
        <section className="card" aria-label={item ? item.name : t('items.new')}>
          <TextField className="w-num" label={t('items.number')} hint={t('items.numberHint')} value={draft.number} onChange={(number) => set({ number })} error={e('number')} maxLength={ITEM_LIMITS.number} />
          <TextField label={t('items.name')} hint={t('items.nameHint')} value={draft.name} onChange={(name) => set({ name })} error={e('name')} required maxLength={ITEM_LIMITS.name} />
          <TextArea label={t('items.description')} hint={t('items.descriptionHint')} value={draft.description} onChange={(description) => set({ description })} error={e('description')} maxLength={ITEM_LIMITS.description} />
          <Row>
            <SelectField<UnitCode> className="w-unit" label={t('items.unit')} value={draft.unit} options={unitOptions} onChange={(unit) => set({ unit })} />
            <TextField
              label={smallBusiness ? t('items.price') : t('items.netPrice')}
              hint={smallBusiness ? t('items.priceHint') : t('items.netPriceHint')}
              value={draft.netPrice}
              onChange={(netPrice) => set({ netPrice })}
              error={e('netPrice')}
              required
              inputMode="decimal"
              maxLength={20}
            />
            <SelectField
              className="w-rate"
              label={t('items.vatRate')}
              hint={smallBusiness ? t('items.vatRateHint') : undefined}
              value={String(draft.vatRate)}
              options={rateOptions}
              onChange={(v) => {
                const vatRate = VAT_RATES.find((r) => String(r) === v);
                if (vatRate !== undefined) set({ vatRate });
              }}
            />
          </Row>
        </section>

        <div className="card-actions">
          <button type="submit" className="btn primary">
            {t('items.save')}
          </button>
          <button type="button" className="btn" onClick={onDone}>
            {t('common.cancel')}
          </button>
          <span className="sp" />
          {item &&
            (confirmDelete ? (
              <div className="confirm" role="group" aria-label={t('items.deleteConfirm')}>
                <span>{t('items.deleteConfirm')}</span>
                <button type="button" className="btn danger" onClick={remove} autoFocus>
                  {t('items.delete')}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>
                {t('items.delete')}
              </button>
            ))}
        </div>
      </form>
    </div>
  );
}
