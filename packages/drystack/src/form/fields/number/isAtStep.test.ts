import { isAtStep } from './validateNumber';
import { test, expect } from '@jest/globals';

for (const [value, step] of [
  [5, 1],
  [5, 0.1],
  [5, 0.5],
  [5, 5e-3],
  [5.1, 0.1],
  [5.1, 1e-6],
  [5.1, 1e-7],
  [5.1, 1e-200],
  [300, 3e-200],
  // 5.1 = 51 * 10^-1 and 3e-200 = 3 * 10^-200, so 5.1 / 3e-200 = 17 * 10^199
  // exactly - an exact integer multiple, same as the two cases above.
  [5.1, 3e-200],
]) {
  test(`value: ${value}, step: ${step} should be true`, () => {
    expect(isAtStep(value, step)).toBe(true);
  });
}

for (const [value, step] of [
  [5.1, 1],
  [5.1, 0.5],
]) {
  test(`value: ${value}, step: ${step} should be false`, () => {
    expect(isAtStep(value, step)).toBe(false);
  });
}
