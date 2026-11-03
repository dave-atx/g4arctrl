# tmog4ar

A command line tool for the T-Mobile Home Internet TMO-G4AR (Arcadyan) gateway. It shows the band, channel width and signal quality, keeps a history of them, and tells you when the gateway looks stuck and needs a reboot.

I wrote it for an OpenWrt 25.12 router (a Raspberry Pi 5) sitting behind the gateway. It's a single POSIX shell script that needs only `curl` and `jq`, so it should also run anywhere with dash or bash.

The API details come from [zacharee/HINTControl](https://github.com/zacharee/HINTControl), which did the reverse engineering.

## Why

My gateway occasionally gets "stuck" on n25 with a 20 MHz channel instead of n41 at 100 MHz, leaving about a third of the usual bandwidth until it's rebooted. Short drops to another band are normal handovers and fix themselves. This tool logs a sample every minute so it can tell those two cases apart.

## Install (OpenWrt 25.12)

Add my package repository (once), then install. The package pulls in `curl` and `jq` and starts the `tmog4ar` service, which logs a sample a minute:

```sh
uclient-fetch -O /etc/apk/keys/tmog4ar.pem https://dave-atx.github.io/g4arctrl/tmog4ar.pem
echo https://dave-atx.github.io/g4arctrl/packages.adb >> /etc/apk/repositories.d/customfeeds.list
apk update && apk add tmog4ar
```

After that, `apk upgrade` picks up new versions. The key should match [openwrt/tmog4ar.pem](openwrt/tmog4ar.pem). It's a noarch package, so the repository works for any 25.12 target. If you'd rather not add a repository, download the `.apk` from [Releases](https://github.com/dave-atx/g4arctrl/releases) and `apk add --allow-untrusted ./tmog4ar-*.apk`.

Channel width, PCI / ARFCN / CQI and reboot need the gateway's admin password. Without it you still get band and signal. Set `TMOG4AR_PASS` in `/etc/tmog4ar.conf` (the package installs it with mode 600, and upgrades and sysupgrade keep it), then `/etc/init.d/tmog4ar restart`.

The package also adds the history directory (`/root/.tmog4ar/`) to sysupgrade's keep list.

### Raspberry Pi 5 image

Each release also has OpenWrt 25.12 images for the Pi 5 (ext4 or squashfs, factory or sysupgrade) built with the [Image Builder](https://openwrt.org/docs/guide-user/additional-software/imagebuilder). They include tmog4ar, the packages in [openwrt/image/packages.txt](openwrt/image/packages.txt) and the repository above. They carry no configuration, so after flashing set the gateway password as above. A sysupgrade keeps `/etc/tmog4ar.conf` and the history.

The online firmware builders (firmware selector, `owut`) only know about official packages, so their images can't include tmog4ar. Reinstall it after upgrading with those, or upgrade with these images instead.

### Without the package

```sh
apk add curl jq
cp tmog4ar /usr/bin/ && cp tmog4ar.init /etc/init.d/tmog4ar
cp tmog4ar.conf.example /etc/tmog4ar.conf && chmod 600 /etc/tmog4ar.conf
/etc/init.d/tmog4ar enable && /etc/init.d/tmog4ar start
```

### Building the package

With the [OpenWrt SDK](https://openwrt.org/docs/guide-developer/using_the_sdk) for 25.12 (any target):

```sh
echo "src-link tmog4ar /path/to/g4arctrl/openwrt" >> feeds.conf
./scripts/feeds update -a && ./scripts/feeds install tmog4ar
make defconfig && make package/tmog4ar/compile
```

CI ([.github/workflows/build.yml](.github/workflows/build.yml)) builds the package and the Pi 5 image on every push. To release, bump `VERSION` in `tmog4ar` and `PKG_VERSION` in `openwrt/tmog4ar/Makefile`, then push a `vX.Y.Z` tag. That creates the GitHub release and updates the repository on GitHub Pages, signed with the key in the `APK_PRIVATE_KEY` secret.

## Usage

```
tmog4ar status [--json]      band, channel width and signal quality (default)
tmog4ar watch [-i SECS]      live view, refreshed every 15s by default
tmog4ar health               is it stuck? exit 0 ok, 2 degraded, 3 reboot recommended, 1 unreachable
tmog4ar history [-s 7d]      time per band, quality per hour / day, band and tower changes
tmog4ar daemon               sample once a minute (what the service runs)
tmog4ar reboot [--force]     reboot the gateway
tmog4ar raw [gateway|cell]   raw JSON from the gateway
```

```
$ tmog4ar status
TMO-G4AR  fw 1.00.18  ·  up 4h 21m  ·  2026-11-02 17:55:51
● registered  ·  5G SA  ·  APN FBB.HOME  ·  IPv6 yes

5G     n41
  Width    100 MHz ██████████  good
  RSRP     -93 dBm █████░░░░░  fair
  RSRQ     -10 dB  █████░░░░░  good
  SINR      22 dB  ███████░░░  good
  Bars     4.0 /4  ██████████  good
  gNB 1234567 · CID 101 · PCI 500 · ARFCN 520110 · CQI 12 · RSSI -82 · Internal_omni

Health  OK  on n41 100 MHz
```

`tmog4ar help` lists every setting.

## How "stuck" is decided

A sample is good when the gateway is registered on a preferred band (`n41` by default) and, if the width is known, at least 40 MHz wide. A reboot is recommended once samples have been bad for 30 minutes straight and a good sample was seen sometime in the past week (so it won't keep recommending reboots when the n41 site itself is down). All three thresholds are settings.

## Flash wear

Samples are buffered in `/tmp` (RAM on OpenWrt) and written to flash in one append an hour, one file per day. Old history is deleted a day at a time, so nothing on flash gets rewritten. A power cut can lose up to an hour of history; `TMOG4AR_FLUSH_MINUTES=0` writes every sample immediately instead.

## Being nice to the gateway

Each sample is one or two GET requests. `watch` won't refresh faster than every 5 seconds, and after a failed login it waits 15 minutes before trying again so it doesn't trip a lockout.
