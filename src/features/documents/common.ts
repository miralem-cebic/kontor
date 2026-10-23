import { byContactName } from '../../domain/contact';
import { toLocalDate } from '../../domain/dates';
import type { ContactFile } from '../../data/types';
import { fmt, t } from '../../i18n';
import { useApp } from '../../store/appStore';

// What the forms of quotes and invoices share besides the lines.

export const useSmallBusiness = () => useApp((s) => s.company?.tax.vat.kind === 'smallBusiness');

export const formatDate = (iso: string) => fmt(toLocalDate(iso), 'P');

/** The active customers, and the document's customer even when it was deleted or is no customer any more */
export function customerOptions(contacts: ReadonlyMap<string, ContactFile>, current: string): { value: string; label: string }[] {
  const list = [...contacts.values()].filter((c) => (c.roles.customer && !c.deletedAt) || c.id === current).sort(byContactName);
  return list.map((c) => ({ value: c.id, label: c.deletedAt ? t('documents.customerDeleted', { name: c.name }) : c.name }));
}

/** Moves the focus to the first field of the form that has an error, once it has rendered */
export function focusFirstError(form: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.${form} [aria-invalid="true"]`);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus();
  });
}
