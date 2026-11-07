/** The values of one tax year that kontor needs. Each value names its source in the file of its year. */
import type { Cents } from '../../money';

/** The Kennzahlen of the advance return that kontor fills, as the text printed on the form */
export interface VatReturnFields {
  /** Supplies and other services taxed at 19 %: net base (Bemessungsgrundlage) in whole euros, and the tax beside it */
  taxable19: string;
  /** The same at 7 % */
  taxable7: string;
  /** Intra-community supplies to a buyer with a VAT ID (§ 4 Nr. 1 Buchst. b UStG): base */
  intraCommunitySupply: string;
  /** Other services to a business in another EU member state, not taxable in Germany (§ 18b Satz 1 Nr. 2 UStG): base */
  euServices: string;
  /** Domestic supplies where the customer owes the tax (§ 13b Abs. 5 UStG): base */
  reverseChargeSupplied: string;
  /** Other supplies not taxable in Germany (place of supply abroad): base */
  otherNotTaxable: string;
  /** Input tax from invoices of other businesses (§ 15 Abs. 1 Satz 1 Nr. 1 UStG) */
  inputTax: string;
  /** Remaining prepayment (positive) or surplus (negative) */
  remainingPrepayment: string;
}

export interface TaxYearParams {
  year: number;
  /** The turnover limits of the small business scheme (§ 19 Abs. 1 UStG), net turnover in cents */
  smallBusiness: {
    /** The turnover of the previous calendar year may not exceed this */
    previousYearLimit: Cents;
    /** The turnover of the current calendar year is expected not to exceed this */
    currentYearLimit: Cents;
    /** Calendar years the waiver of the scheme binds (§ 19 Abs. 3 Satz 3 UStG) */
    waiverBindingYears: number;
  };
  /** The advance VAT return (Umsatzsteuer-Voranmeldung, UStVA): when it is due and the form fields kontor fills */
  vatReturn: {
    /** The day of the month after the period on which the return is due */
    dueDay: number;
    /** The months the due date moves with permanent extension (Dauerfristverlängerung) */
    extensionMonths: number;
    /** The field numbers (Kennzahlen) of the form. The tax of the fields 81 and 86 has no number of its own: it sits beside the base. */
    kz: VatReturnFields;
  };
  tradeTax: {
    /** Lowest multiplier (Hebesatz) of the trade tax, in percent; a municipality may not set less (§ 16 Abs. 4 Satz 2 GewStG) */
    minMultiplierPercent: number;
  };
}
