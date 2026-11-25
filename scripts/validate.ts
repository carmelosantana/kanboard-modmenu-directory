// validate.ts — check plugins.json before ModMenu reads it.
//
//   node scripts/validate.ts            shape checks only (offline)
//   node scripts/validate.ts --online   also: each version is the repo's latest GitHub
//                                       release, last_updated is its UTC publish date,
//                                       and each download URL returns 200
//
// ModMenu silently ignores dependency entries in the wrong shape, so a typo here ships a
// plugin whose requirements are never enforced. Exits 1 with one line per problem.
// Zero dependencies: Node 22+ runs this TypeScript directly.

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<Response>;

const ENTRY_FIELDS = new Set([
  'title', 'name', 'category', 'author', 'description', 'version', 'added', 'last_updated',
  'compatible_version', 'homepage', 'download', 'sha256', 'screenshots', 'requires', 'recommends', 'conflicts',
  'replaces', 'deprecated',
]);
const REQUIRED = ['name', 'title', 'category', 'version', 'added', 'last_updated', 'download'] as const;
/** The categories this directory allows. ModMenu itself shows any string, so forks may use their own. */
export const CATEGORIES = [
  'AI', 'Administration', 'Appearance', 'Collaboration', 'Fun', 'Integrations', 'Planning', 'Reporting', 'Time tracking',
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEP_FIELDS = new Set(['plugin', 'min_version', 'reason']);
const DEPRECATED_FIELDS = new Set(['superseded_by', 'since', 'reason']);
const BARE_VERSION = /^\d+(\.\d+){0,3}$/;
// An entry's own version may be a numbered beta or release candidate; dependency min_version stays bare.
const RELEASE_VERSION = /^\d+(\.\d+){0,3}(-(beta|rc)\.\d+)?$/;

/** A YYYY-MM-DD string that names a day on the calendar (no 2026-02-30). */
const isRealDate = (d: string): boolean => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function checkDeps(label: string, key: string, deps: unknown, out: string[]): void {
  if (!Array.isArray(deps)) {
    out.push(`${label}: ${key}: must be an array of objects like {"plugin": "X", "min_version": "1.0.0"}`);
    return;
  }
  deps.forEach((dep, i) => {
    const at = `${label}: ${key}[${i}]`;
    if (!isObject(dep)) {
      out.push(`${at}: must be an object, not ${JSON.stringify(dep)}`);
      return;
    }
    for (const k of Object.keys(dep)) if (!DEP_FIELDS.has(k)) out.push(`${at}: unknown field "${k}"`);
    if (typeof dep.plugin !== 'string' || dep.plugin === '') out.push(`${at}.plugin: required string`);
    if (dep.min_version !== undefined && (typeof dep.min_version !== 'string' || !BARE_VERSION.test(dep.min_version))) {
      out.push(`${at}.min_version ${JSON.stringify(dep.min_version)} is not a bare version like "1.2.3"`);
    }
    if (dep.reason !== undefined && typeof dep.reason !== 'string') out.push(`${at}.reason: must be a string`);
  });
}

/** Offline checks. Returns one message per problem; empty means valid. */
export function checkShape(data: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(data)) return ['plugins.json: the top level must be an array of plugin objects'];
  const seen = new Set<string>();
  data.forEach((entry, i) => {
    if (!isObject(entry)) {
      out.push(`[${i}]: must be an object`);
      return;
    }
    const label = typeof entry.name === 'string' && entry.name !== '' ? entry.name : `[${i}]`;
    for (const k of Object.keys(entry)) if (!ENTRY_FIELDS.has(k)) out.push(`${label}: unknown field "${k}"`);
    for (const k of REQUIRED) {
      if (typeof entry[k] !== 'string' || entry[k] === '') out.push(`${label}: ${k}: required string`);
    }
    for (const k of ['author', 'description', 'homepage', 'compatible_version']) {
      if (entry[k] !== undefined && typeof entry[k] !== 'string') out.push(`${label}: ${k}: must be a string`);
    }
    if (typeof entry.name === 'string') {
      if (seen.has(entry.name)) out.push(`${label}: duplicate name`);
      seen.add(entry.name);
    }
    const { name, version, download, homepage } = entry;
    if (typeof version === 'string' && !RELEASE_VERSION.test(version)) {
      out.push(`${label}: version ${JSON.stringify(version)} is not a bare version like "1.2.3"`);
    }
    if (typeof download === 'string') {
      if (!download.startsWith('https://')) out.push(`${label}: download must be an https URL`);
      if (typeof name === 'string' && typeof version === 'string') {
        const tail = `/releases/download/v${version}/${name}-${version}.zip`;
        if (!download.endsWith(tail)) out.push(`${label}: download must end in ${tail}`);
      }
      if (typeof homepage === 'string' && !download.startsWith(`${homepage.replace(/\/$/, '')}/releases/download/`)) {
        out.push(`${label}: download is not a release of homepage ${homepage}`);
      }
    }
    if (entry.sha256 !== undefined && (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256))) {
      out.push(`${label}: sha256 must be 64 lowercase hex characters (the release zip's SHA-256)`);
    }
    if (typeof entry.category === 'string' && entry.category !== '' && !CATEGORIES.includes(entry.category)) {
      out.push(`${label}: category ${JSON.stringify(entry.category)} is not one of ${CATEGORIES.join(', ')}`);
    }
    const dates: Record<string, string> = {};
    for (const k of ['added', 'last_updated'] as const) {
      const d = entry[k];
      if (typeof d !== 'string' || d === '') continue;
      if (!DATE.test(d)) out.push(`${label}: ${k} ${JSON.stringify(d)} is not a date like "2026-11-20"`);
      else if (!isRealDate(d)) out.push(`${label}: ${k} ${JSON.stringify(d)} is not a real date`);
      else dates[k] = d;
    }
    if (dates.added && dates.last_updated && dates.added > dates.last_updated) {
      out.push(`${label}: added ${dates.added} is after last_updated ${dates.last_updated}`);
    }
    if (entry.screenshots !== undefined
        && (!Array.isArray(entry.screenshots) || entry.screenshots.some((s) => typeof s !== 'string'))) {
      out.push(`${label}: screenshots: must be an array of strings`);
    }
    for (const key of ['requires', 'recommends'] as const) {
      if (entry[key] !== undefined) checkDeps(label, key, entry[key], out);
    }
    if (entry.replaces !== undefined) {
      if (!Array.isArray(entry.replaces) || entry.replaces.some((r) => typeof r !== 'string' || r === '')) {
        out.push(`${label}: replaces: must be an array of plugin names`);
      } else if (entry.replaces.includes(entry.name)) {
        out.push(`${label}: replaces: cannot name itself`);
      }
    }
    if (entry.deprecated !== undefined) {
      const d = entry.deprecated;
      if (!isObject(d)) {
        out.push(`${label}: deprecated: must be an object like {"superseded_by": "X", "since": "1.3.0"}`);
      } else {
        for (const k of Object.keys(d)) if (!DEPRECATED_FIELDS.has(k)) out.push(`${label}: deprecated: unknown field "${k}"`);
        if (typeof d.superseded_by !== 'string' || d.superseded_by === '') out.push(`${label}: deprecated.superseded_by: required string`);
        else if (d.superseded_by === entry.name) out.push(`${label}: deprecated.superseded_by: cannot name itself`);
        if (typeof d.since !== 'string' || !BARE_VERSION.test(d.since)) out.push(`${label}: deprecated.since: required bare version like "1.3.0"`);
        if (d.reason !== undefined && typeof d.reason !== 'string') out.push(`${label}: deprecated.reason: must be a string`);
      }
    }
    if (entry.conflicts !== undefined
        && (!Array.isArray(entry.conflicts) || entry.conflicts.some((c) => typeof c !== 'string' || c === ''))) {
      out.push(`${label}: conflicts: must be an array of plugin names`);
    }
  });
  return out;
}

