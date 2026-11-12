# AGENTS.md

Notes for anyone (human or agent) changing this repo. The README covers what it does and how to install it; this covers how it's built and where it bites.

## Layout

- `tmhi`: the CLI, one POSIX shell script. Runs on the router under busybox ash; also dash / bash.
- `tmhi.init`, `tmhi.config`: the procd service and the default `/etc/config/tmhi`.
- `tmhi.hotplug`: installed as `/etc/hotplug.d/tmhi/50-example`, a notification hook that's all comments. Every file in that directory is sourced by `hotplug-call`, so it has to stay valid shell that does nothing.
- `openwrt/tmhi/`: the package Makefile.
- `openwrt/tmog4ar/`: transitional `tmog4ar` and `luci-app-tmog4ar` packages (tmhi was called tmog4ar until 0.4.0). They depend on the new packages, and `files/tmog4ar-to-tmhi` is a uci-defaults script that moves the old settings, history, hooks and run state over, after `apk upgrade` or at first boot after a sysupgrade. They're only for this repo's feed and images, never upstream. A few names stay `tmog4ar` on purpose: the signing key `openwrt/tmog4ar.pem` (routers have it as `/etc/apk/keys/tmog4ar.pem`), the image variants (`image-upgrade` on existing routers looks for those file names), and the repo / Pages URL (`dave-atx.github.io/g4arctrl/`).
- `openwrt/sdk-build.sh`: CI's package build, run in the `ghcr.io/openwrt/sdk` release container, which already holds the SDK (`openwrt/gh-action-sdk` downloads it again from the OpenWrt mirrors, and a slow mirror hung CI).
- `openwrt/luci-app-tmhi/`: the LuCI app, laid out like an app in openwrt/luci and built with `luci.mk`.
  - `htdocs/luci-static/resources/tmhi.js`: shared module (data access, health wording, charts, towers, the CSS).
  - `view/tmhi/status.js`, `settings.js`: Status → Cellular. `view/status/include/35_tmhi.js`: the Overview card. `view/dashboard/include/25_tmhi.js`: dashboard widgets.
  - `root/usr/share/rpcd/acl.d/`: which commands the pages may run. `po/templates/tmhi.pot`: strings for translation.
