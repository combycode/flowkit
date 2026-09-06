#!/usr/bin/env bun
/* `bun audit`, with accepted risks that expire.
 *
 * A bare `--ignore` silences an advisory for ever: nobody revisits it, and the
 * gate quietly stops meaning anything. An acceptance recorded here has to say
 * WHY it is safe and WHEN it stops being accepted, and the gate turns red on
 * that date whether or not anyone remembered.
 *
 * An acceptance is only ever the right answer for an advisory we cannot reach.
 * Everything else gets upgraded.
 */

interface Advisory {
  id: number;
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
}

interface Accepted {
  /** The GHSA identifier, as it appears in the advisory URL. */
  id: string;
  package: string;
  /** Why this cannot hurt us. Not "low severity" — why it is UNREACHABLE. */
  because: string;
  /** After this date the gate fails again. Pick the date the fix becomes
   *  installable, not a date far away. */
  until: string;
}

const ACCEPTED: Accepted[] = [
  {
    id: 'GHSA-x5fp-wj9c-mxmx',
    package: 'qs',
    because:
      'qs arrives under @modelcontextprotocol/sdk through express and body-parser, which the ' +
      'SDK ships for its HTTP and SSE transports. This server connects over StdioServerTransport ' +
      'and never constructs them, and the studio server is Bun.serve rather than express — so no ' +
      'query string reaches qs in any process we run.',
    // qs 6.16.0 fixes it and was published 2026-08-29; the 14-day install
    // cooldown in bunfig.toml clears it on the 12th.
    until: '2026-09-12',
  },
  {
    id: 'GHSA-4mjr-xmp4-gh2g',
    package: 'qs',
    because: 'Same dependency and the same unreachable path.',
    until: '2026-09-12',
  },
  // fast-uri parses URIs for ajv's $ref resolution. Every one of these is a
  // confusion or forgery issue: they matter when something takes the parsed
  // authority and CONNECTS to it. ajv resolves schema references and never
  // fetches unless given a loadSchema hook, the SDK does not give it one, and
  // this server does not construct the SDK's ajv validator at all.
  //
  // fast-uri 3.1.6 fixes them and was published 2026-08-23; the 14-day install
  // cooldown clears it on the 6th. Four days, on a path nothing walks.
  {
    id: 'GHSA-5jgf-p345-68v8',
    package: 'fast-uri',
    because: 'ajv $ref resolution only; nothing fetches the parsed URI.',
    until: '2026-09-06',
  },
  {
    id: 'GHSA-f65p-4m7j-42xc',
    package: 'fast-uri',
    because: 'Same dependency, same unreachable path.',
    until: '2026-09-06',
  },
  {
    id: 'GHSA-fph4-wmhf-6fwf',
    package: 'fast-uri',
    because: 'Same dependency, same unreachable path.',
    until: '2026-09-06',
  },
  {
    id: 'GHSA-jqff-g426-hqxp',
    package: 'fast-uri',
    because: 'Same dependency, same unreachable path.',
    until: '2026-09-06',
  },
];

const proc = Bun.spawn(['bun', 'audit', '--json'], { stdout: 'pipe', stderr: 'pipe' });
const out = await new Response(proc.stdout).text();
await proc.exited;

let report: Record<string, Advisory[]>;
try {
  report = JSON.parse(out.trim() || '{}') as Record<string, Advisory[]>;
} catch {
  console.error(out || 'bun audit produced nothing to read.');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const expired = ACCEPTED.filter((a) => a.until < today);
const unaccepted: { pkg: string; advisory: Advisory }[] = [];
let accepted = 0;

for (const [pkg, advisories] of Object.entries(report)) {
  for (const advisory of advisories) {
    const match = ACCEPTED.find((a) => advisory.url.endsWith(a.id) && a.package === pkg);
    if (match && match.until >= today) accepted++;
    else unaccepted.push({ pkg, advisory });
  }
}

for (const { pkg, advisory } of unaccepted) {
  console.error(`${advisory.severity.toUpperCase()}  ${pkg}  ${advisory.title}`);
  console.error(`   affects ${advisory.vulnerable_versions}`);
  console.error(`   ${advisory.url}\n`);
}

for (const a of expired) {
  console.error(
    `ACCEPTANCE EXPIRED  ${a.package}  ${a.id} (accepted until ${a.until})\n` +
      '   The fix should be installable now. Upgrade and remove the acceptance ' +
      'from tools/audit.ts.\n',
  );
}

if (unaccepted.length > 0 || expired.length > 0) {
  console.error(
    `${unaccepted.length} unaccepted advisor${unaccepted.length === 1 ? 'y' : 'ies'}` +
      `${expired.length > 0 ? `, ${expired.length} expired acceptance(s)` : ''}.`,
  );
  process.exit(1);
}

console.log(
  accepted === 0
    ? 'No known vulnerabilities.'
    : `No unaccepted vulnerabilities. ${accepted} accepted as unreachable — see tools/audit.ts.`,
);