/** Network checks for entries that passed checkShape. */
/**
 * Offline: every `requires`/`recommends` `plugin`, `replaces` name and `deprecated.superseded_by` names an entry in plugins.json (exact, case-sensitive
 * `name`). ModMenu resolves dependencies by that name, so a working title or typo silently resolves to nothing.
 * Run it after checkShape passes; it skips entries whose dependency lists are malformed.
 */
export function checkDependencyNames(entries: Array<Record<string, any>>): string[] {
  const names = new Set(entries.map((e) => e.name));
  const out: string[] = [];
  for (const entry of entries) {
    for (const key of ['requires', 'recommends'] as const) {
      if (!Array.isArray(entry[key])) continue;
      entry[key].forEach((dep: any, i: number) => {
        if (isObject(dep) && typeof dep.plugin === 'string' && !names.has(dep.plugin)) {
          out.push(`${entry.name}: ${key}[${i}].plugin ${JSON.stringify(dep.plugin)} is not a plugin in plugins.json`);
        }
      });
    }
    if (Array.isArray(entry.replaces)) {
      entry.replaces.forEach((r: unknown, i: number) => {
        if (typeof r === 'string' && !names.has(r)) out.push(`${entry.name}: replaces[${i}] ${JSON.stringify(r)} is not a plugin in plugins.json`);
      });
    }
    const by = isObject(entry.deprecated) ? entry.deprecated.superseded_by : undefined;
    if (typeof by === 'string' && !names.has(by)) {
      out.push(`${entry.name}: deprecated.superseded_by ${JSON.stringify(by)} is not a plugin in plugins.json`);
    }
  }
  return out;
}

