const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

export function redactSecrets(text: string, apiKey: string): string {
  let clean = text;
  const key = apiKey.trim();
  if (key) clean = clean.split(key).join("[redacted]");
  for (const pattern of SECRET_PATTERNS) {
    clean = clean.replace(pattern, "[redacted]");
  }
  return clean;
}
