# openwrt/tmog4ar/files/tmog4ar-to-tmhi: the 0.4.0 rename moves settings,
# history, run state and hooks from tmog4ar to tmhi. Run from a copy with its
# fixed paths moved into $T, and a uci that reads $T/etc/config.
# shellcheck shell=sh disable=SC2154,SC2016 # T, RC: lib.sh; literal $ in fixtures

mig_setup() {
	cp "$TESTS/fake-files/uci" "$T/bin/uci"
	chmod +x "$T/bin/uci"
	[ "$(command -v uci)" = "$T/bin/uci" ] || fail "fake uci not first on PATH"
	mkdir -p "$T/etc/config" "$T/etc/apk" "$T/etc/init.d" "$T/etc/rc.d" "$T/root" "$T/var/run"
	sed -e "s#/etc/#$T/etc/#g" -e "s#/root/.tmog4ar#$T/root/.tmog4ar#" -e "s#/tmp/tmog4ar-0#$T/tmp/tmog4ar-0#" \
		-e "s#/var/run/tmhi#$T/var/run/tmhi#" "$ROOT/openwrt/tmog4ar/files/tmog4ar-to-tmhi" >"$T/migrate"
	printf '#!/bin/sh\necho "$1" >>"%s/init"\n' "$T" >"$T/etc/init.d/tmhi"
	chmod +x "$T/etc/init.d/tmhi"
	# What the tmhi package installs.
	printf "config tmhi 'main'\n\toption host '192.168.12.1'\n" >"$T/etc/config/tmhi"
	mkdir -p "$T/etc/hotplug.d/tmhi"
	printf '# example, all comments\n' >"$T/etc/hotplug.d/tmhi/50-example"
}

old_config() {
	cat >"$T/etc/config/tmog4ar" <<-E
		config tmog4ar 'main'
			option host '192.168.12.1'
			option password 'secret'
			option history_dir '${1:-$T/root/.tmog4ar}'
			option auto_reboot '1'

		config tower
			option id '1234567'
			option name 'Water tower'
	E
}

migrate() {
	RC=0
	${TEST_SH:-sh} "$T/migrate" >"$T/out" 2>"$T/err" || RC=$?
}

test_nothing_to_move() {
	mig_setup
	migrate
	eq "$RC" 0 "exit status"
	[ ! -f "$T/syslog" ] || fail "logged: $(cat "$T/syslog")"
	has "option host '192.168.12.1'" "$T/etc/config/tmhi"
}

test_settings_move() {
	mig_setup
	old_config
	migrate
	eq "$RC" 0 "exit status"
	[ ! -f "$T/etc/config/tmog4ar" ] || fail "old config left"
	has "config tmhi 'main'" "$T/etc/config/tmhi"
	has "option password 'secret'" "$T/etc/config/tmhi"
	has "option history_dir '$T/etc/tmhi'" "$T/etc/config/tmhi"
	has "option name 'Water tower'" "$T/etc/config/tmhi"
	has "moved tmog4ar's settings and history to tmhi" "$T/syslog"
}

# Someone set tmhi up by hand already: the old settings would undo that.
test_settings_left_when_tmhi_has_a_password() {
	mig_setup
	old_config
	printf "config tmhi 'main'\n\toption password 'newer'\n" >"$T/etc/config/tmhi"
	migrate
	has "option password 'newer'" "$T/etc/config/tmhi"
	[ -f "$T/etc/config/tmog4ar" ] || fail "old config removed"
	has "left $T/etc/config/tmog4ar alone" "$T/syslog"
}

# A history_dir someone chose stays where it is, and the setting with it.
test_custom_history_dir_stays() {
	mig_setup
	mkdir -p "$T/mnt/usb/hist"
	echo x >"$T/mnt/usb/hist/history-2026-11-04.tsv"
	old_config "$T/mnt/usb/hist"
	migrate
	has "option history_dir '$T/mnt/usb/hist'" "$T/etc/config/tmhi"
	[ -f "$T/mnt/usb/hist/history-2026-11-04.tsv" ] || fail "history moved"
}

