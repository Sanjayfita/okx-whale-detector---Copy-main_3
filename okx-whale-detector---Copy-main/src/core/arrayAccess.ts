/**
 * Returns an array element only after proving it exists at runtime.
 *
 * Quantitative code frequently derives valid indexes from prior length checks.
 * Keeping the assertion executable prevents those assumptions from silently
 * becoming `undefined` if a caller or later refactor violates the invariant.
 */
export const requireArrayElement = <Value>(
  values: readonly Value[],
  index: number,
  context: string,
): Value => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) {
    throw new Error(`${context} index ${index} is outside the array bounds`);
  }
  const value = values[index];
  if (value === undefined) {
    throw new Error(`${context} element ${index} is unexpectedly undefined`);
  }
  return value;
};
