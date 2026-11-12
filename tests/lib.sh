# Test helpers, sourced by run.sh into each test's subshell.
#
# Every test gets a fresh directory $T with stand-ins on PATH for what tmhi
# talks to: uci (settings from $T/uci), curl (a fake gateway serving the JSON
# in $T/gw), date and sleep (a clock in $T/now that only moves when sleep is
# called), logger (to $T/syslog), ubus (to $T/ubus) and id (not root, so the
# run state goes to $T/tmp/tmhi-1000 instead of /var/run/tmhi). The script
# under test is a copy with /sys/class/net and /sbin/hotplug-call pointed
# into $T, so the WAN counters and hook calls can be faked too.
#
# shellcheck shell=sh disable=SC2034

# Fixed times: BASE is 2026-11-04 00:00 UTC, and the clock starts a day later.
BASE=1793750400
TZ=UTC
T_BASE=$BASE # for the fake commands: tmhi has its own BASE
export TZ T_BASE

setup() {
	T=$(mktemp -d "${TMPDIR:-/tmp}/tmhi-test.XXXXXX")
	mkdir -p "$T/bin" "$T/hist" "$T/gw" "$T/tmp" "$T/sys/class/net"
	REAL_DATE=$(command -v date) REAL_SLEEP=$(command -v sleep)
	export T REAL_DATE REAL_SLEEP
	echo $((BASE + 86400)) >"$T/now"
	sed -e "s#/sys/class/net#$T/sys/class/net#g" -e "s#/sbin/hotplug-call#$T/bin/hotplug-call#g" \
		"$TMHI" >"$T/tmhi"
	cp "$TESTS"/fake/* "$T/bin/"
	chmod +x "$T/bin"/*
	PATH="$T/bin:$PATH" TMPDIR="$T/tmp"
	export PATH TMPDIR
	# A fake that isn't found means the real one runs (uci, sysupgrade...).
	for c in "$T"/bin/*; do
		[ "$(command -v "${c##*/}")" = "$c" ] || fail "fake ${c##*/} not first on PATH"
	done
	RUN="$T/tmp/tmhi-1000"
	# Settings every test starts with: history in $T/hist, a fake gateway
	# and a password, so the cell telemetry (channel width) is there.
	cfg history_dir "$T/hist"
	cfg host gateway.test
	cfg password secret
	gateway n41
}

teardown() {
	case "$T" in */tmhi-test.*) rm -rf "${T:?}" ;; esac
}

# cfg OPTION VALUE: set tmhi.main.OPTION
cfg() {
	grep -v "^$1=" "$T/uci" >"$T/uci.new" 2>/dev/null || true
	printf '%s=%s\n' "$1" "$2" >>"$T/uci.new"
	mv "$T/uci.new" "$T/uci"
}

# tower RADIO ID NAME LAT LON: add a named tower section
tower() {
	printf '%s\t%s\t%s\t%s\t%s\n' "$@" >>"$T/towers"
}

# clock MINUTES: set the clock to BASE + MINUTES
clock() { echo $((BASE + $1 * 60)) >"$T/now"; }
now() { cat "$T/now"; }

# gateway STATE: what the fake gateway answers from now on.
#   n41 | n25 | lte    registered on that band (fixtures in tests/fixtures)
#   down               no answer at all
# gateway_cell ok|fail: whether the admin cell telemetry answers.
gateway() {
	case "$1" in
	down) : >"$T/gw/down" ;;
	*)
		rm -f "${T:?}/gw/down"
		cp "$TESTS/fixtures/gateway-$1.json" "$T/gw/all.json"
		cp "$TESTS/fixtures/cell-$1.json" "$T/gw/cell.json"
		;;
	esac
}
gateway_cell() {
	case "$1" in
	ok) rm -f "${T:?}/gw/cell-fail" ;;
	fail) : >"$T/gw/cell-fail" ;;
	esac
}
# gateway_login ok|fail
gateway_login() {
	case "$1" in
	ok) rm -f "${T:?}/gw/login-fail" ;;
	fail) : >"$T/gw/login-fail" ;;
	esac
}

# wan_counters RX TX: the fake WAN device's byte counters (device "wan0")
wan_counters() {
	mkdir -p "$T/sys/class/net/wan0/statistics"
	echo "$1" >"$T/sys/class/net/wan0/statistics/rx_bytes"
	echo "$2" >"$T/sys/class/net/wan0/statistics/tx_bytes"
}

