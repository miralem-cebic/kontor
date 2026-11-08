import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cents, sum, type Cents } from '../../src/domain/money';
import {
  lastCompletedPeriod,
  periodEnd,
  periodOfDate,
  periodStart,
  ustva,
  ustvaDueDate,
  wholeEuros,
  type UstvaExpense,
  type UstvaInput,
  type UstvaInvoice,
  type UstvaPayment,
  type UstvaPeriod,
  type UstvaResult,
} from '../../src/domain/ustva';
import { basisPoints } from '../../src/domain/money';
import { fcParams } from './fixtures';

const R19 = basisPoints(1900);
const R7 = basisPoints(700);
const Q3_2026: UstvaPeriod = { year: 2026, kind: 'quarter', index: 3 };
const OCT_2026: UstvaPeriod = { year: 2026, kind: 'month', index: 10 };

/** An issued invoice of 1,000.00 € net at 19 % (190.00 € VAT, 1,190.00 € gross), serviced and dated in October */
const invoice = (over: Partial<UstvaInvoice> = {}): UstvaInvoice => ({
  id: 'r1',
  date: '2026-10-15',
  serviceEnd: '2026-10-15',
  treatment: 'standard',
  customerCountry: 'DE',
  isCancellation: false,
  smallBusiness: false,
  lines: [{ rate: R19, net: cents(100_000), tax: cents(19_000) }],
  ...over,
});

const expense = (over: Partial<UstvaExpense> = {}): UstvaExpense => ({ date: '2026-10-20', taxTreatment: 'domestic', gross: cents(11_900), vat: cents(1_900), ...over });

const run = (over: Partial<UstvaInput> = {}): UstvaResult =>
  ustva({ period: OCT_2026, method: 'accrual', permanentExtension: false, invoices: [], payments: [], expenses: [], ...over });

const field = (r: UstvaResult, id: string) => r.fields.find((f) => f.id === id);

describe('periods', () => {
  it('start and end of a month and of a quarter', () => {
    expect([periodStart(OCT_2026), periodEnd(OCT_2026)]).toEqual(['2026-10-01', '2026-10-31']);
    expect([periodStart(Q3_2026), periodEnd(Q3_2026)]).toEqual(['2026-07-01', '2026-09-30']);
    const feb = { year: 2028, kind: 'month', index: 2 } as const;
    expect(periodEnd(feb)).toBe('2028-02-29');
    expect(periodEnd({ year: 2026, kind: 'month', index: 2 })).toBe('2026-02-28');
    expect(periodEnd({ year: 2026, kind: 'quarter', index: 4 })).toBe('2026-12-31');
  });

  it('the period of a date, and the last period that is over', () => {
    expect(periodOfDate('2026-08-31', 'quarter')).toEqual(Q3_2026);
    expect(periodOfDate('2026-10-01', 'month')).toEqual(OCT_2026);
    expect(lastCompletedPeriod('2026-11-07', 'month')).toEqual(OCT_2026);
    expect(lastCompletedPeriod('2026-11-07', 'quarter')).toEqual(Q3_2026);
    // in the first period of a year the last one is in the year before
    expect(lastCompletedPeriod('2027-01-05', 'month')).toEqual({ year: 2026, kind: 'month', index: 12 });
    expect(lastCompletedPeriod('2027-02-01', 'quarter')).toEqual({ year: 2026, kind: 'quarter', index: 4 });
  });

  it('property: every date lies inside its own period, and in no other', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2026, max: 2030 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }), fc.constantFrom('month', 'quarter' as const), (y, m, d, kind) => {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const p = periodOfDate(iso, kind as 'month' | 'quarter');
        return periodStart(p) <= iso && iso <= periodEnd(p);
      }),
      fcParams,
    );
  });
});

