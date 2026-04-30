import { describe, it, expect } from "vitest";
import {
  redactPII,
  maskEmail,
  maskPhone,
  maskSSN,
  maskIP,
  maskCard,
  maskGeneric,
  isPIIColumn,
  applyPatternMasks,
  DEFAULT_PII_COLUMNS,
  filterIntrospectionRows,
} from "../../src/security/redact.js";

const isPII = (col: string) => isPIIColumn(col, DEFAULT_PII_COLUMNS, []);

describe("redactPII - feature behaviour", () => {
  it("leaves non-PII data untouched", () => {
    const input = { id: 42, status: "active", count: 7 };
    expect(redactPII(input)).toEqual(input);
  });

  it("is a no-op for null / undefined / primitives", () => {
    expect(redactPII(null)).toBeNull();
    expect(redactPII(undefined)).toBeUndefined();
    expect(redactPII(0)).toBe(0);
    expect(redactPII(true)).toBe(true);
  });

  it("preserves Date instances without mutating them", () => {
    const d = new Date("2024-01-02T03:04:05Z");
    const out = redactPII({ created_at: d });
    expect(out.created_at).toBe(d);
  });

  it("does not touch Buffer payloads", () => {
    const buf = Buffer.from("hello");
    const out = redactPII({ blob: buf });
    expect(out.blob).toBe(buf);
  });
});

describe("regex-based masking", () => {
  it("masks email addresses (partial, keeps TLD)", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@e***.com");
    expect(applyPatternMasks("contact: jane@acme.io here")).toBe(
      "contact: j***@a***.io here",
    );
  });

  it("masks US phone numbers, preserving the last 4", () => {
    expect(maskPhone("call 415-555-0134")).toBe("call ***-***-0134");
    expect(maskPhone("+1 (415) 555-0134")).toBe("***-***-0134");
  });

  it("masks SSNs, preserving the last 4", () => {
    expect(maskSSN("ssn 123-45-6789")).toBe("ssn ***-**-6789");
  });

  it("masks IPv4 addresses, preserving the last octet", () => {
    expect(maskIP("client 192.168.1.42 connected")).toBe(
      "client ***.***.***.42 connected",
    );
  });

  it("masks Luhn-valid credit-card numbers", () => {
    // 4111 1111 1111 1111 is the Visa test PAN (Luhn valid).
    expect(maskCard("card 4111111111111111 on file")).toBe(
      "card ****-****-****-1111 on file",
    );
    expect(maskCard("spaced 4111 1111 1111 1111")).toBe(
      "spaced ****-****-****-1111",
    );
  });

  it("leaves Luhn-invalid digit runs alone (avoids false positives)", () => {
    // 16 digits that do not satisfy the Luhn checksum - should pass through.
    const input = "order id 1234567812345678";
    expect(maskCard(input)).toBe(input);
  });
});

describe("column-name heuristic", () => {
  it("detects standard PII column names case-insensitively", () => {
    expect(isPIIColumn("email")).toBe(true);
    expect(isPIIColumn("user_email")).toBe(true);
    expect(isPIIColumn("EmailAddr")).toBe(true);
    expect(isPIIColumn("first_name")).toBe(true);
    expect(isPIIColumn("SSN")).toBe(true);
    expect(isPIIColumn("password_hash")).toBe(true);
  });

  it("ignores non-PII column names", () => {
    expect(isPIIColumn("id")).toBe(false);
    expect(isPIIColumn("status")).toBe(false);
    expect(isPIIColumn("created_at")).toBe(false);
  });

  it("masks values from flagged columns even when no regex matches", () => {
    const out = redactPII({ full_name: "Ada Lovelace", id: 1 });
    expect(out.full_name).toBe("A********");
    expect(out.id).toBe(1);
  });

  it("prefers pattern masks over generic mask when the value matches a known shape", () => {
    const out = redactPII({ contact_email: "jane@acme.io" });
    expect(out.contact_email).toBe("j***@a***.io");
  });

  it("accepts a custom column list via options", () => {
    const input = { nickname: "ada", id: 1 };
    const out = redactPII(input, { columns: ["nickname"] });
    expect(out.nickname).toBe("a**");
    expect(out.id).toBe(1);
  });

  it("exports a non-empty default column list", () => {
    expect(DEFAULT_PII_COLUMNS.length).toBeGreaterThan(0);
    expect(DEFAULT_PII_COLUMNS).toContain("email");
  });
});

