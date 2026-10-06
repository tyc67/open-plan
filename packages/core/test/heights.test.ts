import { describe, expect, it } from 'vitest';
import { effectiveCeilingHeight } from '../src/index.js';

describe('effectiveCeilingHeight', () => {
  it('keeps a valid ceiling', () => {
    expect(effectiveCeilingHeight({ ceilingHeight: 2800 })).toBe(2800);
    expect(effectiveCeilingHeight({ ceilingHeight: 2000 })).toBe(2000);
    expect(effectiveCeilingHeight({ ceilingHeight: 6000 })).toBe(6000);
  });
  it('clamps an out-of-range ceiling to 2000–6000 mm', () => {
    expect(effectiveCeilingHeight({ ceilingHeight: 500 })).toBe(2000);
    expect(effectiveCeilingHeight({ ceilingHeight: -100 })).toBe(2000);
    expect(effectiveCeilingHeight({ ceilingHeight: 7000 })).toBe(6000);
  });
});
