export function validateNumber(
  validation:
    | {
        min?: number;
        max?: number;
        isRequired?: boolean;
        validateStep?: boolean;
      }
    | undefined,
  value: unknown,
  step: number | undefined,
  label: string
) {
  if (value !== null && typeof value !== 'number') {
    return `${label} must be a number`;
  }

  if (validation?.isRequired && value === null) {
    return `${label} is required`;
  }

  if (value !== null) {
    if (validation?.min !== undefined && value < validation.min) {
      return `${label} must be at least ${validation.min}`;
    }
    if (validation?.max !== undefined && value > validation.max) {
      return `${label} must be at most ${validation.max}`;
    }
    if (
      step !== undefined &&
      validation?.validateStep !== undefined &&
      !isAtStep(value, step)
    ) {
      return `${label} must be a multiple of ${step}`;
    }
  }
}

// Exact decimal representation of a number's own `.toString()` (which is
// always the shortest round-tripping decimal for that float) as an integer
// `digits` scaled by 10^-`scale` - e.g. 5.1 -> { digits: 51n, scale: 1 },
// 1e-200 -> { digits: 1n, scale: 200 }.
function toScaledBigInt(value: number): { digits: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(
    value.toString()
  );
  if (!match) {
    throw new Error(`Unexpected number format: ${value}`);
  }
  const [, sign, intPart, fracPart = '', expPart] = match;
  let scale = fracPart.length - (expPart ? parseInt(expPart, 10) : 0);
  let digits = BigInt(intPart + fracPart || '0');
  if (sign === '-') digits = -digits;
  return { digits, scale };
}

// Whether `value` is an exact integer multiple of `step`. Done with BigInt
// arithmetic on each number's own exact decimal digits (see toScaledBigInt)
// rather than scaling both by `Math.pow(10, decimalPlaces)` and comparing as
// floats - that approach loses all meaning once the scale factor (10^200 for
// a step like 1e-200) exceeds Number.MAX_SAFE_INTEGER by a wide margin, since
// neither the scaled value nor the "is it exactly divisible" check can be
// trusted at that magnitude in IEEE 754 double precision.
export function isAtStep(value: number, step: number) {
  const v = toScaledBigInt(value);
  const s = toScaledBigInt(step);
  if (s.digits === 0n) return v.digits === 0n;
  // Bring both to the same scale (more decimal places = larger scale) so
  // their `digits` are directly comparable integers before the modulo.
  const scale = Math.max(v.scale, s.scale);
  const vDigits = v.digits * 10n ** BigInt(scale - v.scale);
  const sDigits = s.digits * 10n ** BigInt(scale - s.scale);
  return vDigits % sDigits === 0n;
}
