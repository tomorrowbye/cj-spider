import { parseDateTime } from '../article-repository.ts';

/** Run with pnpm test:parse-datetime. */

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
