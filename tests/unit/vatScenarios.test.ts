// The VAT reference scenarios of #37: worked examples with exact cents, one fixture file per topic in tests/fixtures/vat/.
// The expected values and the paragraph and URL behind each are in those files. Scenarios that need features that are not
// built yet (payouts, expenses with § 13b) are `it.todo` entries; their reasoning is in tests/fixtures/vat/pending.ts.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { basisPoints, cents, splitGross, taxTotals } from '../../src/domain/money';
import { smallBusinessLimitState } from '../../src/domain/overview';
import { ustva } from '../../src/domain/ustva';
import { zm } from '../../src/domain/zm';
import { limitCases, pendingScenarios, scenarios, zmScenarios } from '../fixtures/vat';
import { gross, invoiceOf } from '../fixtures/vat/helpers';
import { fcParams } from './fixtures';

describe('VAT reference scenarios: advance return (UStVA)', () => {
  it('has unique scenario ids', () => {
    const ids = [...scenarios.map((s) => s.id), ...pendingScenarios.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const s of scenarios) {
    it(`${s.id}: ${s.title}`, () => {
      const result = ustva(s.input);
      for (const [id, expected] of Object.entries(s.expected)) {
        const field = result.fields.find((f) => f.id === id);
        expect(field, `field ${id}`).toBeDefined();
        if (expected.base !== undefined) expect(field?.base, `${id} base`).toBe(expected.base);
        if (expected.tax !== undefined) expect(field?.tax, `${id} tax`).toBe(expected.tax);
        if (expected.shown !== undefined) expect(field?.shown, `${id} shown`).toBe(expected.shown);
      }
      if (s.notices) expect(result.notices.map((n) => ({ code: n.code, count: n.count, amount: n.amount }))).toEqual(s.notices);
      if (s.dueDate) expect(result.dueDate).toBe(s.dueDate);
    });
  }
});

describe('VAT reference scenarios: summary report (ZM)', () => {
  for (const s of zmScenarios) {
    it(`${s.id}: ${s.title}`, () => {
      const result = zm({ period: s.period, invoices: s.invoices });
      expect(result.lines.map((l) => ({ vatId: l.vatId, kind: l.kind, base: l.base }))).toEqual(s.lines);
      expect(result.total.service).toBe(s.services);
      // the services are the base of Kz 21 of the advance return of the same period (accrual basis)
      const kz21 = ustva({
        period: s.period,
        method: 'accrual',
        permanentExtension: false,
        payments: [],
        expenses: [],
        invoices: s.invoices.map((i) => ({
          id: i.id,
          date: i.date,
          serviceEnd: i.serviceEnd,
          treatment: i.treatment,
          customerCountry: i.customerCountry,
          isCancellation: i.isCancellation,
          smallBusiness: i.smallBusiness,
          lines: [{ rate: basisPoints(0), net: i.net, tax: cents(0) }],
        })),
      }).fields.find((f) => f.id === 'euServices');
      expect(kz21?.base).toBe(s.services);
    });
  }
});

describe('VAT reference scenarios: limits of the small business scheme (§ 19 Abs. 1 UStG)', () => {
  for (const c of limitCases) {
    it(c.title, () => {
      const state = smallBusinessLimitState(c.year, cents(c.previous), cents(c.current));
      expect(state.previousAbove).toBe(c.previousAbove);
      expect(state.currentAbove).toBe(c.currentAbove);
      expect([state.previousLimit, state.currentLimit]).toEqual([2_500_000, 10_000_000]);
    });
  }
});

describe('VAT reference scenarios: rounding (half away from zero, ADR 0003)', () => {
  it('worked examples at 19 % and 7 %', () => {
    const tax = (net: number, rate: number) => taxTotals([{ net: cents(net), rate: basisPoints(rate) }]).tax;
    // 1,000.50 € × 19 % = 190.095 €
    expect([tax(100_050, 1900), tax(-100_050, 1900)]).toEqual([19_010, -19_010]);
    // 0.50 € × 19 % = 0.095 €, 0.50 € × 7 % = 0.035 €, 0.07 € × 7 % = 0.0049 €
    expect([tax(50, 1900), tax(50, 700), tax(7, 700)]).toEqual([10, 4, 0]);
  });

  it('per document and per line differ by up to half a cent per line: 2 × 0.03 € at 19 %', () => {
    const lines = [
      { net: cents(3), rate: basisPoints(1900) },
      { net: cents(3), rate: basisPoints(1900) },
    ];
    expect([taxTotals(lines, 'perDocument').tax, taxTotals(lines, 'perLine').tax]).toEqual([1, 2]);
  });

  const amount = fc.integer({ min: -100_000_000_000, max: 100_000_000_000 }).map(cents);
  const anyRate = fc.integer({ min: 0, max: 100_000 }).map(basisPoints);

  it('property: for any rate and amount, net plus tax is the gross amount and the tax is the nearest cent', () => {
    fc.assert(
      fc.property(amount, anyRate, (net, rate) => {
        const t = taxTotals([{ net, rate }]);
        expect(t.net + t.tax).toBe(t.gross);
        expect(t.net).toBe(net);
        // the exact tax is net × rate / 10,000 cents: at most half a cent away, in integer arithmetic
        const diff = BigInt(t.tax) * 10_000n - BigInt(net) * BigInt(rate);
        const abs = diff < 0n ? -diff : diff;
        expect(abs * 2n <= 10_000n).toBe(true);
        // a tie is rounded away from zero, never towards it
        if (abs * 2n === 10_000n) expect(BigInt(Math.abs(t.tax)) * 10_000n > BigInt(Math.abs(net)) * BigInt(rate)).toBe(true);
        // a cancellation takes back exactly what the invoice charged
        expect(taxTotals([{ net: cents(-net), rate }]).tax).toBe(-t.tax + 0);
      }),
      fcParams,
    );
  });

  it('property: a gross amount is split into net and tax that add up to it', () => {
    fc.assert(
      fc.property(amount, anyRate, (g, rate) => {
        const { net, tax } = splitGross(g, rate);
        expect(net + tax).toBe(g);
        // the net is the nearest cent to gross / (1 + rate)
        const diff = BigInt(net) * (10_000n + BigInt(rate)) - BigInt(g) * 10_000n;
        const abs = diff < 0n ? -diff : diff;
        expect(abs * 2n <= 10_000n + BigInt(rate)).toBe(true);
      }),
      fcParams,
    );
  });

  it('property: on the return, base plus tax of the 19 % field is the gross amount of the invoices of the month', () => {
    const nets = fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 8 });
    fc.assert(
      fc.property(nets, (list) => {
        const invoices = list.map((net, i) => invoiceOf({ id: `i${i}`, date: '2026-10-15' }, [{ net }]));
        const r = ustva({ period: { year: 2026, kind: 'month', index: 10 }, method: 'accrual', permanentExtension: false, invoices, payments: [], expenses: [] });
        const f = r.fields.find((x) => x.id === 'taxable19');
        expect((f?.base ?? 0) + (f?.tax ?? 0)).toBe(invoices.reduce((s, inv) => s + gross(inv), 0));
      }),
      fcParams,
    );
  });
});

describe('VAT reference scenarios still waiting for a feature', () => {
  for (const p of pendingScenarios) it.todo(`${p.id} (${p.needs}): ${p.title}`);
});
