# PII Redaction

Enable with `ENABLE_PII_REDACTION=true`. Masks likely PII in read-only query results before returning them.

## How It Works

Detection combines:
- Built-in column name list: `email`, `ssn`, `phone`, `first_name`, `address`, `credit_card`, `password`, `api_key`, `token`, etc.
- Regex scanning of values: email, US phone, SSN, IPv4, Luhn-valid credit card numbers

### Mask Examples

| Input | Output |
|---|---|
| `jane.doe@example.com` | `j***@e***.com` |
| `415-555-0134` | `***-***-0134` |
| `123-45-6789` | `***-**-6789` |
| `4111 1111 1111 1111` | `****-****-****-1111` |
| `192.168.1.42` | `***.***.***.42` |
| Generic PII column value | `J********` (first char + up to 8 asterisks) |

Value-level pattern masks run first, so a column matching the heuristic whose value contains an email gets the richer email mask.

Redaction only runs on read-only query results. Schema/table listing and write-operation summaries are unaffected.

## Extending Column Detection

Both vars require `ENABLE_PII_REDACTION=true` and are additive to the built-in list.

**`PII_EXTRA_COLUMNS`** — comma-separated substrings, case-insensitive, matched against lowercased column name:

```bash
PII_EXTRA_COLUMNS=image_url,signed_url,internal_note
```

**`PII_EXTRA_COLUMN_PATTERNS`** — semicolon-separated JS regex bodies (no `/` delimiters, compiled with `i` flag):

```bash
PII_EXTRA_COLUMN_PATTERNS=^(signed|protected)_.*;^.*_token$
```

Use patterns when a substring match is too broad — anchors, alternation, character classes, etc. Invalid patterns are logged to stderr and skipped.

A column is flagged if it matches ANY built-in substring OR any `PII_EXTRA_COLUMNS` substring OR any `PII_EXTRA_COLUMN_PATTERNS` regex.

## Hardening Guards

When `ENABLE_PII_REDACTION=true`, three additional pre-execution guards activate:

### `PII_ALLOW_SELECT_STAR` (default: `false`)
Rejects queries with `SELECT *` or `t.*`. Forces explicit column projection so PII columns can't slip through via wildcard. `COUNT(*)` and aggregates are unaffected.

Set `true` to allow wildcards (value-level redactor still runs).

### `PII_ALLOW_REFERENCES` (default: `false`)
Rejects any query referencing a PII-matched column — in projection, `WHERE`, `JOIN ON`, `GROUP BY`, `HAVING`, `ORDER BY`, subqueries, CTEs, `INSERT ... SELECT`. Closes the alias bypass (`SELECT CONCAT(first_name, ' ', last_name) AS NAME` would otherwise return cleartext). Error message names the offending column(s) so the LLM can self-correct.

Set `true` to disable (e.g. for ETL pipelines that legitimately need PII columns).

### `PII_ALLOW_INTROSPECTION` (default: `false`)
Controls schema introspection behavior:

- **Filtered** (runs, PII rows dropped): `SHOW COLUMNS`, `SHOW FULL COLUMNS`, `SHOW FIELDS`, `DESCRIBE`, `DESC`, `EXPLAIN <table>`, `SHOW INDEX`, `SHOW INDEXES`, `SHOW KEYS`
- **Pass-through** (runs unchanged): `SHOW TABLES`, `SHOW TABLE STATUS`, `SHOW DATABASES`, `SHOW SCHEMAS`, `SHOW CHARACTER SET`, `SHOW COLLATION`
- **Rejected**: `SHOW CREATE TABLE`, `SHOW CREATE VIEW`, `SELECT` on `information_schema` or `mysql`

Use `SHOW COLUMNS` / `DESCRIBE` or the `mysql://tables/{name}` MCP resource instead of `SHOW CREATE TABLE`.

Set `true` to bypass entirely and return raw results.

### `PII_BLOCK_INTROSPECTION` (default: `false`)
Stricter mode — hard-blocks ALL introspection statements including the pass-through kinds above. Matches pre-2.0.3 behavior. Ignored when `PII_ALLOW_INTROSPECTION=true`.

## Known Limitations

- **Column aliases** (when `PII_ALLOW_REFERENCES=true`): `SELECT first_name AS fn` returns key `fn`, bypassing column-name heuristic. Leave `PII_ALLOW_REFERENCES=false` to prevent this.
- **Numeric-typed PII**: SSNs/phones stored as `BIGINT`/`INT` pass through — walker only inspects string values.
- **JSON columns**: Regex-visible PII inside JSON strings (emails, phones, etc.) is masked, but nested fields like `first_name` inside JSON are not.
- **International formats**: IPv6, non-US phones (E.164 `+44…`), IBANs, EU national IDs, international postal codes — not redacted.
- **Non-Luhn card numbers**: 13–19 digit runs failing Luhn check are left alone (intentional, to avoid clobbering order IDs).
- **`SHOW CREATE TABLE` / `information_schema` SELECTs**: Rejected by default. Use `SHOW COLUMNS` or the MCP resource instead.
- **Filtered introspection leaks column count/types** of non-PII columns — by design (discovery is the point).
- **Write-operation summaries**: `Insert successful…` strings are not scanned.
- **Binary/Buffer payloads and Date instances**: Passed through as-is; embedded PII not inspected.
