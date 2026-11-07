import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { basisPoints, cents } from '../../src/domain/money';
import { taxParams } from '../../src/domain/tax/params';
import { ustva, type UstvaPeriod } from '../../src/domain/ustva';
import { ZM_PORTAL_URL, zm, zmDueDate, zmUstvaCheck, zmWholeEuros, type ZmInput, type ZmInvoice, type ZmResult } from '../../src/domain/zm';
import { isWebUrl } from '../../src/domain/links';
import { fcParams } from './fixtures';

const Q3: UstvaPeriod = { year: 2026, kind: 'quarter', index: 3 };
const Q4: UstvaPeriod = { year: 2026, kind: 'quarter', index: 4 };
const month = (index: number): UstvaPeriod => ({ year: 2026, kind: 'month', index });

const IE_ID = 'IE6388047V';
const FR_ID = 'FR40303265045';

/** A service of 1,000.00 € net for a business in Ireland, performed and written on 15 August 2026 */
const service = (over: Partial<ZmInvoice> = {}): ZmInvoice => ({
  id: 's1',
  number: 'RE-2026-0001',
  date: '2026-08-15',
  serviceEnd: '2026-08-15',
  treatment: 'reverseCharge',
  customerCountry: 'IE',
  customerVatId: IE_ID,
  isCancellation: false,
  smallBusiness: false,
  net: cents(100_000),
  ...over,
});

/** Goods of 5,000.00 € net to a business in France */
const supply = (over: Partial<ZmInvoice> = {}): ZmInvoice =>
  service({ id: 'g1', number: 'RE-2026-0002', treatment: 'intraCommunitySupply', customerCountry: 'FR', customerVatId: FR_ID, net: cents(500_000), ...over });

const run = (invoices: ZmInvoice[], period: UstvaPeriod = Q3): ZmResult => zm({ period, invoices } satisfies ZmInput);

describe('services to a business in another EU state (§ 18a Abs. 2 and Abs. 7 Satz 1 Nr. 3 UStG)', () => {
  it('worked example: one recipient, the country and the sum of the bases in cents', () => {
    const r = run([service(), service({ id: 's2', number: 'RE-2026-0003', date: '2026-09-01', serviceEnd: '2026-09-01', net: cents(23_456) })]);
    expect(r.lines).toEqual([{ country: 'IE', vatId: IE_ID, idNumber: '6388047V', kind: 'service', base: 123_456, invoiceIds: ['s1', 's2'], problem: null }]);
    expect(r.total).toEqual({ service: 123_456, supply: 0 });
    expect(r.problems).toEqual([]);
  });

  it('several recipients: one line per VAT ID, sorted by VAT ID; a VAT ID is normalized (spaces, lower case)', () => {
    const r = run([service({ id: 'a', customerVatId: 'fr 40 303265045', customerCountry: 'FR', net: cents(10_000) }), service({ id: 'b' }), service({ id: 'c', customerVatId: 'FR40303265045', customerCountry: 'FR', net: cents(5_000) })]);
    expect(r.lines.map((l) => [l.vatId, l.base, l.invoiceIds])).toEqual([
      [FR_ID, 15_000, ['a', 'c']],
      [IE_ID, 100_000, ['b']],
    ]);
  });

  it('Greece: the country of the address is GR, the VAT ID starts with EL and so does the country of the line', () => {
    const r = run([service({ customerCountry: 'GR', customerVatId: 'EL123456789' })]);
    expect(r.lines[0]).toMatchObject({ country: 'EL', vatId: 'EL123456789', idNumber: '123456789', problem: null });
  });

  it('a cancellation is negative on its own date; a service and its cancellation in one period leave no line', () => {
    const r = run([service(), service({ id: 'c1', number: 'RE-2026-0004', isCancellation: true, date: '2026-09-10', serviceEnd: '2026-09-10', net: cents(-100_000) })]);
    expect(r.lines).toEqual([]);
    expect(r.total.service).toBe(0);
  });

  it('a cancellation in a later period is negative there, and the original stays where it was (§ 17 Abs. 1 Satz 7, § 18a Abs. 7 Satz 2 UStG)', () => {
    const invoices = [service(), service({ id: 'c1', isCancellation: true, date: '2026-10-05', serviceEnd: '2026-08-15', net: cents(-100_000) })];
    expect(run(invoices, Q3).lines.map((l) => l.base)).toEqual([100_000]);
    expect(run(invoices, Q4).lines.map((l) => l.base)).toEqual([-100_000]);
  });

  it('quarter boundaries: the day of the service decides (§ 18a Abs. 8 Satz 2 UStG), not the day of the invoice', () => {
    const invoices = [
      service({ id: 'last', date: '2026-10-02', serviceEnd: '2026-09-30', net: cents(100) }),
      service({ id: 'first', date: '2026-09-29', serviceEnd: '2026-10-01', net: cents(200) }),
      service({ id: 'jul1', date: '2026-07-01', serviceEnd: '2026-07-01', net: cents(400) }),
      service({ id: 'jun30', date: '2026-06-30', serviceEnd: '2026-06-30', net: cents(800) }),
    ];
    expect(run(invoices, Q3).lines[0]?.invoiceIds).toEqual(['jul1', 'last']);
    expect(run(invoices, Q4).lines[0]?.invoiceIds).toEqual(['first']);
    expect(run(invoices, { year: 2026, kind: 'quarter', index: 2 }).lines[0]?.invoiceIds).toEqual(['jun30']);
  });

  it('year boundary: a service of 31 December written in January belongs to the quarter of December', () => {
    const r = run([service({ date: '2027-01-02', serviceEnd: '2026-12-31' })], Q4);
    expect(r.lines.map((l) => l.base)).toEqual([100_000]);
  });
});

