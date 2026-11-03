# tmog4ar

A command line tool for the T-Mobile Home Internet TMO-G4AR (Arcadyan) gateway. It shows the band, channel width and signal quality, keeps a history of them, and tells you when the gateway looks stuck and needs a reboot.

I wrote it for an OpenWrt 25.12 router (a Raspberry Pi 5) sitting behind the gateway. It's a single POSIX shell script that needs only `curl` and `jq`, so it should also run anywhere with dash or bash.

The API details come from [zacharee/HINTControl](https://github.com/zacharee/HINTControl), which did the reverse engineering.

## Why

My gateway occasionally gets "stuck" on n25 with a 20 MHz channel instead of n41 at 100 MHz, leaving about a third of the usual bandwidth until it's rebooted. Short drops to another band are normal handovers and fix themselves. This tool logs a sample every minute so it can tell those two cases apart.

## Install (OpenWrt)

```sh
apk add curl jq
cp tmog4ar /usr/bin/ && chmod +x /usr/bin/tmog4ar
```

Channel width, PCI / ARFCN / CQI and reboot need the gateway's admin password. Without it you still get band and signal.

```sh
printf 'TMOG4AR_PASS=yourpassword\n' > /etc/tmog4ar.conf
chmod 600 /etc/tmog4ar.conf
```

For history, add a cron job. The optional init script saves buffered samples when the router reboots:

```sh
echo '* * * * * /usr/bin/tmog4ar log' >> /etc/crontabs/root
/etc/init.d/cron enable; /etc/init.d/cron restart
cp tmog4ar.init /etc/init.d/tmog4ar && /etc/init.d/tmog4ar enable
```

To keep history across a sysupgrade, add `/root/.tmog4ar/` to `/etc/sysupgrade.conf`.

## Usage

```
tmog4ar status [--json]      band, channel width and signal quality (default)
tmog4ar watch [-i SECS]      live view, refreshed every 15s by default
tmog4ar health               is it stuck? exit 0 ok, 2 degraded, 3 reboot recommended, 1 unreachable
tmog4ar history [-s 7d]      time per band, quality per hour / day, band and tower changes
tmog4ar log                  record one sample (from cron)
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
