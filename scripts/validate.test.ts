import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkShape, checkOnline, CATEGORIES, type Fetcher } from './validate.ts';

const good = () => ({
  title: 'Demo',
  name: 'Demo',
  category: 'Planning',
  author: 'A',
  description: 'd',
  version: '1.2.3',
  added: '2026-01-15',
  last_updated: '2026-02-01',
  compatible_version: '>=1.2.47',
  homepage: 'https://github.com/acme/kanboard-demo',
  download: 'https://github.com/acme/kanboard-demo/releases/download/v1.2.3/Demo-1.2.3.zip',
  screenshots: ['assets/demo/1.webp'],
  requires: [{ plugin: 'Other', min_version: '1.0.0', reason: 'r' }],
  recommends: [{ plugin: 'Third' }],
  conflicts: ['Fourth'],
});

test('the real plugins.json passes the shape check', () => {
  const entries = JSON.parse(readFileSync(new URL('../plugins.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkShape(entries), []);
});

test('a well-formed entry passes', () => {
  assert.deepEqual(checkShape([good()]), []);
});

test('the top level must be an array', () => {
  assert.match(checkShape({ plugins: [] }).join('\n'), /top level must be an array/);
});

const cases: Array<[string, (e: any) => void, RegExp]> = [
  ['missing name', (e) => delete e.name, /\[0\]: name: required string/],
  ['missing download', (e) => delete e.download, /Demo: download: required string/],
  ['unknown field', (e) => (e.requirez = []), /Demo: unknown field "requirez"/],
  ['version with a range', (e) => (e.version = '>=1.2.3'), /Demo: version ">=1.2.3" is not a bare version/],
  ['a -dev version', (e) => (e.version = '2.0.0-dev'), /Demo: version "2\.0\.0-dev" is not a bare version/],
  ['a pre-release without a number', (e) => (e.version = '2.0.0-beta'), /Demo: version "2\.0\.0-beta" is not a bare version/],
  ['a pre-release min_version', (e) => (e.requires[0].min_version = '1.0.0-beta.1'), /Demo: requires\[0\]\.min_version "1\.0\.0-beta\.1" is not a bare version/],
  ['requires as an object', (e) => (e.requires = { Other: '1.0.0' }), /Demo: requires: must be an array of objects/],
  ['requires as strings', (e) => (e.requires = ['Other']), /Demo: requires\[0\]: must be an object/],
  ['recommends missing plugin', (e) => (e.recommends = [{ min_version: '1.0.0' }]), /Demo: recommends\[0\]\.plugin: required string/],
  ['min_version with a range', (e) => (e.requires[0].min_version = '>=1.0.0'), /Demo: requires\[0\]\.min_version ">=1.0.0" is not a bare version/],
  ['unknown dependency key', (e) => (e.requires[0].version = '1.0.0'), /Demo: requires\[0\]: unknown field "version"/],
  ['conflicts as objects', (e) => (e.conflicts = [{ plugin: 'X' }]), /Demo: conflicts: must be an array of plugin names/],
  ['download not matching the version', (e) => (e.version = '1.2.4'), /Demo: download must end in \/releases\/download\/v1\.2\.4\/Demo-1\.2\.4\.zip/],
  ['download outside homepage', (e) => (e.homepage = 'https://github.com/acme/other'), /Demo: download is not a release of homepage/],
  ['missing category', (e) => delete e.category, /Demo: category: required string/],
  ['category outside the set', (e) => (e.category = 'Games'), /Demo: category "Games" is not one of AI, Administration, /],
  ['missing added', (e) => delete e.added, /Demo: added: required string/],
  ['missing last_updated', (e) => delete e.last_updated, /Demo: last_updated: required string/],
  ['added not YYYY-MM-DD', (e) => (e.added = '2026-1-15'), /Demo: added "2026-1-15" is not a date like "2026-11-20"/],
  ['last_updated with a time', (e) => (e.last_updated = '2026-02-01T00:00:00Z'), /Demo: last_updated "2026-02-01T00:00:00Z" is not a date like "2026-11-20"/],
  ['an impossible date', (e) => (e.last_updated = '2026-02-30'), /Demo: last_updated "2026-02-30" is not a real date/],
  ['added after last_updated', (e) => (e.added = '2026-03-01'), /Demo: added 2026-03-01 is after last_updated 2026-02-01/],
  ['screenshots as a string', (e) => (e.screenshots = 'a.webp'), /Demo: screenshots: must be an array of strings/],
];
for (const [label, mutate, expected] of cases) {
  test(`rejects ${label}`, () => {
    const e = good();
    mutate(e);
    assert.match(checkShape([e]).join('\n'), expected);
  });
}

for (const version of ['2.0.0-beta.1', '2.0.0-rc.2']) {
  test(`accepts the pre-release version ${version}`, () => {
    const e = good();
    e.version = version;
    e.download = `https://github.com/acme/kanboard-demo/releases/download/v${version}/Demo-${version}.zip`;
    assert.deepEqual(checkShape([e]), []);
  });
}

test('the category set is the documented one', () => {
  assert.deepEqual(CATEGORIES, ['AI', 'Administration', 'Appearance', 'Collaboration', 'Fun', 'Integrations', 'Planning', 'Reporting', 'Time tracking']);
});

test('accepts every category in the set', () => {
  for (const category of CATEGORIES) assert.deepEqual(checkShape([{ ...good(), category }]), [], category);
});

test('added equal to last_updated passes', () => {
  assert.deepEqual(checkShape([{ ...good(), added: '2026-02-01' }]), []);
});

test('rejects a duplicate name', () => {
  assert.match(checkShape([good(), good()]).join('\n'), /Demo: duplicate name/);
});

// Online checks with a fake fetch.
const fakeFetch = (routes: Record<string, { status: number; body?: unknown }>): Fetcher =>
  async (url, init) => {
    const r = routes[`${init?.method ?? 'GET'} ${url}`];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };

const latest = 'GET https://api.github.com/repos/acme/kanboard-demo/releases/latest';
const zip = 'HEAD https://github.com/acme/kanboard-demo/releases/download/v1.2.3/Demo-1.2.3.zip';

test('online: version is the latest release and the zip returns 200', async () => {
  const f = fakeFetch({ [latest]: { status: 200, body: { tag_name: 'v1.2.3', published_at: '2026-02-01T21:30:00Z' } }, [zip]: { status: 200 } });
  assert.deepEqual(await checkOnline([good()], f), []);
});

test('online: a newer release than the listed version fails', async () => {
  const f = fakeFetch({ [latest]: { status: 200, body: { tag_name: 'v1.2.4', published_at: '2026-03-01T00:00:00Z' } }, [zip]: { status: 200 } });
  const problems = await checkOnline([good()], f);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Demo: lists 1\.2\.3 but the latest GitHub release is v1\.2\.4/);
  assert.doesNotMatch(problems[0], /last_updated/);
});

test('online: a download that is not 200 fails', async () => {
  const f = fakeFetch({ [latest]: { status: 200, body: { tag_name: 'v1.2.3' } }, [zip]: { status: 404 } });
  assert.match((await checkOnline([good()], f)).join('\n'), /Demo: download returned 404/);
});

test('online: a repo with no readable latest release fails', async () => {
  const f = fakeFetch({ [zip]: { status: 200 } });
  assert.match((await checkOnline([good()], f)).join('\n'), /Demo: latest release lookup returned 404/);
});

test('online: last_updated must be the release publish date (UTC)', async () => {
  const f = fakeFetch({ [latest]: { status: 200, body: { tag_name: 'v1.2.3', published_at: '2026-02-02T01:00:00Z' } }, [zip]: { status: 200 } });
  assert.match((await checkOnline([good()], f)).join('\n'), /Demo: last_updated is 2026-02-01 but v1\.2\.3 was published 2026-02-02/);
});

test('online: a matching release without published_at is reported plainly', async () => {
  const f = fakeFetch({ [latest]: { status: 200, body: { tag_name: 'v1.2.3' } }, [zip]: { status: 200 } });
  assert.deepEqual(await checkOnline([good()], f), ['Demo: v1.2.3 has no published_at']);
});