describe('intra-community supplies of goods (§ 18a Abs. 1, Abs. 7 Satz 1 Nr. 1, Abs. 8 Satz 1 UStG)', () => {
  it('a supply is a line of kind "supply", beside a service to the same VAT ID', () => {
    const r = run([supply(), service({ id: 'x', customerVatId: FR_ID, customerCountry: 'FR', net: cents(1_000) })]);
    expect(r.lines.map((l) => [l.vatId, l.kind, l.base])).toEqual([
      [FR_ID, 'service', 1_000],
      [FR_ID, 'supply', 500_000],
    ]);
    expect(r.total).toEqual({ service: 1_000, supply: 500_000 });
  });

  it('the period is that of the invoice, at the latest the one in which the month after the supply ends', () => {
    // the supply on 28 September: an invoice of 5 September counts in Q3, one of 3 October in Q4, one that is never written (20 January) is capped at the end of October (Q4)
    const early = supply({ id: 'early', date: '2026-09-05', serviceEnd: '2026-09-28' });
    const late = supply({ id: 'late', date: '2026-10-03', serviceEnd: '2026-09-28' });
    const veryLate = supply({ id: 'veryLate', date: '2027-01-20', serviceEnd: '2026-09-28' });
    const all = [early, late, veryLate];
    expect(run(all, Q3).lines[0]?.invoiceIds).toEqual(['early']);
    expect(run(all, Q4).lines[0]?.invoiceIds).toEqual(['late', 'veryLate']);
  });

  it('a supply without a country on the invoice is taken with the country of its VAT ID', () => {
    const r = run([supply({ customerCountry: null })]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.country).toBe('FR');
  });
});

describe('who is left out', () => {
  it('a small business has no summary report (§ 18a Abs. 4 UStG)', () => {
    const r = run([service({ smallBusiness: true }), supply({ smallBusiness: true })]);
    expect(r.lines).toEqual([]);
    expect(r.notices).toEqual([]);
  });

  it('a customer in Germany, taxed or not, is not reported', () => {
    const r = run([service({ customerCountry: 'DE', customerVatId: 'DE136695976' }), service({ id: 'std', treatment: 'standard', customerCountry: 'IE' })]);
    expect(r.lines).toEqual([]);
  });

  it('a service not taxable in Germany to a customer in the EU is not reported, but noticed: it is more likely a reverse charge', () => {
    const r = run([service({ treatment: 'notTaxable', net: cents(7_000) })]);
    expect(r.lines).toEqual([]);
    expect(r.notices).toEqual([{ code: 'notTaxableEu', count: 1, amount: 7_000 }]);
  });

  it('a service not taxable in Germany to a customer outside the EU is not reported and not noticed', () => {
    const r = run([service({ treatment: 'notTaxable', customerCountry: 'US', customerVatId: '' })]);
    expect(r.lines).toEqual([]);
    expect(r.notices).toEqual([]);
  });

  it('a reverse charge to a customer outside the EU, or without a country, is noticed as not placed', () => {
    const r = run([service({ customerCountry: 'US', net: cents(1_000) }), service({ id: 'n', customerCountry: null, net: cents(2_000) })]);
    expect(r.lines).toEqual([]);
    expect(r.notices).toEqual([{ code: 'placeUnknown', count: 2, amount: 3_000 }]);
  });

  it('a standard invoice with VAT is never reported', () => {
    expect(run([service({ treatment: 'standard', customerCountry: 'IE' })]).lines).toEqual([]);
  });
});

