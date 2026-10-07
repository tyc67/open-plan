// crypto.randomUUID exists only in secure contexts (HTTPS, localhost); a LAN address over HTTP lacks it.
// getRandomValues has no such limit, so it builds the same RFC 4122 version 4 UUID. Both exist in browsers and Node.
// Core has no DOM or Node types; both runtimes have this global.
declare const crypto: { randomUUID?: () => string; getRandomValues<T extends Uint8Array>(array: T): T };

/** A random id for a new plan or a new item made in the editor. */
export function createId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A deterministic id that is not in `used`: `base` if it is free, else `base-2`, `base-3`, ... The same plan and the
 * same commands give the same ids, so command results can be tested and repeated.
 */
export function uniqueId(used: ReadonlySet<string>, base: string): string {
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}
