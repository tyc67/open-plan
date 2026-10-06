import { describe, expect, it } from 'vitest';
import { formatLength, unitFactor } from '../src/index.js';

describe('units', () => {
  it('converts millimetres to the display unit', () => {
    expect(unitFactor('mm')).toBe(1);
    expect(unitFactor('cm')).toBe(10);
    expect(unitFactor('unknown')).toBe(1);
  });

  it('formats with at most 3 decimals and no trailing zeros', () => {
    expect(formatLength(1234.5)).toBe('1234.5');
    expect(formatLength(1234.5, 'cm')).toBe('123.45');
    expect(formatLength(9500.000000001002)).toBe('9500');
    expect(formatLength(1789.9999999999998)).toBe('1790');
    expect(formatLength(0.0004)).toBe('0');
  });
});
