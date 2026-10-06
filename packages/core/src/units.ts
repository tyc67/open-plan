export type LengthUnit = 'mm' | 'cm';

/** Millimetres per display unit. Plan data is always stored in millimetres. */
export const unitFactor = (unit: LengthUnit | string): number => unit === 'cm' ? 10 : 1;

/** Display text for a length: at most 3 decimals in the display unit, trailing zeros removed. */
export const formatLength = (mm: number, unit: LengthUnit | string = 'mm'): string => String(Number((mm / unitFactor(unit)).toFixed(3)));
