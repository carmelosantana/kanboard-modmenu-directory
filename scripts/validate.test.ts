import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkShape, checkOnline, type Fetcher } from './validate.ts';

const good = () => ({
  title: 'Demo',
  name: 'Demo',
  author: 'A',
  description: 'd',
  version: '1.2.3',
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
  ['requires as an object', (e) => (e.requires = { Other: '1.0.0' }), /Demo: requires: must be an array of objects/],
  ['requires as strings', (e) => (e.requires = ['Other']), /Demo: requires\[0\]: must be an object/],
  ['recommends missing plugin', (e) => (e.recommends = [{ min_version: '1.0.0' }]), /Demo: recommends\[0\]\.plugin: required string/],
  ['min_version with a range', (e) => (e.requires[0].min_version = '>=1.0.0'), /Demo: requires\[0\]\.min_version ">=1.0.0" is not a bare version/],
  ['unknown dependency key', (e) => (e.requires[0].version = '1.0.0'), /Demo: requires\[0\]: unknown field "version"/],
  ['conflicts as objects', (e) => (e.conflicts = [{ plugin: 'X' }]), /Demo: conflicts: must be an array of plugin names/],
  ['download not matching the version', (e) => (e.version = '1.2.4'), /Demo: download must end in \/releases\/download\/v1\.2\.4\/Demo-1\.2\.4\.zip/],
  ['download outside homepage', (e) => (e.homepage = 'https://github.com/acme/other'), /Demo: download is not a release of homepage/],
  ['screenshots as a string', (e) => (e.screenshots = 'a.webp'), /Demo: screenshots: must be an array of strings/],
];
for (const [label, mutate, expected] of cases) {
  test(`rejects ${label}`, () => {
    const e = good();
    mutate(e);
    assert.match(checkShape([e]).join('\n'), expected);
  });
}

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
  const f = fakeFetch({ [latest]: { status: 200, body: { tag_name: 'v1.2.3' } }, [zip]: { status: 200 } });
  assert.deepEqual(await checkOnline([good()], f), []);
});

test('online: a newer release than the listed version fails', async () => {
  const f = fakeFetch({ [latest]: { status: 200, body: { tag_name: 'v1.2.4' } }, [zip]: { status: 200 } });
  assert.match((await checkOnline([good()], f)).join('\n'), /Demo: lists 1\.2\.3 but the latest GitHub release is v1\.2\.4/);
});

test('online: a download that is not 200 fails', async () => {
  const f = fakeFetch({ [latest]: { status: 200, body: { tag_name: 'v1.2.3' } }, [zip]: { status: 404 } });
  assert.match((await checkOnline([good()], f)).join('\n'), /Demo: download returned 404/);
});

test('online: a repo with no readable latest release fails', async () => {
  const f = fakeFetch({ [zip]: { status: 200 } });
  assert.match((await checkOnline([good()], f)).join('\n'), /Demo: latest release lookup returned 404/);
});