describe('the VAT ID of the recipient is checked before the report is sent', () => {
  const codes = (inv: Partial<ZmInvoice>) => run([service(inv)]).problems.map((p) => p.code);

  it('a missing VAT ID', () => {
    const r = run([service({ customerVatId: '  ' })]);
    expect(r.problems).toEqual([{ invoiceId: 's1', number: 'RE-2026-0001', vatId: '', code: 'vatIdMissing' }]);
    expect(r.lines[0]).toMatchObject({ vatId: '', problem: 'vatIdMissing', country: 'IE' });
  });

  it('a VAT ID that does not look like one', () => {
    expect(codes({ customerVatId: 'IE-' })).toEqual(['vatIdInvalid']);
    expect(codes({ customerVatId: 'XX123456789' })).toEqual(['vatIdInvalid']);
  });

  it('a German VAT ID: the recipient has to be in another member state', () => {
    expect(codes({ customerVatId: 'DE136695976' })).toEqual(['vatIdGerman']);
  });

  it('a VAT ID of another country than the address', () => {
    expect(codes({ customerVatId: FR_ID })).toEqual(['vatIdCountry']);
  });

  it('a good VAT ID has no problem; the problem is on the line of a recipient, and once per invoice', () => {
    expect(codes({})).toEqual([]);
    const r = run([service({ customerVatId: 'IE-' }), service({ id: 's2', customerVatId: 'IE-' })]);
    expect(r.problems.map((p) => p.invoiceId)).toEqual(['s1', 's2']);
  });
});

describe('the monthly case (§ 18a Abs. 1 Satz 1 and Abs. 2 Satz 2 UStG)', () => {
  const invoices = [
    supply({ id: 'jul', date: '2026-07-20', serviceEnd: '2026-07-20', net: cents(1_000) }),
    supply({ id: 'sep', date: '2026-09-20', serviceEnd: '2026-09-20', net: cents(2_000) }),
    service({ id: 'aug-service', date: '2026-08-15', serviceEnd: '2026-08-15', net: cents(300) }),
  ];

  it('supplies are reported in their own month', () => {
    expect(run(invoices, month(7)).lines.map((l) => [l.kind, l.invoiceIds])).toEqual([['supply', ['jul']]]);
    expect(run(invoices, month(8)).lines).toEqual([]);
    expect(run(invoices, month(9)).lines.map((l) => [l.kind, l.invoiceIds])).toEqual([
      ['supply', ['sep']],
      ['service', ['aug-service']],
    ]);
  });

  it('services of the quarter are reported in the last month of the quarter, with a notice', () => {
    const last = run(invoices, month(9));
    expect(last.lines.find((l) => l.kind === 'service')?.base).toBe(300);
    expect(last.notices).toContainEqual({ code: 'servicesInLastMonth', count: 1, amount: 300 });
    expect(run(invoices, month(8)).notices).toEqual([]);
  });

  it('the due date of a month is the 25th of the next month', () => {
    expect(run([], month(9)).dueDate).toBe('2026-10-26');
  });
});

describe('when the supplies of goods have to be reported monthly (§ 18a Abs. 1 Satz 2 UStG: more than 50,000 €)', () => {
  const big = (id: string, date: string, net: number) => supply({ id, date, serviceEnd: date, net: cents(net) });

  it('exactly 50,000.00 € in the quarter still allows the quarter; 50,000.01 € does not', () => {
    expect(run([big('a', '2026-08-01', 5_000_000)]).notices).toEqual([]);
    expect(run([big('a', '2026-08-01', 5_000_001)]).notices).toEqual([{ code: 'supplyMonthly', count: 1, amount: 5_000_001 }]);
  });

  it('one of the four quarters before counts too', () => {
    const r = run([big('old', '2025-10-15', 6_000_000)], Q3);
    expect(r.notices).toEqual([{ code: 'supplyMonthly', count: 1, amount: 6_000_000 }]);
    // the fourth quarter before (Q3 2025) still counts, the fifth (Q2 2025) is out of reach
    expect(run([big('old', '2025-07-15', 6_000_000)], Q3).notices).toHaveLength(1);
    expect(run([big('old', '2025-04-15', 6_000_000)], Q3).notices).toEqual([]);
  });

  it('services do not count', () => {
    expect(run([service({ net: cents(9_000_000) })]).notices).toEqual([]);
  });
});

describe('due date: the 25th day after the period (§ 18a Abs. 1 Satz 1 UStG), no permanent extension', () => {
  it('the 25th of the month after the period', () => {
    expect(zmDueDate({ year: 2026, kind: 'quarter', index: 4 })).toBe('2027-01-25');
    expect(zmDueDate({ year: 2027, kind: 'month', index: 1 })).toBe('2027-02-25');
  });

  it('moves a Saturday or Sunday to the Monday (§ 108 Abs. 3 AO)', () => {
    // 25 October 2026 is a Sunday
    expect(zmDueDate(Q3)).toBe('2026-10-26');
    // 25 June 2028 is a Sunday, 25 March 2028 a Saturday
    expect(zmDueDate({ year: 2028, kind: 'month', index: 5 })).toBe('2028-06-26');
    expect(zmDueDate({ year: 2028, kind: 'month', index: 2 })).toBe('2028-03-27');
  });

  it('the day comes from the parameters of the year, with the threshold', () => {
    expect(taxParams(2026).summaryReport).toEqual({ dueDay: 25, monthlySupplyLimit: 5_000_000 });
    expect(taxParams(2027).summaryReport).toEqual({ dueDay: 25, monthlySupplyLimit: 5_000_000 });
  });
});