describe("extraColumns / columnPatterns options", () => {
  it("extraColumns extends the default list without replacing it", () => {
    const out = redactPII(
      { image_url: "https://cdn.example.com/foo.jpg", email: "a@b.co", id: 1 },
      { extraColumns: ["image_url"] },
    );
    // image_url is flagged via the extension and gets the generic mask.
    expect(out.image_url).toBe("h********");
    // Built-in heuristics still apply.
    expect(out.email).toBe("a***@b***.co");
    expect(out.id).toBe(1);
  });

  it("columnPatterns matches case-insensitively against the key", () => {
    const out = redactPII(
      { SIGNED_DOWNLOAD_URL: "https://cdn.example.com/foo", id: 1 },
      { columnPatterns: [/^signed_/i] },
    );
    // Key lowercases to "signed_download_url" which matches /^signed_/.
    expect(out.SIGNED_DOWNLOAD_URL).toBe("h********");
    expect(out.id).toBe(1);
  });

  it("columnPatterns honours anchors and alternation", () => {
    const out = redactPII(
      { protected_url: "x", public_url: "y", id: 1 },
      { columnPatterns: [/^(protected|secret)_url$/i] },
    );
    expect(out.protected_url).toBe("*"); // single char → single asterisk
    expect(out.public_url).toBe("y"); // unmatched → untouched
    expect(out.id).toBe(1);
  });

  it("extraColumns and columnPatterns combine via OR", () => {
    // Picks keys that do NOT hit any built-in substring ("token" would, for
    // example), so we can isolate the contributions of each option.
    const out = redactPII(
      { image_url: "foo", signed_blob: "bar", plain: "baz", id: 1 },
      {
        extraColumns: ["image_url"],
        columnPatterns: [/^signed_/i],
      },
    );
    expect(out.image_url).toBe("f**");
    expect(out.signed_blob).toBe("b**");
    expect(out.plain).toBe("baz");
    expect(out.id).toBe(1);
  });

  it("explicit `columns` overrides `extraColumns` but `columnPatterns` still applies", () => {
    const out = redactPII(
      { email: "a@b.co", signed_blob: "abc", id: 1 },
      {
        columns: ["does_not_match"],
        extraColumns: ["email"], // ignored because `columns` was provided
        columnPatterns: [/^signed_/i],
      },
    );
    // The email value regex still fires (pattern masking is independent of
    // the column list), so value-level masking still runs.
    expect(out.email).toBe("a***@b***.co");
    // `columns` replacement would have missed `signed_blob`, but the regex
    // layer still catches it.
    expect(out.signed_blob).toBe("a**");
    expect(out.id).toBe(1);
  });

  it("empty-string entry in extraColumns does NOT match every key", () => {
    // Without an empty-string filter in the parser / caller, an empty
    // substring would match every column name via `includes("")` and mask
    // the entire row. This guards the contract.
    const out = redactPII(
      { id: 1, status: "active", notes: "plain text" },
      { extraColumns: [""] },
    );
    expect(out.status).toBe("active");
    expect(out.notes).toBe("plain text");
    expect(out.id).toBe(1);
  });

  it("empty columnPatterns list is a no-op", () => {
    // `signed_blob` is chosen because it hits NO built-in heuristic, so if
    // this assertion fails we know the regex layer leaked.
    const input = { signed_blob: "keep me", id: 1 };
    expect(redactPII(input, { columnPatterns: [] })).toEqual(input);
  });
});

describe("generic mask", () => {
  it("keeps the first character and caps the masked tail at 8", () => {
    expect(maskGeneric("")).toBe("");
    expect(maskGeneric("a")).toBe("*");
    expect(maskGeneric("abc")).toBe("a**");
    expect(maskGeneric("abcdefghijk")).toBe("a********"); // capped to 8 stars
  });
});

describe("redactPII - nested structures", () => {
  it("walks arrays of row objects", () => {
    const rows = [
      { id: 1, email: "a@b.co", phone: "415-555-0134" },
      { id: 2, email: "c@d.io", phone: "212-555-9999" },
    ];
    const out = redactPII(rows);
    expect(out[0]).toEqual({
      id: 1,
      email: "a***@b***.co",
      phone: "***-***-0134",
    });
    expect(out[1]).toEqual({
      id: 2,
      email: "c***@d***.io",
      phone: "***-***-9999",
    });
  });

  it("walks nested objects and arrays", () => {
    const input = {
      user: {
        id: 1,
        profile: {
          email: "jane@acme.io",
          addresses: ["jane@acme.io reachable"],
        },
      },
    };
    const out = redactPII(input);
    expect(out.user.profile.email).toBe("j***@a***.io");
    expect(out.user.profile.addresses[0]).toBe("j***@a***.io reachable");
  });

  it("handles null values inside rows", () => {
    const rows = [{ id: 1, email: null, phone: null }];
    const out = redactPII(rows);
    expect(out[0]).toEqual({ id: 1, email: null, phone: null });
  });
});

