# `tmhi daemon`: sampling, the RAM buffer and its flush, syslog lines and
# notifications. The fake sleep moves the clock a minute per sample.
# shellcheck shell=sh disable=SC2154,SC2016 # T, RC, RUN: lib.sh; on-sleep code is single-quoted

N41="registered n41 100 -94 23 1234567 101 123 501390"
N25="registered n25 20 -93 14 1234567 102 124 396970"

test_samples_buffered_then_flushed_on_stop() {
	clock 10
	daemon 3
	eq "$RC" 0 "exit status"
	f="$T/hist/history-2026-11-04.tsv"
	eq "$(head -n 1 "$f" | cut -f1-3)" "ts	reg	nr_bands" header
	eq "$(samples)" 3 samples
	eq "$(lines "$RUN/history.buf")" 0 "left in RAM"
	eq "$(json .health.level "$RUN/latest.json")" ok level
}

test_flush_every_flush_minutes() {
	cfg flush_minutes 5
	clock 10
	# What is on flash while the daemon still runs, after the sample at 15.
	echo 'at 16 && cat "$T"/hist/history-*.tsv >"$T/mid"' >"$T/on-sleep"
	daemon 7
	eq "$(grep -c '^[0-9]' "$T/mid")" 6 "samples on flash after 6 minutes"
}

# History columns changed (an upgrade): today's file is set aside, not mixed.
test_flush_with_other_columns_renames_file() {
	printf 'ts\treg\tnr_bands\n%s\tregistered\tn41\n' $((BASE + 60)) >"$T/hist/history-2026-11-04.tsv"
	clock 10
	daemon 1
	eq "$(head -n 1 "$T/hist/history-2026-11-04.tsv.old" | cut -f1-3)" "ts	reg	nr_bands" "old file"
	eq "$(grep -c '^[0-9]' "$T/hist/history-2026-11-04.tsv")" 1 "new file"
	has "history columns changed" "$T/err"
}

test_old_history_pruned() {
	cfg retention_days 2
	printf 'ts\treg\n%s\tregistered\n' $((BASE - 5 * 86400)) >"$T/hist/history-2026-10-30.tsv"
	printf '%s\treboot\tauto\tok\tn25\n%s\treboot\tauto\tok\tn25\n' $((BASE - 5 * 86400)) $((BASE - 3600)) >"$T/hist/events.tsv"
	clock 10
	daemon 1
	[ ! -f "$T/hist/history-2026-10-30.tsv" ] || fail "old file kept"
	eq "$(lines "$T/hist/events.tsv")" 1 "events kept"
}

# Once it has answered, an outage is news right away, logged once per stretch.
test_outage_after_start_recorded_and_logged_once() {
	clock 10
	cat >"$T/on-sleep" <<-'E'
		at 12 && : >"$T/gw/down"
		at 15 && rm -f "${T:?}/gw/down"
	E
	daemon 7
	eq "$(cut -f2 "$T/hist/history-2026-11-04.tsv" | tail -n +2 | uniq -c | awk '{ printf "%s %s,", $1, $2 }')" \
		"2 registered,3 unreachable,2 registered," samples
	eq "$(cut -d' ' -f2- "$T/syslog")" "warning No answer from the gateway: gateway gateway.test:8080 unreachable
notice The gateway is answering again after 3m" syslog
}

# A notification when a reboot becomes recommended, once per bad stretch
# (and not again after a daemon restart), and one when it recovers.
test_notify_reboot_recommended_and_recovered() {
	gateway n25
	history <<-E
		0 $N41 x60
		60 $N25 x40
	E
	clock 100
	daemon 2
	daemon 2
	eq "$(grep -c 'Reboot recommended' "$T/syslog")" 1 "reboot-recommended lines"
	eq "$(jq -rs '[.[].action] | join(",")' "$T/ubus")" reboot-recommended "ubus events"
	eq "$(cat "$T/hotplug")" "tmhi ACTION=reboot-recommended LEVEL=reboot BAND=n25 20 MHz" hotplug
	grep -q 'warning Reboot recommended' "$T/syslog" || fail "not a warning"
	gateway n41
	daemon 1
	has "Recovered: on n41 100 MHz" "$T/syslog"
	eq "$(jq -rs '[.[].action] | join(",")' "$T/ubus")" reboot-recommended,recovered "ubus events"
}

test_notify_test() {
	clock 10
	tmhi notify-test
	eq "$RC" 0 "exit status"
	has "info tmhi test notification" "$T/syslog"
	has "ACTION=test" "$T/hotplug"
}

test_stop_flushes() {
	clock 10
	daemon 2
	tmhi flush
	eq "$RC" 0 "exit status"
	eq "$(samples)" 2 samples
}