describe('due date: the 10th after the period (§ 18 Abs. 1 UStG), one month later with permanent extension (§ 46 UStDV)', () => {
  it('moves a Saturday or a Sunday to the Monday (§ 108 Abs. 3 AO)', () => {
    // 10 October 2026 is a Saturday, 10 January 2027 a Sunday
    expect(ustvaDueDate(Q3_2026, false)).toBe('2026-10-12');
    expect(ustvaDueDate({ year: 2026, kind: 'month', index: 12 }, false)).toBe('2027-01-11');
  });

  it('is the 10th of the next month, or of the month after with the extension', () => {
    expect(ustvaDueDate(OCT_2026, false)).toBe('2026-11-10');
    expect(ustvaDueDate(OCT_2026, true)).toBe('2026-12-10');
    expect(ustvaDueDate(Q3_2026, true)).toBe('2026-11-10');
    expect(ustvaDueDate({ year: 2026, kind: 'quarter', index: 4 }, true)).toBe('2027-02-10');
  });
});

describe('whole euros: the bases of the form', () => {
  it('drops the cents, towards zero', () => {
    expect(wholeEuros(cents(123_456))).toBe(1234);
    expect(wholeEuros(cents(99))).toBe(0);
    expect(wholeEuros(cents(-123_456))).toBe(-1234);
    expect(wholeEuros(cents(-99))).toBe(0);
  });
});

describe('accrual basis (Sollversteuerung): by the date of the service', () => {
  it('worked example: 19 % and 7 % supplies and input tax give the remaining prepayment', () => {
    const r = run({
      invoices: [
        invoice(),
        invoice({ id: 'r2', date: '2026-10-20', serviceEnd: '2026-10-20', lines: [{ rate: R7, net: cents(20_000), tax: cents(1_400) }] }),
      ],
      expenses: [expense()],
    });
    expect(field(r, 'taxable19')).toMatchObject({ kz: '81', base: 100_000, tax: 19_000 });
    expect(field(r, 'taxable7')).toMatchObject({ kz: '86', base: 20_000, tax: 1_400 });
    expect(field(r, 'inputTax')).toMatchObject({ kz: '66', tax: 1_900 });
    // 190.00 + 14.00 - 19.00
    expect(field(r, 'remainingPrepayment')).toMatchObject({ kz: '83', tax: 18_500 });
  });

  it('counts an invoice in the period of its service, not of its date', () => {
    const early = invoice({ date: '2026-11-03', serviceEnd: '2026-10-28' });
    expect(field(run({ invoices: [early] }), 'taxable19')?.base).toBe(100_000);
    expect(field(run({ invoices: [early], period: { year: 2026, kind: 'month', index: 11 } }), 'taxable19')?.base).toBe(0);
  });

  it('a service over a period counts when it ends', () => {
    const long = invoice({ date: '2026-10-05', serviceEnd: '2026-11-30' });
    expect(field(run({ invoices: [long] }), 'taxable19')?.base).toBe(0);
    expect(field(run({ invoices: [long], period: { year: 2026, kind: 'month', index: 11 } }), 'taxable19')?.base).toBe(100_000);
  });

  it('a cancellation counts negative on its own date and cancels the original (§ 17 UStG)', () => {
    const cancel = invoice({
      id: 's1',
      date: '2026-11-05',
      serviceEnd: '2026-10-15',
      isCancellation: true,
      lines: [{ rate: R19, net: cents(-100_000), tax: cents(-19_000) }],
    });
    const november = { year: 2026, kind: 'month', index: 11 } as const;
    expect(field(run({ invoices: [invoice(), cancel], period: november }), 'taxable19')).toMatchObject({ base: -100_000, tax: -19_000 });
    expect(field(run({ invoices: [invoice(), cancel]}), 'taxable19')).toMatchObject({ base: 100_000, tax: 19_000 });
    const q4 = { year: 2026, kind: 'quarter', index: 4 } as const;
    expect(field(run({ invoices: [invoice(), cancel], period: q4 }), 'taxable19')).toMatchObject({ base: 0, tax: 0 });
  });

  it('an invoice issued by a small business counts nowhere', () => {
    expect(field(run({ invoices: [invoice({ smallBusiness: true })] }), 'taxable19')?.base).toBe(0);
  });
});

