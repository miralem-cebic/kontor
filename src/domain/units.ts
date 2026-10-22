// Units of quantity for items and document lines. They are stored as codes of UN/ECE Recommendation 20, the code
// list that e-invoices use for the unit of a line (EN 16931 BT-130, XRechnung code list "UNECERec20").
// Source: https://unece.org/trade/uncefact/cl-recommendations (Recommendation No. 20, Codes for Units of Measure)

export const UNITS = [
  'H87', // piece
  'HUR', // hour
  'MIN', // minute
  'DAY', // day
  'WEE', // week
  'MON', // month
  'ANN', // year
  'LS', // lump sum
  'KMT', // kilometre
  'MTR', // metre
  'MTK', // square metre
  'MTQ', // cubic metre
  'KGM', // kilogram
  'LTR', // litre
  'SET', // set
] as const;

export type UnitCode = (typeof UNITS)[number];

export const DEFAULT_UNIT: UnitCode = 'H87';

export const isUnitCode = (v: unknown): v is UnitCode => typeof v === 'string' && (UNITS as readonly string[]).includes(v);
