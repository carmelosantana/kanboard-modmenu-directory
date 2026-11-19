# ModMenu Plugin Directory

A plugin **directory** for [ModMenu](https://github.com/carmelosantana/kanboard-plugins/tree/master/ModMenu),
the standalone Kanboard plugin manager. ModMenu reads the `plugins.json` in this
repo and lets an admin browse and install these plugins from inside Kanboard.

**This repo is meant to be forked.** Host your own `plugins.json` (anywhere that
serves it over HTTPS — GitHub raw, GitHub Pages, your own server) and point
ModMenu's **Sources** tab at it. That's the whole mechanism.

## How ModMenu uses this

ModMenu ships with this directory as its default source:

```
https://raw.githubusercontent.com/carmelosantana/kanboard-modmenu-directory/main/plugins.json
```

It fetches the JSON, compares each entry's `version` against what's installed on
the server, and shows an **Install**, **Installed**, **Update available**, or
**Disabled** state. Installing downloads the `download` URL (a zip) and unpacks
it into the Kanboard `plugins/` directory.

## `plugins.json` format

A JSON array of plugin objects. Fields:

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The plugin's folder/identity name (must match the top-level folder inside the zip). |
| `title` | yes | Human-readable name shown in the UI. |
| `version` | yes | Current version; compared to the installed version to offer updates. |
| `download` | yes | HTTPS URL of the plugin zip (its single top-level folder must equal `name`). |
| `author` | no | Author name. |
| `description` | no | Short description shown on the card. |
| `homepage` | no | Project URL. |
| `compatible_version` | no | Minimum Kanboard version (informational; ModMenu displays but does not enforce it). |
| `screenshots` | no | Array of image URLs (absolute, or relative to this file's location) shown on the card. |
| `requires` | no | Hard dependencies: an array of `{ "plugin", "min_version", "reason" }` objects with a bare version (`"1.1.4"`, not `">=1.1.4"`). ModMenu blocks enabling until they are installed. Any other shape is silently ignored. |
| `recommends` | no | Soft dependencies, same array shape as `requires`. ModMenu suggests them but lets the admin carry on. |
| `conflicts` | no | Array of plugin names that must not be active at the same time, e.g. `["ShadcnTheme"]`. ModMenu checks both sides and asks before disabling the other plugin. |

### Editing `plugins.json`

Edit `plugins.json` **as text**: add or bump one entry by hand and leave every other line
alone. Never load it with a JSON parser and write it back (`json.dump`, `JSON.stringify`, `jq`
in place): that re-formats the whole file, buries the real change in a diff of hundreds of
lines, and has done so before.

Publish the release first, then list it. CI (`.github/workflows/validate.yml`) runs
`node scripts/validate.ts --online` on every PR and push to `main`, and fails when:

- an entry is missing `name`, `title`, `version` or `download`, or has an unknown field;
- `version` or a dependency's `min_version` is not a bare version (`"1.2.3"`, not `">=1.2.3"`);
- `requires` or `recommends` is not an array of `{ "plugin", "min_version", "reason" }` objects
  (ModMenu silently ignores any other shape, so the dependency would never be enforced);
- `download` is not `<homepage>/releases/download/v<version>/<name>-<version>.zip`;
- `version` is not the repo's latest GitHub release, or the `download` URL does not return 200.

Run it locally with Node 22+ (no install step):

```bash
node scripts/validate.ts            # shape only
node scripts/validate.ts --online   # also releases and downloads (set GITHUB_TOKEN to avoid rate limits)
node --test 'scripts/*.test.ts'     # the validator's own tests; quote the glob, Node 22 needs it
```

### Hosting the zips

Each `download` points at a plugin zip whose **single top-level folder is the
plugin `name`** (e.g. `HelloHarmozi/Plugin.php`, not `HelloHarmozi-main/...`).
The simplest way to produce one is a GitHub **release asset**, as this directory
does. See [`scripts/package.sh`](https://github.com/carmelosantana/kanboard-plugins/blob/master/scripts/package.sh)
in the plugins repo for a one-command packager.

## Fork it

1. Fork this repo (or copy `plugins.json` + `README.md`).
2. Replace the entries with your own plugins and `download` URLs.
3. In Kanboard → Settings → ModMenu → **Sources**, add your `plugins.json` URL.

## License

MIT © 2026 Carmelo Santana
