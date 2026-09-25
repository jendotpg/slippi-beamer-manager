export function assertInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  throw new TypeError(`Expected an integer, got ${value}`);
}

export function assertBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new TypeError(`Expected a boolean, got ${value}`);
}

export function assertString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  throw new TypeError(`Expected a string, got ${value}`);
}
