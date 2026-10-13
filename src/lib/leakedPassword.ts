/**
 * Whether a password shows up in Have I Been Pwned's list of leaked passwords.
 * Only the first 5 characters of its SHA-1 leave the device (k-anonymity), and
 * the padding keeps the size of the answer from giving the prefix away. Errors
 * and slow answers count as "not found": an outage there must never stop anyone
 * from signing up.
 */
export async function isLeakedPassword(password: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    // One SUFFIX:COUNT per line; the padding lines have a count of 0.
    return (await response.text()).split('\n').some((line) => {
      const [candidate, count] = line.trim().split(':');
      return candidate.toUpperCase() === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