describe("filterIntrospectionRows", () => {
  describe("SHOW COLUMNS / DESCRIBE shape (Field key)", () => {
    // The actual shape mysql2 returns for SHOW COLUMNS / DESCRIBE: each row
    // is keyed by `Field`, `Type`, `Null`, `Key`, `Default`, `Extra`. This
    // test pins behaviour against that exact shape.
    const rows = [
      { Field: "id", Type: "int", Null: "NO", Key: "PRI", Default: null, Extra: "auto_increment" },
      { Field: "email", Type: "varchar(255)", Null: "YES", Key: "", Default: null, Extra: "" },
      { Field: "first_name", Type: "varchar(128)", Null: "YES", Key: "", Default: null, Extra: "" },
      { Field: "registration_date", Type: "datetime", Null: "YES", Key: "", Default: null, Extra: "" },
      { Field: "last_name", Type: "varchar(128)", Null: "YES", Key: "", Default: null, Extra: "" },
    ];

    it("drops PII rows and keeps non-PII rows for kind=show_columns", () => {
      const out = filterIntrospectionRows(rows, "show_columns", isPII);
      expect(out).not.toBeNull();
      const fields = out!.map((r) => r.Field);
      expect(fields).toEqual(["id", "registration_date"]);
    });

    it("drops PII rows for kind=describe (same row shape)", () => {
      const out = filterIntrospectionRows(rows, "describe", isPII);
      expect(out!.map((r) => r.Field)).toEqual(["id", "registration_date"]);
    });

    it("preserves SHOW FULL COLUMNS extra fields (Collation/Privileges/Comment)", () => {
      // SHOW FULL COLUMNS adds keys but the `Field` key still drives the filter.
      const fullRows = rows.map((r) => ({
        ...r,
        Collation: null,
        Privileges: "select,insert,update,references",
        Comment: "",
      }));
      const out = filterIntrospectionRows(fullRows, "show_columns", isPII);
      expect(out).toHaveLength(2);
      expect(out![0]).toMatchObject({
        Field: "id",
        Privileges: "select,insert,update,references",
      });
    });
  });

  describe("SHOW INDEX / SHOW KEYS shape (Column_name key)", () => {
    // Real mysql2 shape from `SHOW INDEX FROM <table>`. Filter applies to
    // `Column_name` so rows that index a PII column are dropped — the
    // existence of the index would itself reveal the column name.
    const rows = [
      { Table: "u", Non_unique: 0, Key_name: "PRIMARY", Seq_in_index: 1, Column_name: "id", Index_type: "BTREE" },
      { Table: "u", Non_unique: 1, Key_name: "idx_email", Seq_in_index: 1, Column_name: "email", Index_type: "BTREE" },
      { Table: "u", Non_unique: 1, Key_name: "idx_first_name", Seq_in_index: 1, Column_name: "first_name", Index_type: "BTREE" },
    ];

    it("drops rows where Column_name is PII", () => {
      const out = filterIntrospectionRows(rows, "show_index", isPII);
      expect(out!.map((r) => r.Column_name)).toEqual(["id"]);
    });
  });

  describe("edge cases", () => {
    it("returns [] for an empty result (not null — empty is well-formed)", () => {
      expect(filterIntrospectionRows([], "show_columns", isPII)).toEqual([]);
      expect(filterIntrospectionRows([], "show_index", isPII)).toEqual([]);
    });

    it("returns null when the row shape lacks the expected key", () => {
      // Simulates an EXPLAIN <SELECT> result: the rows are well-formed
      // objects but have nothing resembling a `Field` column. Caller is
      // expected to fail closed and reject the query.
      const rows = [{ id: 1, select_type: "SIMPLE", table: "users" }];
      expect(filterIntrospectionRows(rows, "show_columns", isPII)).toBeNull();
    });

    it("returns null when input is not an array", () => {
      expect(
        filterIntrospectionRows(
          "not an array" as unknown as object[],
          "show_columns",
          isPII,
        ),
      ).toBeNull();
      expect(
        filterIntrospectionRows(
          { Field: "email" } as unknown as object[],
          "show_columns",
          isPII,
        ),
      ).toBeNull();
    });

    it("does case-insensitive matching on the row key", () => {
      // Some drivers/configs may lowercase column names. The filter must
      // still find the relevant key.
      const rows = [
        { field: "id", type: "int" },
        { field: "email", type: "varchar(255)" },
      ];
      const out = filterIntrospectionRows(rows, "show_columns", isPII);
      expect(out!.map((r) => r.field)).toEqual(["id"]);
    });

    it("does case-insensitive PII matching on the column value", () => {
      // `EMAIL` and `email` should both match the substring "email" rule.
      const rows = [
        { Field: "EMAIL_ADDRESS", Type: "varchar(255)" },
        { Field: "USER_ID", Type: "int" },
      ];
      const out = filterIntrospectionRows(rows, "show_columns", isPII);
      expect(out!.map((r) => r.Field)).toEqual(["USER_ID"]);
    });

    it("returns the array unchanged when no row matches the PII rule", () => {
      const rows = [
        { Field: "id", Type: "int" },
        { Field: "status", Type: "varchar(32)" },
      ];
      const out = filterIntrospectionRows(rows, "show_columns", isPII);
      expect(out).toEqual(rows);
    });
  });
});