describe('cash basis (Istversteuerung): by the date of the payment, in proportion', () => {
  const pay = (amount: number, date: string, id = `p${date}${amount}`): UstvaPayment => ({ id, invoiceId: 'r1', date, amount: cents(amount) });

  it('an invoice with no payment in the period counts nothing, whatever its date', () => {
    const r = run({ method: 'cash', invoices: [invoice()], payments: [pay(119_000, '2026-11-02')] });
    expect(field(r, 'taxable19')).toMatchObject({ base: 0, tax: 0 });
  });

  it('a payment in full counts the whole invoice in the month the money came', () => {
    const r = run({ method: 'cash', invoices: [invoice({ date: '2026-08-01', serviceEnd: '2026-08-01' })], payments: [pay(119_000, '2026-10-02')] });
    expect(field(r, 'taxable19')).toMatchObject({ base: 100_000, tax: 19_000 });
  });

  it('a part payment counts its share of base and tax', () => {
    const r = run({ method: 'cash', invoices: [invoice()], payments: [pay(59_500, '2026-10-02'), pay(59_500, '2026-11-02')] });
    expect(field(r, 'taxable19')).toMatchObject({ base: 50_000, tax: 9_500 });
    const nov = run({ method: 'cash', period: { year: 2026, kind: 'month', index: 11 }, invoices: [invoice()], payments: [pay(59_500, '2026-10-02'), pay(59_500, '2026-11-02')] });
    expect(field(nov, 'taxable19')).toMatchObject({ base: 50_000, tax: 9_500 });
  });

  it('a payment on an invoice with 19 % and 7 % is split between the rates in proportion', () => {
    const mixed = invoice({
      lines: [
        { rate: R19, net: cents(100_000), tax: cents(19_000) },
        { rate: R7, net: cents(100_000), tax: cents(7_000) },
      ],
    });
    // gross 226,000; half of it
    const r = run({ method: 'cash', invoices: [mixed], payments: [pay(113_000, '2026-10-02')] });
    expect(field(r, 'taxable19')).toMatchObject({ base: 50_000, tax: 9_500 });
    expect(field(r, 'taxable7')).toMatchObject({ base: 50_000, tax: 3_500 });
  });

  it('a cancellation counts nothing: it takes no payment, and kontor records no refund', () => {
    const cancel = invoice({ id: 's1', isCancellation: true, lines: [{ rate: R19, net: cents(-100_000), tax: cents(-19_000) }] });
    const r = run({ method: 'cash', invoices: [invoice(), cancel], payments: [pay(119_000, '2026-10-02')] });
    expect(field(r, 'taxable19')).toMatchObject({ base: 100_000, tax: 19_000 });
  });

  it('property: payments in any periods add up to the invoice, base and tax exactly', () => {
    const lineArb = fc.record({ rate: fc.constantFrom(R19, R7), net: fc.integer({ min: 1, max: 5_000_000 }) });
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 2 }),
        fc.array(fc.tuple(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 12 })), { minLength: 1, maxLength: 6 }),
        (rawLines, parts) => {
          const byRate = new Map<number, number>();
          for (const l of rawLines) byRate.set(l.rate, (byRate.get(l.rate) ?? 0) + l.net);
          const lines = [...byRate].map(([rate, net]) => ({ rate: basisPoints(rate), net: cents(net), tax: cents(Math.round((net * rate) / 10_000)) }));
          const gross = sum(lines.flatMap((l) => [l.net, l.tax]));
          // split the gross amount by random weights into payments in random months
          const weightSum = parts.reduce((a, [w]) => a + w, 0);
          let left = gross as number;
          const payments: UstvaPayment[] = parts.map(([w, month], i) => {
            const amount = i === parts.length - 1 ? left : Math.floor((gross * w) / weightSum);
            left -= amount;
            return { id: `p${i}`, invoiceId: 'r1', date: `2026-${String(month).padStart(2, '0')}-10`, amount: cents(amount) };
          });
          const inv = invoice({ lines });
          let base19 = 0, tax19 = 0, base7 = 0, tax7 = 0;
          for (let m = 1; m <= 12; m++) {
            const r = run({ method: 'cash', period: { year: 2026, kind: 'month', index: m }, invoices: [inv], payments: payments.filter((p) => p.amount > 0) });
            base19 += field(r, 'taxable19')?.base ?? 0;
            tax19 += field(r, 'taxable19')?.tax ?? 0;
            base7 += field(r, 'taxable7')?.base ?? 0;
            tax7 += field(r, 'taxable7')?.tax ?? 0;
          }
          const want = (rate: number, what: 'net' | 'tax') => lines.filter((l) => l.rate === rate).reduce((a, l) => a + l[what], 0);
          return base19 === want(1900, 'net') && tax19 === want(1900, 'tax') && base7 === want(700, 'net') && tax7 === want(700, 'tax');
        },
      ),
      fcParams,
    );
  });
});

