export const unitFactor = unit => unit === 'cm' ? 10 : 1;
export const formatLength = (mm, unit = 'mm') => String(Number((mm / unitFactor(unit)).toFixed(3)));
