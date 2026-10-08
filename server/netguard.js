import dns from 'node:dns/promises';
import net from 'node:net';

// Users supply arbitrary hosts, so the server could be abused to probe internal networks (SSRF).
// Resolve and reject loopback/private/link-local targets unless explicitly allowed.
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return isPrivate(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('ff');
}

export async function assertPublicHost(host, allowPrivate = process.env.ALLOW_PRIVATE_HOSTS === '1') {
  if (!host || typeof host !== 'string' || host.length > 253 || /[\s/@]/.test(host)) throw new Error('Invalid host');
  if (allowPrivate) return;
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error('Host resolves to a non-public address');
}
