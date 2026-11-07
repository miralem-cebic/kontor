import { useEffect, useMemo, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { accountInputs } from '../../app/customerAccount';
import type { ContactId } from '../../data/ids';
import { customerAccount, type AccountEntryKind } from '../../domain/customerAccount';
import { isoDateOf } from '../../domain/dates';
import { formatCents } from '../../domain/money';
import { currentLang, t, type MessageKey } from '../../i18n';
import { useApp } from '../../store/appStore';
import { formatDate } from '../documents/common';
import { Fact } from '../documents/IssuedParts';

// The account of a customer: the invoices and cancellations issued to them and the payments received, in date order with
// the balance after each entry (domain/customerAccount.ts). Only issued documents count: drafts and quotes are not in it.

const KIND_KEY: Record<AccountEntryKind, MessageKey> = {
  invoice: 'customerAccount.kindInvoice',
  cancellation: 'customerAccount.kindCancellation',
  payment: 'customerAccount.kindPayment',
};

interface Props {
  contactId: ContactId;
  onDone: () => void;
}

export function CustomerAccountView({ contactId, onDone }: Props) {
  const contact = useApp((s) => s.contacts.get(contactId));
  const documents = useApp((s) => s.documents);
  const payments = useApp((s) => s.payments);
  const payouts = useApp((s) => s.payouts);
  const lang = currentLang();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const today = isoDateOf(new Date());
  const account = useMemo(() => {
    const inputs = accountInputs(contactId, documents, payments, payouts);
    return customerAccount(inputs.invoices, inputs.payments, today, inputs.payouts);
  }, [contactId, documents, payments, payouts, today]);

  if (!contact) return null;
  const balanceKey: MessageKey = account.balance > 0 ? 'customerAccount.owed' : account.balance < 0 ? 'customerAccount.credit' : 'customerAccount.settled';

  return (
    <div className="page wide">
      <header className="top">
        <button type="button" className="icon-btn" onClick={onDone} aria-label={t('customerAccount.backToContact')}>
          <Icon n="chevL" />
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {contact.name}
        </h1>
        <span className="sp" />
        <span className="badge">{t('customerAccount.title')}</span>
      </header>

      <section className="card" aria-labelledby="account-summary">
        <h2 id="account-summary">{t('customerAccount.title')}</h2>
        <dl className="facts">
          <Fact label={t('customerAccount.invoiced')}>{formatCents(account.invoiced, lang)}</Fact>
          <Fact label={t('customerAccount.paid')}>{formatCents(account.paid, lang)}</Fact>
          <Fact label={t('customerAccount.balance')}>
            {formatCents(account.balance, lang)} <span className="badge">{t(balanceKey)}</span>
          </Fact>
          <Fact label={t('customerAccount.overdue')}>{formatCents(account.overdue, lang)}</Fact>
        </dl>
        <p className="note" role="note">
          {t('customerAccount.note')}
        </p>
      </section>

      {account.entries.length === 0 && account.payouts.length === 0 ? (
        <p className="empty">{t('customerAccount.empty')}</p>
      ) : (
        <>
          {account.entries.length > 0 && (
            <table className="table">
              <caption className="visually-hidden">{t('customerAccount.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('customerAccount.colDate')}</th>
                  <th scope="col">{t('customerAccount.colKind')}</th>
                  <th scope="col">{t('customerAccount.colNumber')}</th>
                  <th scope="col">{t('customerAccount.colText')}</th>
                  <th scope="col" className="num">
                    {t('customerAccount.colAmount')}
                  </th>
                  <th scope="col" className="num">
                    {t('customerAccount.colBalance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {account.entries.map((e) => (
                  <tr key={`${e.kind}-${e.id}`}>
                    <td>{formatDate(e.date)}</td>
                    <td>{t(KIND_KEY[e.kind])}</td>
                    <td>{e.number}</td>
                    <td>{e.text || <span className="muted">–</span>}</td>
                    <td className="num">{formatCents(e.amount, lang)}</td>
                    <td className="num">{formatCents(e.balance, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {account.payouts.length > 0 && (
            <section className="card" aria-labelledby="account-payouts">
              <h2 id="account-payouts">{t('payouts.accountTitle')}</h2>
              <p className="note" role="note">
                {t('payouts.accountNote')}
              </p>
              <table className="table">
                <caption className="visually-hidden">{t('payouts.accountTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('payouts.colDate')}</th>
                    <th scope="col">{t('payouts.colPeriod')}</th>
                    <th scope="col" className="num">
                      {t('payouts.colAmount')}
                    </th>
                    <th scope="col" className="num">
                      {t('payouts.colIncome')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {account.payouts.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.date)}</td>
                      <td>{p.period || <span className="muted">–</span>}</td>
                      <td className="num">{formatCents(p.amount, lang)}</td>
                      <td className="num">{formatCents(p.income, lang)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>
                      {t('payouts.accountTotal')}
                    </th>
                    <td className="num">{formatCents(account.payoutsReceived, lang)}</td>
                    <td className="num">{formatCents(account.payoutsIncome, lang)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