# history [FILE]: write samples in the compact form below (from FILE or
# stdin) as today's history file, history-<date of the first sample>.tsv.
#
#   MIN  reg  band  bw  rsrp  sinr  id  cid  pci  arfcn  [xN]
#
# MIN is minutes after BASE. band nNN is 5G, bNN LTE (as the gateway names them); "-" is a missing
# value; xN repeats the line N times a minute apart. Missing trailing fields
# are "-". "header" writes a header line, like a flush after a restart.
# Comments (#) and blank lines are skipped.
history() {
	awk -v base="$BASE" -v cols="$(sed -n "s/^COLS='\(.*\)'$/\1/p" "$TMHI")" '
	BEGIN { nc = split(cols, C, " "); for (i = 1; i <= nc; i++) H = H (i > 1 ? "\t" : "") C[i]; print H }
	/^[ \t]*(#|$)/ { next }
	$1 == "header" { print H; next }
	{
		n = 1; nf = NF
		if ($NF ~ /^x[0-9]+$/) { n = substr($NF, 2) + 0; nf-- }
		for (r = 0; r < n; r++) {
			delete V
			for (i = 1; i <= nc; i++) V[C[i]] = "-"
			V["ts"] = base + ($1 + r) * 60
			V["reg"] = (nf >= 2) ? $2 : "registered"
			b = (nf >= 3) ? $3 : "-"
			p = (b ~ /^b/) ? "lte_" : "nr_"
			if (b != "-") V[p "bands"] = b
			if (nf >= 4) V[p "bw"] = $4
			if (nf >= 5) V[p "rsrp"] = $5
			if (nf >= 6) V[p "sinr"] = $6
			if (nf >= 7) V[p "nb"] = $7
			if (nf >= 8) V[p "cid"] = $8
			if (nf >= 9) V[p "pci"] = $9
			if (nf >= 10) V[p "arfcn"] = $10
			line = ""
			for (i = 1; i <= nc; i++) line = line (i > 1 ? "\t" : "") V[C[i]]
			print line
		}
	}' "${1:--}" >"$T/hist.new"
	first=$(sed -n '2p' "$T/hist.new" | cut -f1)
	mv "$T/hist.new" "$T/hist/history-$("$REAL_DATE" -d "@${first:-$BASE}" +%Y-%m-%d).tsv"
}

# events: reboot events, "MIN source result band" per line, into events.tsv
events() {
	awk -v base="$BASE" '!/^[ \t]*(#|$)/ {
		b = $4; for (i = 5; i <= NF; i++) b = b " " $i
		printf "%d\treboot\t%s\t%s\t%s\n", base + $1 * 60, $2, $3, b
	}' >>"$T/hist/events.tsv"
}

# tmhi ARGS: run the script under test. Output in $T/out and $T/err, exit
# status in $RC. TEST_SH picks the shell (default sh).
tmhi() {
	RC=0
	${TEST_SH:-sh} "$T/tmhi" "$@" >"$T/out" 2>"$T/err" || RC=$?
}

# daemon SAMPLES: run `tmhi daemon` for that many samples a minute apart,
# then stop it the way procd does (TERM).
daemon() {
	echo "$1" >"$T/sleeps-left"
	RC=0
	${TEST_SH:-sh} "$T/tmhi" daemon -i 60 >"$T/out" 2>"$T/err" || RC=$?
}

# changes [SINCE]: `tmhi history --json` events, one line each, times in
# minutes after BASE:
#   12 band n41 100 MHz -> n25 20 MHz       (+ " tower A -> B" when it moved too)
#   12 tower 1234567 -> 7654321
#   12 gap 30m
#   12 reboot auto ok (n25 20 MHz)
changes() {
	tmhi history --json -s "${1:-1d}"
	[ "$RC" = 0 ] || fail "history --json failed ($RC)"
	jq -r --argjson base "$BASE" '.events[] | "\((.t - $base) / 60 | floor) \(.type)" + (
		if .type == "band" then " \(.from) -> \(.to)" + (if .nb_from then " tower \(.nb_from) -> \(.nb_to)" else "" end)
		elif .type == "tower" then " \(.nb_from) -> \(.nb_to)"
		elif .type == "gap" then " \(.dur / 60 | floor)m"
		else " \(.source) \(.result) (\(.from))" end)' "$T/out"
}

# json FILTER [FILE]: run jq on $T/out (or FILE), raw output
json() { jq -r "$1" "${2:-$T/out}"; }

# down_until MIN: the gateway doesn't answer before BASE + MIN
down_until() { echo $((BASE + $1 * 60)) >"$T/gw/down-until"; }

# --- assertions (they exit the test; set -e doesn't apply in run.sh) -------------------------------------------------------------

fail() {
	printf '    %s\n' "$@" >&2
	if [ -s "$T/err" ]; then sed 's/^/    stderr: /' "$T/err" >&2; fi
	exit 1
}

eq() { # ACTUAL EXPECTED [WHAT]
	[ "$1" = "$2" ] || fail "${3:-value}: expected [$2]" "${3:-value}: got      [$1]"
}

# has PATTERN [FILE]: FILE ($T/out) has a line containing PATTERN (fixed string)
has() {
	grep -qF -- "$1" "${2:-$T/out}" 2>/dev/null || {
		printf '    no line with [%s] in %s:\n' "$1" "${2:-output}" >&2
		sed 's/^/    | /' "${2:-$T/out}" >&2 2>/dev/null
		fail "missing: $1"
	}
}

hasnt() {
	if grep -qF -- "$1" "${2:-$T/out}" 2>/dev/null; then
		printf '    unexpected line with [%s] in %s:\n' "$1" "${2:-output}" >&2
		grep -F -- "$1" "${2:-$T/out}" | sed 's/^/    | /' >&2
		fail "unexpected: $1"
	fi
}

# lines FILE: number of lines (0 when missing)
lines() { if [ -f "$1" ]; then wc -l <"$1" | tr -d ' '; else echo 0; fi; }

# samples: history rows (not headers) on flash and in the RAM buffer
samples() { cat "$T"/hist/history-*.tsv "$RUN/history.buf" 2>/dev/null | grep -c '^[0-9]' || true; }
