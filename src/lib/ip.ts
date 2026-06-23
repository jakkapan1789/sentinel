/** Return the first two octets of an IP / CIDR, e.g. "172.27.10.25/24" -> "172.27". */
export function getIpPrefix(ipAddress: string): string {
  const parts = ipAddress.trim().replace(/\/\d+$/, '').split('.');
  if (parts.length < 2 || !parts[0] || !parts[1]) return '';
  return `${parts[0]}.${parts[1]}`;
}

const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/([0-9]|[1-2][0-9]|3[0-2]))?$/;

/** Loose IPv4 / CIDR validity check used by the whitelist form. */
export function isValidIpOrCidr(value: string): boolean {
  const match = value.trim().match(IPV4_CIDR);
  if (!match) return false;
  return match.slice(1, 5).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
}

export function isPrivateIp(value: string): boolean {
  const v = value.trim();
  return (
    v.startsWith('10.') ||
    v.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(v)
  );
}