describe('invoices without German VAT', () => {
  const noVat = (over: Partial<UstvaInvoice>): UstvaInvoice => invoice({ lines: [{ rate: basisPoints(0), net: cents(50_000), tax: cents(0) }], ...over });

  it('an intra-community supply is Kz 41', () => {
    const r = run({ invoices: [noVat({ treatment: 'intraCommunitySupply', customerCountry: 'FR' })] });
    expect(field(r, 'intraCommunitySupply')).toMatchObject({ kz: '41', base: 50_000 });
    expect(field(r, 'remainingPrepayment')?.tax).toBe(0);
  });

  it('a service not taxable in Germany is Kz 45', () => {
    expect(field(run({ invoices: [noVat({ treatment: 'notTaxable', customerCountry: 'US' })] }), 'otherNotTaxable')).toMatchObject({ kz: '45', base: 50_000 });
  });

  it('reverse charge to a business in another EU state is Kz 21, to a customer in Germany Kz 60', () => {
    expect(field(run({ invoices: [noVat({ treatment: 'reverseCharge', customerCountry: 'AT' })] }), 'euServices')).toMatchObject({ kz: '21', base: 50_000 });
    expect(field(run({ invoices: [noVat({ treatment: 'reverseCharge', customerCountry: 'DE' })] }), 'reverseChargeSupplied')).toMatchObject({ kz: '60', base: 50_000 });
  });

  it('on the cash basis, a payment of an invoice with Kz 45 or Kz 60 counts its amount (the rule is not verified)', () => {
    for (const [treatment, country, id] of [['notTaxable', 'US', 'otherNotTaxable'], ['reverseCharge', 'DE', 'reverseChargeSupplied']] as const) {
      const inv = noVat({ treatment, customerCountry: country });
      const r = run({ method: 'cash', invoices: [inv], payments: [{ id: 'p', invoiceId: 'r1', date: '2026-10-05', amount: cents(20_000) }] });
      expect(field(r, id)?.base).toBe(20_000);
    }
  });

  it('what kontor cannot place is reported, not guessed: 0 % under standard, reverse charge without a known country', () => {
    const zero = invoice({ lines: [{ rate: basisPoints(0), net: cents(10_000), tax: cents(0) }] });
    const unknown = noVat({ id: 'r3', treatment: 'reverseCharge', customerCountry: 'US' });
    const r = run({ invoices: [zero, unknown] });
    expect(r.notices).toContainEqual({ code: 'supplyUnplaced', count: 2, amount: 60_000 });
    expect(field(r, 'euServices')?.base).toBe(0);
  });
});

