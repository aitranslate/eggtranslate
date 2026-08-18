/** 多 Key 轮询时用来找回「创建该 transcript 的那一把」，避免 GET 404。 */
export function fingerprintApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return '';
  return `${key.length}:${key.slice(-8)}`;
}

export function findKeyByFingerprint(
  keys: string[],
  fingerprint: string | undefined
): string | undefined {
  if (!fingerprint) return undefined;
  return keys.find((k) => fingerprintApiKey(k) === fingerprint);
}

export function parseApiKeys(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split('|')
    .map((k) => k.trim())
    .filter(Boolean);
}
