// Strip private material from CLI output before it is logged. Public keys (32-byte ed25519, ~43-44 b58 chars) are kept.
export function redact(text) {
  if (text == null) return "";
  let s = String(text);
  s = s.replace(/"(private_key|secret_key|secret|seed_phrase)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"');
  s = s.replace(/\b(private_key|secret_key|seed phrase|seed_phrase)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
  // 64-byte NEAR secret keys encode to ~87-88 base58 chars; never log those.
  s = s.replace(/\bed25519:[1-9A-HJ-NP-Za-km-z]{50,}/g, "ed25519:[REDACTED]");
  return s;
}
