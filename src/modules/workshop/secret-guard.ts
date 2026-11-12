/** Inspect decoded strings/keys directly; JSON serialization can hide quoted/backslash credentials. */
export function containsDecodedSecret(value: unknown, secret: string): boolean {
  if (!secret) return false;
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') {
      if (current.includes(secret)) return true;
    } else if (Array.isArray(current)) pending.push(...current);
    else if (current && typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) {
        if (key.includes(secret)) return true;
        pending.push(item);
      }
    }
  }
  return false;
}
