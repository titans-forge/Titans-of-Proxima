export const assert: {
  equal(actual: unknown, expected: unknown, message?: string): void;
  notEqual(actual: unknown, expected: unknown, message?: string): void;
  ok(value: unknown, message?: string): asserts value;
  match(value: string, pattern: RegExp, message?: string): void;
} = {
  equal(actual: unknown, expected: unknown, message = "Values differ"): void {
    if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  },
  notEqual(actual: unknown, expected: unknown, message = "Values should differ"): void {
    if (actual === expected) throw new Error(message);
  },
  ok(value: unknown, message = "Assertion failed"): asserts value {
    if (!value) throw new Error(message);
  },
  match(value: string, pattern: RegExp, message = "Pattern not found"): void {
    if (!pattern.test(value)) throw new Error(`${message}: ${value}`);
  },
};