- `openwrt/image/`: the Raspberry Pi 5 image build. `packages.txt` is in every image; each file in `variants/` is one image (its name goes in the file names) with its own packages and `apk <url> <sha256>` downloads. `minimum-versions.txt` fails the build on an older package. `release-notes.sh` writes the package changes for a release. `image-upgrade` goes in every image as `/usr/sbin/image-upgrade`, with `/etc/g4arctrl-image` (repo, variant, tag) written by `build.sh`; it runs on the router, so the busybox / jq rules below apply (asset names are matched with grep, not jq's `test`). `docs/screenshots/`: the README images.

## How the pieces talk

- The service runs `tmhi daemon`: one sample a minute, buffered in RAM (`/tmp/tmhi-0/history.buf`), written to `history_dir` (default `/root/.tmhi/`, one TSV file per day) every `flush_minutes`. Each sample, with its health, is also written to `/tmp/tmhi-0/latest.json`.
- LuCI never talks to the gateway itself. It reads `latest.json`, and runs `tmhi status --json --max-age 15` (Refresh), `tmhi history --json -s N` and `tmhi reboot --force` through rpcd's `file.exec`. rpcd matches the ACL against the full command line, so a new CLI flag the UI needs means an ACL change too.
- There's no ucode rpcd plugin on purpose: those run in rpcd's main loop, and a history or reboot call can take seconds. `file.exec` is asynchronous.
- The daemon also sends notifications (`notify()`): syslog, a ubus event and `hotplug-call tmhi`. It never sends anything off the router itself; that's left to hook scripts. "Notified" and pending-auto-reboot state lives in `/tmp/tmhi-0/` (`notified`, `auto-reboot`), so a daemon restart doesn't notify twice. Gateway not answering / back and manual reboots go to syslog only (`syslog()`, with a priority), via `unreachable` in the same directory.
- Gateway reboots (automatic and manual) are appended to `history_dir/events.tsv` (ts, `reboot`, auto|manual, ok|noanswer|failed, band). It's on flash, but it's a few lines a month. The history readers merge it into their changes with `rbnext()`. The once-a-night limit for automatic reboots comes from it, so it survives a router reboot.
- The auto-reboot idle check reads the WAN device's byte counters in `/sys/class/net/*/statistics` once a sample. Don't run an automatic reboot path with `login force`: the 15 minute wait after a failed login (see Gateway quirks) applies to it.
- Settings are UCI only (`/etc/config/tmhi`, section `main`, plus anonymous `tower` sections). There are no environment variable overrides. The init script has a reload trigger, so a config change (from LuCI or `reload_config`) restarts the daemon.

## Linting

CI's `lint` job runs these, and the package build waits for it. Run them before pushing:

```sh
shellcheck -s sh tmhi tmhi.init tmhi.hotplug openwrt/tmog4ar/files/tmog4ar-to-tmhi openwrt/sdk-build.sh openwrt/image/*.sh openwrt/image/image-upgrade
shfmt -ln posix -d tmhi tmhi.init tmhi.hotplug openwrt/tmog4ar/files/tmog4ar-to-tmhi openwrt/sdk-build.sh openwrt/image/*.sh openwrt/image/image-upgrade
npx --yes eslint -c openwrt/luci-app-tmhi/eslint.config.mjs openwrt/luci-app-tmhi
for f in openwrt/luci-app-tmhi/root/usr/share/*/*/*.json; do jq empty "$f"; done
actionlint
```

The ESLint config lists its rules instead of importing `@eslint/js`, so `npx` works with nothing installed. Its small processor declares the variables LuCI's `'require ...'` lines create; without it every `ui` / `uci` / `tmhi` is "undefined". Biome was tried and doesn't fit: it can't parse a LuCI view (a top-level `return` is a parse error, with no script / global-return option), and its formatter can't keep LuCI's `[ a, b ]` bracket spacing.

## Shell / awk / jq rules

The CLI has to run on OpenWrt's busybox and jq builds, which are smaller than what you have on a laptop.

- OpenWrt builds jq without oniguruma: no `test`, `match`, `sub`, `gsub`, `splits`, `scan`. Use `split(" ")`, `explode` / `implode`, etc.
- awk is busybox awk. No gawk extensions (there's a fallback for `strftime`). Watch for names awk reserves (`RS` bit us) and for a function and a variable sharing a name, which is an error (`tf`, `tower` both did).
- The awk and jq programs are single-quoted shell strings, so an apostrophe in a comment inside them ends the string. Write "the gateway reports" rather than "the gateway's".
- Test anything parsing related under busybox on a real router (see Testing), not only locally.

## History format

- History is TSV with a header line; the columns are `COLS` in `tmhi`. Changing `COLS` makes the next flush rename that day's file to `.old`, so don't add columns casually.
- New fields the UI needs but history doesn't (GPS, TAC, MCC / MNC) go in the JSON sample only, not `COLS`.
- Readers re-map columns at every header line, so old files with fewer columns still read.

## Gateway quirks

- The gateway sometimes reports the serving tower's ID with one bit missing for a few minutes (seen: bit 20) while the cell ID, PCI, channel and signal stay the same. After a move it can also repeat the previous tower's ID with that bit missing, and the previous tower's cell ID, for a sample or two (issue #4). `servtower()` in the awk library keeps the previous tower while the radio, PCI and channel are unchanged: indefinitely for the one-bit / same-cell-ID case, otherwise for up to 5 samples, after which a new ID counts as real (a cell re-homed to another gNB). An ID seen on only one sample doesn't hold: the first sample after a move can carry yet another ID. Don't "fix" it away.
- `cell.gps` in the cell telemetry is the gateway's own position (one fix for the device, not per cell), and needs the admin login.
- After a failed login the CLI won't retry the same username / password for 15 minutes (`login-failed` stores a hash of them). Changing the password retries right away. Keep that: repeated failed logins can lock the gateway's admin account.

## LuCI rules

- The CSS is embedded in `tmhi.js` as a `<style>` element, not shipped as a `.css` file. A separate stylesheet failed to apply in Safari on an iPad, and without it the charts render as solid black shapes. The SVG shapes also carry their own fill / stroke attributes for the same reason.
- Don't use `.table` for label / value lists: themes size its cells their own way (bootstrap makes `.table` a block with a separate anonymous table per row) and long text overflows. The label / value rows use their own grid (`.tmhi-kv-row`).
- Information has to work on touch screens: no hover-only tooltips for anything important. The metric explanations are visible text for that reason.
- Nothing depends on luci-mod-dashboard (or luci-mod-status); their include files just sit unused without them. The dashboard include must not `'require'` anything from `view.dashboard.lib`: dashboards older than September 2026 don't have those modules and load every include in one `Promise.all`, so a failed require breaks the whole page. It loads them at runtime and renders `null` (which old dashboards skip) when they're missing.
- Polled redraws go through `keepPlace()` in `status.js`, and new rows / headings that get redrawn should carry a stable `data-place` key, so the page doesn't jump when something above the reader changes height.
- Check pages in Chromium (most users) and Safari / WebKit, in light and dark mode, at a desktop width, around iPad width (1024 px) and phone width (~412 px), and with the console open for errors.
- After changing user-visible strings, regenerate the template with LuCI's scanner: `perl /path/to/luci/build/i18n-scan.pl openwrt/luci-app-tmhi > openwrt/luci-app-tmhi/po/templates/tmhi.pot` (the script is `build/i18n-scan.pl` in openwrt/luci).
- To move the app into openwrt/luci: drop `PKG_VERSION` from its Makefile, include `../../luci.mk`, and delete `eslint.config.mjs` (ESLint uses the config nearest each file, so ours would override the repo's). The code passes openwrt/luci's own config with 0 errors; it warns about `tmhi` and `charts` because its list of known globals only has the core modules, which is normal for an app with its own module.

## Versions and releases

Keep four versions in step: `VERSION` in `tmhi`, and `PKG_VERSION` in the three Makefiles (`tmhi`, `luci-app-tmhi`, `tmog4ar`). CI checks them against the tag. A `vX.Y.Z` tag builds, signs and publishes the packages to GitHub Pages and makes a release with the Pi 5 images. A `vX.Y.Z-rN` tag rebuilds only the images: CI checks `X.Y.Z` the same way, makes a release with just the images, and doesn't touch Pages. Releases are created with `--latest`, because `image-upgrade` follows GitHub's latest release and GitHub could otherwise rank `v0.2.0-r1` below `v0.2.0`.

Release notes for a `vX.Y.Z` release start with what changed in the packages, made by git-cliff (`cliff.toml`) from the commits that touch the files the packages are built from. Each such commit gives one line per `Release-note:` line it has (or its subject if it has none), written for someone who runs the router rather than someone reading the code ("History no longer shows fake tower changes after a band change"). Give user-visible changes a `Release-note:` line, and use `Release-note: none` for ones nobody would notice (refactors, comments, tests). The section (New / Fixed / Changed) comes from the subject's first word. If you add a file the packages are built from, add it to `include_paths` in `cliff.toml` as well as the cache key below. Check the notes with `git-cliff --unreleased` before tagging.

CI caches the built repository, keyed on the files the packages are built from, and skips the SDK when it hits. If you add a file the packages are built from outside `openwrt/tmhi/`, `openwrt/luci-app-tmhi/` and `openwrt/tmog4ar/`, add it to the key in `build.yml`. The Image Builder's downloads are cached too; apk checks them against the current indexes, so they can't go stale. The `package (main)` job builds with the snapshot SDK and installs on a main rootfs, so a break on main shows up before an upstream submission; nothing waits for it.

## Testing

- Locally: a fake `uci` on `PATH` (answering `uci -q get tmhi.main.X` and `uci -q show tmhi`) plus a copy of some history lets you run `history`, `history --json` and the tower code without a router. Point `host` at something unreachable so nothing talks to a real gateway.
- On a router: copy the script to a scratch directory and run it with a `uci` shim that runs `uci -c` against a private config directory, so it doesn't touch the installed package or the running daemon.
- To install a dev build, copy to a new name and `mv` over `/usr/bin/tmhi`. The running daemon is a shell reading its script as it goes; overwriting the file in place can break it. After changing LuCI files, `rm -f /tmp/luci-indexcache*` so browsers fetch them again.
- If the gateway is anyone's real internet connection: never run `tmhi reboot` or confirm the reboot dialog while testing, never save a wrong admin password (see the lockout above), and back up `/etc/config/tmhi` and the history first.

## Privacy

This repo and its screenshots are public. Don't commit anything that locates a real user:

- No real coordinates, tower IDs (gNB / eNB), cell IDs, PCIs, TACs, public IPs or IPv6 prefixes, hostnames or passwords. Examples use gNB `1234567` and coordinates around Bellevue, WA (`47.6101, -122.2015`).
- Screenshots are taken from a real router with Playwright rewriting the responses from `/ubus` and `/cgi-bin/cgi-*` before the page sees them (IDs, names, coordinates shifted together so distances still look right, IPv6, the password), then the page text and link targets are checked for the real values before saving. Note that `latest.json` comes through `cgi-download`, not ubus.