# tmhi has already written to today's file by the time this runs: the old
# lines go first, then tmhi's, after a second header, and both still read.
test_history_merged_and_readable() {
	mig_setup
	old_config
	cfg history_dir "$T/etc/tmhi"
	history <<-E
		0 registered n25 20 -93 14 1234567 102 124 396970 x5
	E
	mkdir -p "$T/root/.tmog4ar"
	mv "$T/hist/history-2026-11-04.tsv" "$T/root/.tmog4ar/"
	printf '%s\treboot\tauto\tok\tn25 20 MHz\n' $((BASE + 60)) >"$T/root/.tmog4ar/events.tsv"
	history <<-E
		5 registered n41 100 -94 23 1234567 101 123 501390 x5
	E
	mkdir -p "$T/etc/tmhi"
	mv "$T/hist/history-2026-11-04.tsv" "$T/etc/tmhi/"
	migrate
	[ ! -d "$T/root/.tmog4ar" ] || fail "old history directory left"
	eq "$(grep -c '^ts' "$T/etc/tmhi/history-2026-11-04.tsv")" 2 headers
	clock 20
	eq "$(changes 1h)" "1 reboot auto ok (n25 20 MHz)
5 band n25 20 MHz -> n41 100 MHz" changes
}

# The 15 minute hold after a failed login has to survive the move.
test_run_state_moves() {
	mig_setup
	mkdir -p "$T/tmp/tmog4ar-0"
	echo "1793750400 abc" >"$T/tmp/tmog4ar-0/login-failed"
	echo 1 >"$T/tmp/tmog4ar-0/notified"
	echo '{}' >"$T/tmp/tmog4ar-0/latest.json"
	migrate
	eq "$(cat "$T/var/run/tmhi/login-failed")" "1793750400 abc" login-failed
	[ -f "$T/var/run/tmhi/notified" ] || fail "notified not moved"
	[ ! -f "$T/var/run/tmhi/latest.json" ] || fail "stale latest.json moved"
	[ ! -d "$T/tmp/tmog4ar-0" ] || fail "old run directory left"
}

test_hooks() {
	mig_setup
	mkdir -p "$T/etc/hotplug.d/tmog4ar"
	printf '# all comments\n\n' >"$T/etc/hotplug.d/tmog4ar/50-example"
	echo 'echo mine' >"$T/etc/hotplug.d/tmog4ar/60-mine"
	migrate
	eq "$(cat "$T/etc/hotplug.d/tmhi/50-example")" "# example, all comments" "unedited example"
	eq "$(cat "$T/etc/hotplug.d/tmhi/60-mine")" "echo mine" "own hook"
	[ ! -d "$T/etc/hotplug.d/tmog4ar" ] || fail "old hook directory left"
}

test_edited_example_hook_replaces_tmhi_one() {
	mig_setup
	mkdir -p "$T/etc/hotplug.d/tmog4ar"
	printf '# example\nlogger "$MESSAGE"\n' >"$T/etc/hotplug.d/tmog4ar/50-example"
	migrate
	has 'logger "$MESSAGE"' "$T/etc/hotplug.d/tmhi/50-example"
}

# tmhi came in as a dependency of tmog4ar: it goes into apk's world, so
# removing the transitional package later doesn't remove it.
test_world_gets_tmhi() {
	mig_setup
	printf 'base-files\ntmog4ar\nluci-app-tmog4ar\n' >"$T/etc/apk/world"
	migrate
	i=0
	while [ ! -s "$T/apk" ] && [ $i -lt 20 ]; do
		i=$((i + 1))
		"$REAL_SLEEP" 0.1
	done
	eq "$(cat "$T/apk")" "add tmhi luci-app-tmhi" apk
}

test_world_already_has_tmhi() {
	mig_setup
	printf 'base-files\ntmhi\n' >"$T/etc/apk/world"
	migrate
	[ ! -f "$T/apk" ] || fail "apk ran: $(cat "$T/apk")"
}
