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
  'compatible_version', 'homepage', 'download', 'screenshots', 'requires', 'recommends', 'conflicts',
]);
const REQUIRED = ['name', 'title', 'category', 'version', 'added', 'last_updated', 'download'] as const;
/** The categories this directory allows. ModMenu itself shows any string, so forks may use their own. */
export const CATEGORIES = [
  'AI', 'Administration', 'Appearance', 'Collaboration', 'Fun', 'Integrations', 'Planning', 'Reporting', 'Time tracking',
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEP_FIELDS = new Set(['plugin', 'min_version', 'reason']);
const BARE_VERSION = /^\d+(\.\d+){0,3}$/;

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
    if (typeof version === 'string' && !BARE_VERSION.test(version)) {
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
    if (entry.conflicts !== undefined
        && (!Array.isArray(entry.conflicts) || entry.conflicts.some((c) => typeof c !== 'string' || c === ''))) {
      out.push(`${label}: conflicts: must be an array of plugin names`);
    }
  });
  return out;
}

/** Network checks for entries that passed checkShape. */
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
