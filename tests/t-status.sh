# One sample from the gateway: `tmhi status`, `status --json`, `health`, and
# the admin login (with its lockout guard).
# shellcheck shell=sh disable=SC2154 # T, RC: lib.sh

N41="registered n41 100 -94 23 1234567 101 123 501390"
N25="registered n25 20 -93 14 1234567 102 124 396970"

test_status_json() {
	clock 10
	tmhi status --json
	eq "$RC" 0 "exit status"
	eq "$(json '[.reg, .nr_bands, .nr_bw, .nr_pci, .nr_nb, .auth, .gps_lat, .health.level, .health.key] | map(tostring) | join(" ")')" \
		"registered n41 100 123 1234567 ok 47.6101 ok n41 100 MHz" fields
	has '"version"' "$RUN/latest.json"
}

test_status_text() {
	clock 10
	tmhi status
	eq "$RC" 0 "exit status"
	has "n41"
	has "TMO-G4AR"
}

test_status_without_password_has_no_telemetry() {
	cfg password ''
	clock 10
	tmhi status --json
	eq "$(json '[.auth, .nr_bw, .health.key] | map(tostring) | join(" ")')" "nocreds null n41" fields
	hasnt "auth/login" "$T/requests"
}

test_status_max_age_uses_latest() {
	clock 10
	tmhi status --json
	: >"$T/requests"
	tmhi status --json --max-age 15
	eq "$RC" 0 "exit status"
	eq "$(lines "$T/requests")" 0 "requests to the gateway"
	eq "$(json .health.level)" ok level
}

test_status_unreachable() {
	gateway down
	clock 10
	tmhi status --json
	eq "$RC" 1 "exit status"
	eq "$(json '[.reg, .health.level] | join(" ")')" "unreachable down" fields
	has "unreachable" "$RUN/latest.json"
}

test_health_ok() {
	clock 10
	tmhi health
	eq "$RC" 0 "exit status"
	has "OK  on n41 100 MHz"
}

test_health_degraded() {
	gateway n25
	history <<-E
		0 $N41 x60
		60 $N25 x10
	E
	clock 70
	tmhi health
	eq "$RC" 2 "exit status"
	has "n25 20 MHz"
}

test_health_reboot_recommended_after_stuck_minutes() {
	gateway n25
	cfg stuck_minutes 30
	history <<-E
		0 $N41 x60
		60 $N25 x40
	E
	clock 100
	tmhi health
	eq "$RC" 3 "exit status"
	has "REBOOT RECOMMENDED"
}

# Never good here in the past week: a reboot wouldn't help, so it isn't
# recommended.
test_health_no_reboot_without_a_good_sample() {
	gateway n25
	history <<-E
		0 $N25 x100
	E
	clock 100
	tmhi health
	eq "$RC" 2 "exit status"
}

# A gap in the samples (router off) starts the bad stretch again.
test_health_gap_restarts_the_stretch() {
	gateway n25
	history <<-E
		0 $N41 x10
		10 $N25 x25
		60 $N25 x10
	E
	clock 70
	tmhi health
	eq "$RC" 2 "exit status"
}

test_health_down() {
	gateway down
	clock 10
	tmhi health
	eq "$RC" 1 "exit status"
	has "DOWN"
}

# The live sample misses the telemetry for once: it keeps the width from
# history instead of reading "n41".
test_health_keeps_width_when_telemetry_fails() {
	history <<-E
		0 $N41 x10
	E
	gateway_cell fail
	clock 10
	tmhi status --json
	eq "$(json '[.nr_bw, .health.key] | map(tostring) | join(" ")')" "null n41 100 MHz" fields
}

test_login_token_reused() {
	clock 10
	tmhi status --json
	tmhi status --json
	eq "$(grep -c 'POST auth/login' "$T/requests")" 1 logins
}

test_login_again_after_401() {
	clock 10
	tmhi status --json
	: >"$T/gw/token-expired"
	tmhi status --json
	eq "$(grep -c 'POST auth/login' "$T/requests")" 2 logins
	eq "$(json .nr_bw)" 100 width
}

# Repeated failed logins can lock the gateway's admin account: after one
# fails, the same username / password isn't tried for 15 minutes.
test_failed_login_not_retried_for_15_minutes() {
	gateway_login fail
	clock 10
	tmhi status --json
	eq "$(json .auth)" failed auth
	has "admin login failed" "$T/err"
	clock 20
	tmhi status --json
	eq "$(grep -c 'POST auth/login' "$T/requests")" 1 "logins within 15m"
	clock 26
	tmhi status --json
	eq "$(grep -c 'POST auth/login' "$T/requests")" 2 "logins after 15m"
}

test_failed_login_retried_with_new_password() {
	gateway_login fail
	clock 10
	tmhi status --json
	gateway_login ok
	cfg password other
	clock 11
	tmhi status --json
	eq "$(grep -c 'POST auth/login' "$T/requests")" 2 logins
	eq "$(json .auth)" ok auth
}

test_config_errors() {
	cfg port abc
	clock 10
	tmhi status --json
	has "tmhi.main.port is not a whole number" "$T/err"
	tmhi history --bogus
	eq "$RC" 1 "exit status"
	has "unknown option" "$T/err"
}

# Same numbers as the LuCI module (tests/luci): from the gateway's position
# (in the cell telemetry) to a named tower.
test_named_tower_distance() {
	tower nr 1234567 "Water tower" 47.6201 -122.1865
	clock 10
	tmhi status
	has "Water tower"
	has "1.0 mi ↗ NE (45°)"
	cfg units metric
	tmhi status
	has "1.6 km ↗ NE (45°)"
}
