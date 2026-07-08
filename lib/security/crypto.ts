import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

export function hmacSha256Hex(secret: string, value: string) {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function deriveSecretDigestHex(secret: string, value: string) {
  return scryptSync(value, secret, 32).toString('hex');
}

export function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  const byteLength = Math.max(leftBuffer.byteLength, rightBuffer.byteLength, 1);
  const leftPadded = Buffer.alloc(byteLength);
  const rightPadded = Buffer.alloc(byteLength);

  leftBuffer.copy(leftPadded);
  rightBuffer.copy(rightPadded);

  return (
    timingSafeEqual(leftPadded, rightPadded) &&
    leftBuffer.byteLength === rightBuffer.byteLength
  );
}

export function keyPrefix(value: string) {
  return value.length <= 12 ? value : value.slice(0, 12);
}

export function signJsonPayload(
  secret: string,
  payload: string,
  timestamp = Date.now(),
) {
  const unixTimestamp = Math.floor(timestamp / 1000);
  const signature = hmacSha256Hex(secret, `${unixTimestamp}.${payload}`);

  return `t=${unixTimestamp},v1=${signature}`;
}
