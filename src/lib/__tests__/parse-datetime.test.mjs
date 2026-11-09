/**
 * Lightweight parseDateTime checks (no test runner in package.json).
 * Run: node src/lib/__tests__/parse-datetime.test.mjs
 * Mirrors the logic in src/lib/supabase.ts — keep in sync when changing parseDateTime.
 */
function parseDateTime(dateStr) {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasTimezone) {
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return new Date(
      `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`,
    ).toISOString();
  }
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(`${year}-${month}-${day}T00:00:00+08:00`).toISOString();
  }
  return null;
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    console.error("FAIL", label, "\n  got     ", actual, "\n  expected", expected);
    process.exitCode = 1;
  } else {
    console.log("OK", label);
  }
}

// Beijing wall clock -> true UTC
assertEq(
  parseDateTime("2026-04-10 21:46:24"),
  "2026-04-10T13:46:24.000Z",
  "space-separated BJ -> UTC",
);
assertEq(
  parseDateTime("2026-04-10T21:46:24"),
  "2026-04-10T13:46:24.000Z",
  "T-separated no offset BJ -> UTC",
);
assertEq(
  parseDateTime("2026-11-05 19:30:04"),
  "2026-11-05T11:30:04.000Z",
  "evening BJ -> UTC same day",
);
assertEq(
  parseDateTime("2026-04-10T13:46:24.000Z"),
  "2026-04-10T13:46:24.000Z",
  "already Z kept as UTC",
);
assertEq(
  parseDateTime("2026-04-10T21:46:24+08:00"),
  "2026-04-10T13:46:24.000Z",
  "explicit +08:00",
);
assertEq(parseDateTime(""), null, "empty");
assertEq(parseDateTime(null), null, "nullish");

if (!process.exitCode) console.log("All parseDateTime checks passed");