describe('amounts as the portal takes them: whole euros', () => {
  it('rounds half away from zero, without a negative zero', () => {
    expect(zmWholeEuros(cents(123_456))).toBe(1_235);
    expect(zmWholeEuros(cents(123_449))).toBe(1_234);
    expect(zmWholeEuros(cents(123_450))).toBe(1_235);
    expect(zmWholeEuros(cents(-123_450))).toBe(-1_235);
    expect(zmWholeEuros(cents(49))).toBe(0);
    expect(Object.is(zmWholeEuros(cents(-49)), 0)).toBe(true);
  });
});

describe('consistency with the advance return (Kz 21, § 18b Satz 1 Nr. 2 UStG)', () => {
  const result = (services: number): ZmResult => run([service({ net: cents(services) })]);

  it('equal totals are consistent', () => {
    expect(zmUstvaCheck(result(123_456), cents(123_456))).toEqual({ zm: 123_456, ustva: 123_456, difference: 0, consistent: true });
  });

  it('a difference is reported with its sign (ZM minus Kz 21)', () => {
    expect(zmUstvaCheck(result(100_000), cents(90_000))).toEqual({ zm: 100_000, ustva: 90_000, difference: 10_000, consistent: false });
  });

  it('property: for accrual accounting the ZM total of services is the Kz 21 base of the same quarter', () => {
    const invoice = fc.record({
      day: fc.integer({ min: 1, max: 365 }),
      net: fc.integer({ min: -2_000_000, max: 2_000_000 }),
      cancel: fc.boolean(),
      country: fc.constantFrom('IE', 'FR', 'DE', 'US'),
      small: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(invoice, { maxLength: 12 }), fc.integer({ min: 1, max: 4 }), (list, q) => {
        const invoices = list.map((x, i): ZmInvoice => {
          const d = new Date(Date.UTC(2026, 0, x.day)).toISOString().slice(0, 10);
          const ids: Record<string, string> = { IE: IE_ID, FR: FR_ID, DE: 'DE136695976', US: '' };
          return service({ id: `i${i}`, date: d, serviceEnd: d, customerCountry: x.country, customerVatId: ids[x.country] ?? '', isCancellation: x.cancel, smallBusiness: x.small, net: cents(x.cancel ? -Math.abs(x.net) : Math.abs(x.net)) });
        });
        const period: UstvaPeriod = { year: 2026, kind: 'quarter', index: q };
        const kz21 = ustva({
          period,
          method: 'accrual',
          permanentExtension: false,
          payments: [],
          expenses: [],
          invoices: invoices.map((i) => ({ id: i.id, date: i.date, serviceEnd: i.serviceEnd, treatment: i.treatment, customerCountry: i.customerCountry, isCancellation: i.isCancellation, smallBusiness: i.smallBusiness, lines: [{ rate: basisPoints(0), net: i.net, tax: cents(0) }] })),
        }).fields.find((f) => f.id === 'euServices');
        expect(zm({ period, invoices }).total.service).toBe(kz21?.base);
      }),
      fcParams,
    );
  });
});

describe('periods', () => {
  it('property: every invoice lands in exactly one quarter, so the four quarters add up to the year', () => {
    const entry = fc.record({ day: fc.integer({ min: 1, max: 365 }), net: fc.integer({ min: 1, max: 1_000_000 }), goods: fc.boolean() });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 15 }), (list) => {
        const invoices = list.map((x, i) => {
          const d = new Date(Date.UTC(2026, 0, x.day)).toISOString().slice(0, 10);
          return x.goods ? supply({ id: `i${i}`, date: d, serviceEnd: d, net: cents(x.net) }) : service({ id: `i${i}`, date: d, serviceEnd: d, net: cents(x.net) });
        });
        const sum = [1, 2, 3, 4].reduce((s, q) => s + run(invoices, { year: 2026, kind: 'quarter', index: q }).total.service + run(invoices, { year: 2026, kind: 'quarter', index: q }).total.supply, 0);
        expect(sum).toBe(invoices.reduce((s, i) => s + i.net, 0));
      }),
      fcParams,
    );
  });
});

describe('the portal', () => {
  it('is an https link', () => {
    expect(isWebUrl(ZM_PORTAL_URL)).toBe(true);
    expect(ZM_PORTAL_URL.startsWith('https://')).toBe(true);
  });
});