describe('§ 18b UStG: Kz 41 and Kz 21 by the invoice and the service, also on the cash basis (#75)', () => {
  // § 18b Satz 2: an intra-community supply in the period in which the invoice is issued, at the latest the one in which
  // the month after the supply ends. § 18b Satz 3: a service under § 3a Abs. 2 for which the recipient in another EU state
  // owes the tax in the period in which it was performed. Neither depends on the payment. Read at
  // https://dejure.org/gesetze/UStG/18b.html on 8 November 2026 (gesetze-im-internet.de did not answer).
  const Q1: UstvaPeriod = { year: 2026, kind: 'quarter', index: 1 };
  const Q2: UstvaPeriod = { year: 2026, kind: 'quarter', index: 2 };
  const month = (index: number): UstvaPeriod => ({ year: 2026, kind: 'month', index });
  const eu = (over: Partial<UstvaInvoice>): UstvaInvoice => invoice({ customerCountry: 'AT', lines: [{ rate: basisPoints(0), net: cents(500_000), tax: cents(0) }], ...over });
  const paidInApril: UstvaPayment[] = [{ id: 'p', invoiceId: 'r1', date: '2026-04-15', amount: cents(500_000) }];
  const base = (r: UstvaResult, id: 'euServices' | 'intraCommunitySupply') => field(r, id)?.base ?? 0;

  it('the failing scenario of #75: an EU service of 20 March, paid on 15 April, is Kz 21 of Q1 on the cash basis', () => {
    const service = eu({ treatment: 'reverseCharge', date: '2026-03-20', serviceEnd: '2026-03-20' });
    expect(base(run({ method: 'cash', period: Q1, invoices: [service], payments: paidInApril }), 'euServices')).toBe(500_000);
    expect(base(run({ method: 'cash', period: Q2, invoices: [service], payments: paidInApril }), 'euServices')).toBe(0);
    // and an EU service that is never paid is still declared
    expect(base(run({ method: 'cash', period: Q1, invoices: [service] }), 'euServices')).toBe(500_000);
  });

  it('an intra-community supply counts when the invoice is issued, on both bases', () => {
    const supply = eu({ treatment: 'intraCommunitySupply', serviceEnd: '2026-03-20', date: '2026-04-02' });
    for (const method of ['accrual', 'cash'] as const) {
      expect(base(run({ method, period: month(3), invoices: [supply], payments: paidInApril }), 'intraCommunitySupply')).toBe(0);
      expect(base(run({ method, period: month(4), invoices: [supply], payments: paidInApril }), 'intraCommunitySupply')).toBe(500_000);
    }
  });

  it('an invoice issued late counts at the latest in the period in which the month after the supply ends', () => {
    const late = eu({ treatment: 'intraCommunitySupply', serviceEnd: '2026-03-20', date: '2026-05-15' });
    expect(base(run({ period: month(4), invoices: [late] }), 'intraCommunitySupply')).toBe(500_000);
    expect(base(run({ period: month(5), invoices: [late] }), 'intraCommunitySupply')).toBe(0);
    // a supply on the last day of January: the month after is February, also in a leap year
    const january = eu({ treatment: 'intraCommunitySupply', serviceEnd: '2028-01-31', date: '2028-04-01' });
    expect(base(run({ period: { year: 2028, kind: 'month', index: 2 }, invoices: [january] }), 'intraCommunitySupply')).toBe(500_000);
  });

  it('an EU service over a period counts when it ends, also when it was invoiced before', () => {
    const service = eu({ treatment: 'reverseCharge', date: '2026-02-01', serviceEnd: '2026-04-30' });
    expect(base(run({ method: 'cash', period: Q1, invoices: [service] }), 'euServices')).toBe(0);
    expect(base(run({ method: 'cash', period: Q2, invoices: [service] }), 'euServices')).toBe(500_000);
  });

  it('a cancellation counts negative in the period of its own date, also on the cash basis (§ 18b Satz 4, § 17 Abs. 1 Satz 8)', () => {
    const service = eu({ treatment: 'reverseCharge', date: '2026-03-20', serviceEnd: '2026-03-20' });
    const cancellation = eu({ id: 's1', treatment: 'reverseCharge', date: '2026-04-10', serviceEnd: '2026-03-20', isCancellation: true, lines: [{ rate: basisPoints(0), net: cents(-500_000), tax: cents(0) }] });
    expect(base(run({ method: 'cash', period: Q1, invoices: [service, cancellation] }), 'euServices')).toBe(500_000);
    expect(base(run({ method: 'cash', period: Q2, invoices: [service, cancellation] }), 'euServices')).toBe(-500_000);
  });

  it('property: on the cash basis, Kz 21 and Kz 41 do not depend on the payments', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.array(fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 500_000 })), { maxLength: 4 }), (m, paid) => {
        const invoices = [eu({ treatment: 'reverseCharge' }), eu({ id: 'r2', treatment: 'intraCommunitySupply' })];
        const payments = paid.map(([pm, amount], i) => ({ id: `p${i}`, invoiceId: i % 2 ? 'r2' : 'r1', date: `2026-${String(pm).padStart(2, '0')}-10`, amount: cents(amount) }));
        const withPayments = run({ method: 'cash', period: month(m), invoices, payments });
        const without = run({ method: 'cash', period: month(m), invoices });
        expect([base(withPayments, 'euServices'), base(withPayments, 'intraCommunitySupply')]).toEqual([base(without, 'euServices'), base(without, 'intraCommunitySupply')]);
      }),
      fcParams,
    );
  });
});

