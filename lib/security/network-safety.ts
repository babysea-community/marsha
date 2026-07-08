import { lookup } from 'node:dns/promises';

const LOCAL_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const DNS_LOOKUP_TIMEOUT_MS = 2_000;

export function isBlockedNetworkHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);

  if (LOCAL_HOSTNAMES.has(normalized) || normalized.endsWith('.localhost')) {
    return true;
  }

  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = ipv4FromMappedIpv6(normalized);
    return mappedIpv4 ? isBlockedIpv4Hostname(mappedIpv4) : true;
  }

  return isBlockedIpv4Hostname(normalized) || isBlockedIpv6Hostname(normalized);
}

export function normalizeHostname(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[(.*)]$/, '$1');
}

export async function lookupAllowedNetworkAddress(hostname: string) {
  try {
    const addresses = await lookupWithTimeout(normalizeHostname(hostname));

    if (
      addresses.length === 0 ||
      addresses.some((address) => isBlockedNetworkHostname(address.address))
    ) {
      return null;
    }

    return addresses[0] ?? null;
  } catch {
    return null;
  }
}

function lookupWithTimeout(hostname: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    lookup(hostname, {
      all: true,
      verbatim: true,
    }),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('DNS lookup timed out.')),
        DNS_LOOKUP_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function isBlockedIpv4Hostname(hostname: string) {
  const ipv4 = hostname.match(IPV4_PATTERN);

  if (!ipv4) {
    return false;
  }

  const parts = ipv4.slice(1).map(Number);

  if (parts.some((part) => part < 0 || part > 255)) {
    return true;
  }

  const [first = 0, second = 0, third = 0] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 &&
      (second === 0 ||
        second === 168 ||
        (second === 31 && third === 196) ||
        (second === 52 && third === 193) ||
        (second === 88 && third === 99) ||
        (second === 175 && third === 48))) ||
    (first === 198 &&
      (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isBlockedIpv6Hostname(hostname: string) {
  if (!hostname.includes(':')) {
    return false;
  }

  if (hostname === '::' || hostname === '::1' || hostname.startsWith('::')) {
    return true;
  }

  const hextets = hostname.split(':');
  const firstHextet = parseIpv6Word(hextets[0]);

  if (firstHextet === null) {
    return true;
  }

  if (firstHextet < 0x2000 || firstHextet > 0x3fff) {
    return true;
  }

  const secondHextet = parseIpv6Word(hextets[1]) ?? 0;
  const thirdHextet = parseIpv6Word(hextets[2]) ?? 0;

  return (
    firstHextet === 0x2002 ||
    firstHextet === 0x3fff ||
    (firstHextet === 0x2001 &&
      (secondHextet <= 0x01ff || secondHextet === 0x0db8)) ||
    (firstHextet === 0x2620 &&
      secondHextet === 0x004f &&
      thirdHextet === 0x8000)
  );
}

function ipv4FromMappedIpv6(hostname: string) {
  const suffix = hostname.slice('::ffff:'.length);

  if (suffix.includes('.')) {
    return IPV4_PATTERN.test(suffix) ? suffix : null;
  }

  const words = suffix.split(':');

  if (words.length !== 2) {
    return null;
  }

  const [highText, lowText] = words;
  const high = parseIpv6Word(highText);
  const low = parseIpv6Word(lowText);

  if (high === null || low === null) {
    return null;
  }

  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function parseIpv6Word(value: string | undefined) {
  if (!value || !/^[0-9a-f]{1,4}$/i.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 16);

  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0xffff
    ? parsed
    : null;
}
