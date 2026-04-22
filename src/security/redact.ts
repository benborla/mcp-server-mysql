/**
 * PII redaction utilities.
 *
 * Activated via the ENABLE_PII_REDACTION environment variable. When enabled,
 * values returned from read-only query results are recursively walked and
 * sensitive fields are replaced with shape-preserving partial masks.
 *
 * Detection combines two strategies:
 *   1. Column-name heuristics - if an object key contains one of the known
 *      sensitive substrings (case-insensitive), the string value is masked.
 *   2. Regex value scanning - every string value is scanned for well-known
 *      PII patterns (email, phone, SSN, IPv4, credit card) and matches are
 *      replaced in-place regardless of column name. Credit-card matches are
 *      gated by a Luhn check to reduce false positives.
 */

/**
 * Default substrings matched (case-insensitive) against object keys to flag a
 * field as PII. Matching is substring-based so "user_email" and "EmailAddr"
 * both match "email".
 */
export const DEFAULT_PII_COLUMNS: readonly string[] = [
  "email",
  "e_mail",
  "ssn",
  "social_security",
  "phone",
  "mobile",
  "first_name",
  "last_name",
  "full_name",
  "middle_name",
  "address",
  "street",
  "zip",
  "postal_code",
  "dob",
  "date_of_birth",
  "credit_card",
  "card_number",
  "cc_number",
  "cvv",
  "password",
  "passwd",
  "pwd",
  "api_key",
  "secret",
  "token",
  "ip_address",
  "ipaddress",
];

const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-])[A-Za-z0-9.-]*\.([A-Za-z]{2,})/g;
const SSN_RE = /(?<!\d)\d{3}-\d{2}-(\d{4})(?!\d)/g;
// Negative look-around lets the regex capture a leading "+1" prefix without
// relying on word boundaries, which fail when the preceding char is "+".
const US_PHONE_RE =
  /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?(\d{4})(?!\d)/g;
const IPV4_RE = /(?<!\d)(?:\d{1,3}\.){3}(\d{1,3})(?!\d)/g;
// Credit card: 13-19 digits optionally separated by spaces or hyphens every
// 4 digits. Luhn-verified before masking to avoid clobbering innocuous ids.
const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

/** Partially mask an email: keeps first local char, first domain char, TLD. */
export function maskEmail(value: string): string {
  return value.replace(
    EMAIL_RE,
    (_m, local: string, domain: string, tld: string) =>
      `${local}***@${domain}***.${tld}`,
  );
}

/** Partially mask a US-style phone number, preserving the last 4 digits. */
export function maskPhone(value: string): string {
  return value.replace(US_PHONE_RE, (_m, last4: string) => `***-***-${last4}`);
}

/** Partially mask an SSN (NNN-NN-NNNN), preserving the last 4 digits. */
export function maskSSN(value: string): string {
  return value.replace(SSN_RE, (_m, last4: string) => `***-**-${last4}`);
}

/** Partially mask an IPv4 address, preserving the last octet. */
export function maskIP(value: string): string {
  return value.replace(IPV4_RE, (_m, last: string) => `***.***.***.${last}`);
}

/** Luhn check used to gate credit-card masking. */
function isLuhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const code = digits.charCodeAt(i);
    if (code < 48 || code > 57) return false;
    let n = code - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Partially mask Luhn-valid credit-card numbers, preserving the last 4 digits
 * and normalising to the `****-****-****-NNNN` shape.
 */
export function maskCard(value: string): string {
  return value.replace(CARD_RE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (!isLuhnValid(digits)) return match;
    const last4 = digits.slice(-4);
    return `****-****-****-${last4}`;
  });
}

/**
 * Generic mask used when a column-name heuristic hits but no specific regex
 * pattern matched. Keeps the first character and replaces the rest with `*`,
 * capped at 8 asterisks so very long values do not balloon.
 */
export function maskGeneric(value: string): string {
  if (value.length === 0) return value;
  if (value.length === 1) return "*";
  const keep = value.slice(0, 1);
  const tailLen = Math.min(value.length - 1, 8);
  return keep + "*".repeat(tailLen);
}

/** Apply all regex-based masks to a string in a deterministic order. */
export function applyPatternMasks(value: string): string {
  let out = value;
  out = maskEmail(out);
  out = maskCard(out);
  out = maskSSN(out);
  out = maskPhone(out);
  out = maskIP(out);
  return out;
}

/** Return true if a column/key name hits any configured PII substring. */
export function isPIIColumn(
  key: string,
  columns: readonly string[] = DEFAULT_PII_COLUMNS,
): boolean {
  const lower = key.toLowerCase();
  for (const needle of columns) {
    if (lower.includes(needle)) return true;
  }
  return false;
}

/**
 * Mask a value matched by column-name heuristic. Tries specific pattern masks
 * first so "email" columns produce `j***@e***.com` rather than plain generic
 * output; falls back to a generic mask when no pattern fits.
 */
function maskByColumn(value: string): string {
  const patternMasked = applyPatternMasks(value);
  if (patternMasked !== value) return patternMasked;
  return maskGeneric(value);
}

export interface RedactOptions {
  columns?: readonly string[];
}

/**
 * Recursively walk arrays/objects and redact detected PII in place (returning
 * a new structure). Non-string, non-container values are left untouched.
 */
export function redactPII<T>(value: T, options: RedactOptions = {}): T {
  const columns = options.columns ?? DEFAULT_PII_COLUMNS;
  return walk(value, columns, false) as T;
}

function walk(value: unknown, columns: readonly string[], parentIsPII: boolean): unknown {
  if (value == null) return value;

  if (typeof value === "string") {
    return parentIsPII ? maskByColumn(value) : applyPatternMasks(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, columns, parentIsPII));
  }

  if (typeof value === "object") {
    // Preserve special objects (Date, Buffer) without descending into them.
    if (value instanceof Date) return value;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const keyIsPII = isPIIColumn(key, columns);
      out[key] = walk(child, columns, keyIsPII);
    }
    return out;
  }

  return value;
}
