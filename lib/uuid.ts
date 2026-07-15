import * as Crypto from 'expo-crypto';

export function uuid(): string {
  // RFC4122 v4, backed by a crypto-secure random source. Local primary keys
  // can now be merged across a user's devices via cloud restore, so
  // Math.random()'s collision risk stopped being purely theoretical.
  const bytes = Crypto.getRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
