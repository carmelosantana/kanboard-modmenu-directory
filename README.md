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
