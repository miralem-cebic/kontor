// The accounts a company is paid to: bank accounts with an IBAN, and PayPal. One of them is the default for new
// invoices; an invoice shows the account chosen for it. The account form edits a draft of plain strings;
// `readAccount` checks it. IDs, the default and soft deletes belong to the file format (data/types.ts).

import type { Result } from '../data/result';
import { Checker, type FieldError } from './check';
import { formatIban } from './iban';

export type AccountKind = 'bank' | 'paypal';

/** A bank account in the SEPA area */
export interface BankDetails {
  kind: 'bank';
  /** Name for the lists in kontor, for example "Geschäftskonto"; empty when not given */
  name: string;
  holder: string;
  /** Normalized: capitals, no spaces */
  iban: string;
  /** Empty when not given (optional within SEPA) */
  bic: string;
}

/** A PayPal account, known by the email address customers pay to */
export interface PaypalDetails {
  kind: 'paypal';
  name: string;
  email: string;
}

export type AccountDetails = BankDetails | PaypalDetails;

export const ACCOUNT_LIMITS = {
  name: 60,
  holder: 120,
} as const;

/** Accounts per company, removed ones included (they stay in the file). Far above any real need; a bound for file content. */
export const MAX_ACCOUNTS = 50;

/** What makes an account unique among the active ones: its IBAN, or its PayPal address (ignoring case) */
export const accountKey = (a: AccountDetails): string => (a.kind === 'bank' ? a.iban : a.email.toLowerCase());

/* ---------- Draft ---------- */

/** Both kinds in one draft, so that switching the kind of a new account keeps what was typed */
export interface AccountDraft {
  kind: AccountKind;
  name: string;
  holder: string;
  iban: string;
  bic: string;
  email: string;
}

export type AccountField = keyof AccountDraft;
export type AccountFieldError = FieldError<AccountField>;

/** A new account; the holder is usually the owner of the company */
export const emptyAccountDraft = (holder = ''): AccountDraft => ({ kind: 'bank', name: '', holder, iban: '', bic: '', email: '' });

/** The IBAN is shown in groups of four, as on paper; reading the draft removes the spaces again */
export function draftFromAccount(a: AccountDetails): AccountDraft {
  switch (a.kind) {
    case 'bank':
      return { kind: 'bank', name: a.name, holder: a.holder, iban: formatIban(a.iban), bic: a.bic, email: '' };
    case 'paypal':
      return { kind: 'paypal', name: a.name, holder: '', iban: '', bic: '', email: a.email };
  }
}

/* ---------- Checks ---------- */

/**
 * Checks an account draft. `isTaken` tells whether another active account already has this key (`accountKey`):
 * the same IBAN or PayPal address twice is a mistake.
 */
export function readAccount(d: AccountDraft, isTaken: (key: string) => boolean): Result<AccountDetails, AccountFieldError[]> {
  const c = new Checker<AccountField>();
  const name = c.optionalText('name', d.name, ACCOUNT_LIMITS.name);
  switch (d.kind) {
    case 'bank': {
      const account: BankDetails = { kind: 'bank', name, holder: c.text('holder', d.holder, ACCOUNT_LIMITS.holder), iban: c.iban('iban', d.iban), bic: c.bic('bic', d.bic) };
      if (c.passed('iban') && isTaken(accountKey(account))) c.add('iban', 'accountTaken');
      return c.done(() => account);
    }
    case 'paypal': {
      const account: PaypalDetails = { kind: 'paypal', name, email: c.email('email', d.email, true) };
      if (c.passed('email') && isTaken(accountKey(account))) c.add('email', 'accountTaken');
      return c.done(() => account);
    }
  }
}
