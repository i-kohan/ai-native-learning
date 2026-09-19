const TOKEN_PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /ghu_[A-Za-z0-9]{20,}/g,
  /ghs_[A-Za-z0-9]{20,}/g,
  /ghr_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
];

export function collectSecretValues(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [env.GITHUB_TOKEN, env.GH_TOKEN]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function redactSecrets(
  text: string,
  secrets: string[] = collectSecretValues(),
): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) {
      out = out.split(secret).join("[redacted]");
    }
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

export function truncateEvidence(text: string, limit = 2000): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n...[truncated]`;
}