describe('expenses: input tax by the date of the expense', () => {
  it('sums the VAT of domestic expenses of the period', () => {
    const r = run({ expenses: [expense(), expense({ gross: cents(10_700), vat: cents(700) }), expense({ date: '2026-11-01' }), expense({ taxTreatment: 'noVat', vat: cents(0) })] });
    expect(field(r, 'inputTax')?.tax).toBe(2_600);
  });

  it('a surplus is a negative remaining prepayment', () => {
    const r = run({ expenses: [expense()] });
    expect(field(r, 'remainingPrepayment')?.tax).toBe(-1_900);
  });

  it('reverse charge and third-country expenses are reported, not computed', () => {
    const r = run({ expenses: [expense({ taxTreatment: 'euReverseCharge', gross: cents(30_000), vat: cents(0) }), expense({ taxTreatment: 'thirdCountry', gross: cents(5_000), vat: cents(0) })] });
    expect(r.notices).toContainEqual({ code: 'expenseReverseCharge', count: 1, amount: 30_000 });
    expect(r.notices).toContainEqual({ code: 'expenseThirdCountry', count: 1, amount: 5_000 });
    expect(field(r, 'inputTax')?.tax).toBe(0);
  });
});

describe('result', () => {
  it('shows the four main fields always and the others only when they have an amount', () => {
    const empty = run();
    expect(empty.fields.filter((f) => f.shown).map((f) => f.kz)).toEqual(['81', '86', '66', '83']);
    const withEu = run({ invoices: [invoice({ treatment: 'intraCommunitySupply', lines: [{ rate: basisPoints(0), net: cents(100), tax: cents(0) }] })] });
    expect(withEu.fields.filter((f) => f.shown).map((f) => f.kz)).toEqual(['81', '86', '41', '66', '83']);
  });

  it('has the period, the due date and the method', () => {
    const r = run({ permanentExtension: true });
    expect(r.dueDate).toBe('2026-12-10');
    expect(r.period).toEqual(OCT_2026);
  });

  it('property: the remaining prepayment is the tax of 81 and 86 less the input tax', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999 }), fc.integer({ min: 0, max: 9_999_999 }), fc.integer({ min: 0, max: 999_999 }), (n19, n7, vat) => {
        const r = run({
          invoices: [invoice({ lines: [{ rate: R19, net: cents(n19), tax: cents(Math.round(n19 * 0.19)) }, { rate: R7, net: cents(n7), tax: cents(Math.round(n7 * 0.07)) }] })],
          expenses: [expense({ vat: cents(vat) })],
        });
        const t = (id: string): Cents => field(r, id)?.tax ?? cents(0);
        return t('remainingPrepayment') === t('taxable19') + t('taxable7') - t('inputTax');
      }),
      fcParams,
    );
  });
});