export async function checkOnline(entries: Array<Record<string, any>>, fetcher: Fetcher, token?: string): Promise<string[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'modmenu-directory-ci' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const results = await Promise.all(entries.map(async (e): Promise<string[]> => {
    const out: string[] = [];
    const repo = String(e.homepage ?? '').match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)\/?$/);
    if (!repo) {
      out.push(`${e.name}: homepage is not a github.com repository, so its latest release can't be checked`);
    } else {
      const res = await fetcher(`https://api.github.com/repos/${repo[1]}/releases/latest`, { headers });
      if (res.status !== 200) {
        out.push(`${e.name}: latest release lookup returned ${res.status}`);
      } else {
        const release = (await res.json()) as { tag_name?: string; published_at?: string };
        const tag = String(release.tag_name ?? '');
        if (tag !== `v${e.version}`) {
          out.push(`${e.name}: lists ${e.version} but the latest GitHub release is ${tag}`);
        } else {
          const published = String(release.published_at ?? '').slice(0, 10);
          if (published === '') out.push(`${e.name}: ${tag} has no published_at`);
          else if (published !== e.last_updated) out.push(`${e.name}: last_updated is ${e.last_updated} but ${tag} was published ${published}`);
        }
      }
    }
    const dl = await fetcher(e.download, { method: 'HEAD', headers: { 'User-Agent': 'modmenu-directory-ci' } });
    if (dl.status !== 200) out.push(`${e.name}: download returned ${dl.status} (${e.download})`);
    else if (typeof e.sha256 === 'string') {
      const zip = await fetcher(e.download, { headers: { 'User-Agent': 'modmenu-directory-ci' } });
      const { createHash } = await import('node:crypto');
      const actual = createHash('sha256').update(new Uint8Array(await zip.arrayBuffer())).digest('hex');
      if (zip.status !== 200) out.push(`${e.name}: sha256 check: download returned ${zip.status}`);
      else if (actual !== e.sha256) out.push(`${e.name}: sha256 is ${e.sha256} but the download hashes to ${actual}`);
    }
    return out;
  }));
  return results.flat();
}

async function main(): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const file = new URL('../plugins.json', import.meta.url);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`plugins.json: not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
  const problems = checkShape(data);
  if (problems.length === 0) problems.push(...checkDependencyNames(data as Array<Record<string, any>>));
  if (problems.length === 0 && process.argv.includes('--online')) {
    const fetcher: Fetcher = (url, init) => fetch(url, { ...init, redirect: 'follow' });
    problems.push(...await checkOnline(data as Array<Record<string, any>>, fetcher, process.env.GITHUB_TOKEN));
  }
  const count = Array.isArray(data) ? data.length : 0;
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error file=plugins.json::${p}`);
    console.error(`${problems.length} problem(s) in ${count} entries`);
    process.exit(1);
  }
  console.log(`plugins.json OK: ${count} entries${process.argv.includes('--online') ? ', versions and downloads checked' : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
