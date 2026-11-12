# The optional automatic reboot: when a reboot is recommended, inside the
# night window (02:00-05:00; the tests run in UTC), once the WAN has been
# quiet for 15 minutes, at most once in 20 hours.
# shellcheck shell=sh disable=SC2154,SC2016 # T, RC: lib.sh; on-sleep code is single-quoted

N41="registered n41 100 -94 23 1234567 101 123 501390"
N25="registered n25 20 -93 14 1234567 102 124 396970"

# Good on n41 until 01:00, then stuck on n25: a reboot is recommended from
# 01:30. The WAN device wan0 is idle unless a test makes it busy.
stuck_on_n25() {
	cfg auto_reboot 1
	cfg wan_device wan0
	wan_counters 1000 1000
	gateway n25
	history <<-E
		0 $N41 x60
		60 $N25 x$(($1 - 60))
	E
	clock "$1"
}

busy_wan() {
	cat >"$T/on-sleep" <<-'E'
		d="$T/sys/class/net/wan0/statistics"
		echo $(($(cat "$d/rx_bytes") + 100000000)) >"$d/rx_bytes"
	E
}

reboots() { grep -c 'POST gateway/reset' "$T/requests" || true; }

test_reboots_at_night_once_wan_is_quiet() {
	stuck_on_n25 180
	daemon 17
	eq "$(reboots)" 1 reboots
	# The first sample at 03:00 starts the quiet stretch.
	eq "$(cut -f1-5 "$T/hist/events.tsv")" "$((BASE + 195 * 60))	reboot	auto	ok	n25 20 MHz" events
	has "Rebooting the gateway: on n25 20 MHz, not n41 for 2h" "$T/syslog"
	eq "$(jq -rs '[.[].action] | join(",")' "$T/ubus")" reboot-recommended,auto-reboot "ubus events"
}

test_reports_how_the_reboot_went() {
	stuck_on_n25 180
	cat >"$T/on-sleep" <<-'E'
		grep -q 'gateway/reset' "$T/requests" && cp "$TESTS/fixtures/gateway-n41.json" "$T/gw/all.json" &&
			cp "$TESTS/fixtures/cell-n41.json" "$T/gw/cell.json"
	E
	daemon 30
	eq "$(reboots)" 1 reboots
	has "Automatic reboot worked: on n41 100 MHz (was n25 20 MHz)" "$T/syslog"
}

test_reports_still_degraded_after_the_reboot() {
	stuck_on_n25 180
	daemon 30
	eq "$(reboots)" 1 reboots
	has "Still degraded after the automatic reboot" "$T/syslog"
	grep -q "warning Still degraded" "$T/syslog" || fail "not a warning"
}

# At most one automatic reboot in 20 hours, counted from events.tsv so it
# survives a router reboot.
test_once_a_night() {
	stuck_on_n25 180
	events <<-E
		-600 auto ok n25 20 MHz
	E
	daemon 20
	eq "$(reboots)" 0 reboots
}

test_off_by_default() {
	stuck_on_n25 180
	cfg auto_reboot 0
	daemon 20
	eq "$(reboots)" 0 reboots
}

test_not_outside_the_window() {
	stuck_on_n25 330
	daemon 20
	eq "$(reboots)" 0 reboots
}

# When the window closes without a reboot that was recommended, the log
# says why, once.
test_busy_wan_logged_when_window_closes() {
	stuck_on_n25 285
	busy_wan
	daemon 20
	eq "$(reboots)" 0 reboots
	eq "$(grep -c 'No automatic reboot in the 2:00-5:00 window' "$T/syslog")" 1 "window lines"
	has "the WAN was never under 1000 kbit/s for 15m" "$T/syslog"
}

test_no_password_logged_when_window_closes() {
	stuck_on_n25 285
	cfg password ''
	daemon 20
	eq "$(reboots)" 0 reboots
	has "No automatic reboot in the 2:00-5:00 window: no admin password is set" "$T/syslog"
}

# 0.3.4: a saved wan_device that doesn't exist (renamed, another image)
# meant the counters were never read and it never rebooted. It falls back
# to the wan interface's device and says so.
test_missing_wan_device_falls_back_to_wan_interface() {
	stuck_on_n25 180
	cfg wan_device eth9
	daemon 17
	eq "$(reboots)" 1 reboots
	eq "$(grep -c 'wan_device eth9 does not exist, measuring wan0 instead' "$T/syslog")" 1 "fallback lines"
}

test_failed_reboot_logged() {
	stuck_on_n25 180
	gateway_login fail
	daemon 17
	eq "$(cut -f3-4 "$T/hist/events.tsv")" "auto	failed" events
	has "Automatic reboot failed: admin login failed" "$T/syslog"
	# At 03:00, and again at 03:15 when the wait is over; the reboot itself
	# doesn't try again (no `login force` on an automatic path).
	eq "$(grep -c 'POST auth/login' "$T/requests")" 2 logins
}

# A manual reboot: logged in events.tsv and syslog, and the CLI insists on
# --force without a terminal.
test_manual_reboot() {
	clock 10
	tmhi reboot </dev/null
	eq "$RC" 1 "exit status without --force"
	eq "$(reboots)" 0 reboots
	tmhi reboot --force
	eq "$RC" 0 "exit status"
	eq "$(reboots)" 1 reboots
	eq "$(cut -f2-5 "$T/hist/events.tsv")" "reboot	manual	ok	n41 100 MHz" events
	has "notice Manual reboot of the gateway requested (was on n41 100 MHz)" "$T/syslog"
}
