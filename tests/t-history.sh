# History readers (AWK_LIB, `tmhi history`, `history --json`): what counts
# as a change of band or tower, and what counts as good.
# shellcheck shell=sh disable=SC2154 # T, RC: lib.sh

# Samples: reg band bw rsrp sinr id cid pci arfcn (see history() in lib.sh)
N41="registered n41 100 -94 23 1234567 101 123 501390"
N41_NOWIDTH="registered n41 - -94 23 1234567 101 - -"
N25="registered n25 20 -93 14 1234567 102 124 396970"

# 0.4.0 upgrade on a real router: one sample lacked the cell telemetry (no
# login yet), so it had no width, and the change list showed
# "n41 100 MHz -> n41" and back again.
test_width_missing_for_one_sample_is_no_change() {
	history <<-E
		0 $N41 x10
		10 $N41_NOWIDTH
		11 $N41 x10
	E
	clock 30
	eq "$(changes 1h)" "" changes
	eq "$(json '[.bands[].key] | join(",")')" "n41 100 MHz" bands
	tmhi history -s 1h
	hasnt "→ n41"
}

# A held width still decides good / bad: a narrow n41 stays bad.
test_held_width_still_counts_as_narrow() {
	history <<-E
		0 registered n41 20 -94 23 1234567 101 123 501390 x5
		5 $N41_NOWIDTH x2
		7 registered n41 20 -94 23 1234567 101 123 501390 x5
	E
	clock 20
	eq "$(changes 1h)" "" changes
	eq "$(json '[.bands[] | "\(.key) \(.good) \(.samples)"] | join(",")')" "n41 20 MHz false 12" bands
}

# Telemetry gone for good (password removed): after 5 samples the width
# counts as unknown.
test_width_missing_for_long_is_a_change() {
	history <<-E
		0 $N41 x5
		5 $N41_NOWIDTH x10
	E
	clock 20
	eq "$(changes 1h)" "10 band n41 100 MHz -> n41" changes
}

# A width isn't carried to another band, another tower, or across an outage.
test_width_not_held_across_band_tower_or_outage() {
	history <<-E
		0 $N41 x5
		5 registered n25 - -93 14 1234567 102 - -
		6 $N41 x5
		11 registered n41 - -94 23 7654321 201 - -
		12 $N41 x5
		17 unreachable
		18 $N41_NOWIDTH
	E
	clock 30
	eq "$(changes 1h)" "5 band n41 100 MHz -> n25
6 band n25 -> n41 100 MHz
11 band n41 100 MHz -> n41 tower 1234567 -> 7654321
12 band n41 -> n41 100 MHz tower 7654321 -> 1234567
17 band n41 100 MHz -> (unreachable)
18 band (unreachable) -> n41" changes
}

test_band_change_and_good() {
	cfg min_bw 40
	history <<-E
		0 $N41 x5
		5 $N25 x5
		10 $N41 x5
	E
	clock 20
	eq "$(changes 1h)" "5 band n41 100 MHz -> n25 20 MHz
10 band n25 20 MHz -> n41 100 MHz" changes
	eq "$(json '[.bands[] | "\(.key) \(.good) \(.samples)"] | join(",")')" "n41 100 MHz true 10,n25 20 MHz false 5" bands
	tmhi history -s 1h
	has "n41 100 MHz → n25 20 MHz"
	has "good = registered on n41, at least 40 MHz wide"
}

test_preferred_bands_and_lte_key() {
	cfg preferred_band "n41,b66"
	cfg min_bw 20
	history <<-E
		0 registered b66 20 -100 8 123456 11 210 66786 x5
		5 $N25 x5
	E
	clock 20
	changes 1h >/dev/null
	eq "$(json '[.bands[] | "\(.key) \(.good)"] | join(",")')" "LTE b66 20 MHz true,n25 20 MHz false" bands
}

test_narrow_preferred_band_is_bad() {
	cfg min_bw 60
	history <<-E
		0 registered n41 40 -94 23 1234567 101 123 501390 x5
	E
	clock 10
	changes 1h >/dev/null
	eq "$(json '.bands[0].good')" false good
}

# The gateway reports the tower id with one bit missing (gNB 1234567 as
# 185991, bit 20) for a while, same cell id, PCI and channel: not a move,
# however long it lasts.
test_tower_one_bit_glitch_is_not_a_move() {
	history <<-E
		0 $N41 x5
		5 registered n41 100 -94 23 185991 101 123 501390 x20
		25 $N41 x5
	E
	clock 40
	eq "$(changes 1h)" "" changes
	eq "$(json '[.towers[].id] | join(",")')" 1234567 towers
}

# Issue #4: after a move, the previous tower id (one bit off) and its cell
# id show up for a sample or two while on the new tower.
test_tower_stale_id_after_move_is_not_a_move() {
	history <<-E
		0 $N41 x5
		5 registered n41 100 -94 23 7654321 201 222 501390 x3
		8 registered n41 100 -94 23 185991 101 222 501390 x2
		10 registered n41 100 -94 23 7654321 201 222 501390 x5
	E
	clock 20
	eq "$(changes 1h)" "5 tower 1234567 -> 7654321" changes
}

# A cell re-homed to another gNB id keeps its PCI and channel: after 5
# samples the new id counts.
test_tower_new_id_on_same_cell_counts_after_5() {
	history <<-E
		0 $N41 x5
		5 registered n41 100 -94 23 2345678 101 123 501390 x10
	E
	clock 20
	eq "$(changes 1h)" "10 tower 1234567 -> 2345678" changes
}

# Right after a move the first sample can carry yet another id: an id seen
# only once doesn't hold.
# Right after a move the first sample can report yet another id, then the
# right one on the same PCI and channel: one move, to the right one.
test_tower_id_seen_once_after_move_is_the_next_one() {
	history <<-E
		0 $N41 x5
		5 registered n41 100 -94 23 7654321 201 222 501390
		6 registered n41 100 -94 23 7654000 202 222 501390 x5
	E
	clock 20
	eq "$(changes 1h)" "5 tower 1234567 -> 7654000" changes
	eq "$(json '[.towers[].id] | join(",")')" "7654000,1234567" towers
	tmhi history -s 1h
	hasnt "7654321"
}

# The same on a move to another band, as seen on a real router: the stray
# id had a cell id of its own.
test_tower_id_seen_once_on_band_change() {
	history <<-E
		0 $N41 x5
		5 registered n25 20 -93 14 7654321 3 124 396970
		6 registered n25 20 -93 14 7654000 23 124 396970 x5
	E
	clock 20
	eq "$(changes 1h)" "5 band n41 100 MHz -> n25 20 MHz tower 1234567 -> 7654000" changes
}

# A tower for one sample on another PCI or channel than the next sample is
# a real (short) move.
test_tower_one_sample_on_other_cell_counts() {
	history <<-E
		0 $N41 x5
		5 registered n41 100 -94 23 7654321 201 222 501390
		6 $N41 x5
	E
	clock 20
	eq "$(changes 1h)" "5 tower 1234567 -> 7654321
6 tower 7654321 -> 1234567" changes
}

test_named_tower() {
	tower nr 1234567 "Water tower" 47.62 -122.19
	history <<-E
		0 $N41 x5
	E
	clock 10
	tmhi history -s 1h
	has "Water tower (gNB 1234567)"
}

# Files from older versions have fewer columns, in another order; readers
# re-map at every header line.
test_old_columns_still_read() {
	{
		printf 'ts\treg\tnr_bands\tnr_rsrp\tnr_bw\n'
		i=0
		while [ $i -lt 5 ]; do
			printf '%s\tregistered\tn25\t-93\t20\n' $((BASE + i * 60))
			i=$((i + 1))
		done
	} >"$T/hist/history-2026-11-03.tsv"
	history <<-E
		5 $N41 x5
	E
	clock 20
	eq "$(changes 1h)" "5 band n25 20 MHz -> n41 100 MHz" changes
}

test_reboot_events_merged() {
	history <<-E
		0 $N25 x5
		7 $N41 x5
	E
	events <<-E
		5 auto ok n25 20 MHz
		15 manual noanswer n41 100 MHz
	E
	clock 20
	eq "$(changes 1h)" "5 reboot auto ok (n25 20 MHz)
7 band n25 20 MHz -> n41 100 MHz
15 reboot manual noanswer (n41 100 MHz)" changes
	tmhi history -s 1h
	has "gateway reboot  (automatic, was on n25 20 MHz)"
}

test_gap_is_shown() {
	history <<-E
		0 $N41 x5
		35 $N41 x5
	E
	clock 45
	eq "$(changes 1h)" "4 gap 31m" changes
	tmhi history -s 1h
	has "no samples for 31m"
}

test_since_limits_the_window() {
	history <<-E
		0 $N25 x5
		60 $N41 x5
	E
	clock 70
	eq "$(changes 30m)" "" changes
	eq "$(json .samples)" 5 samples
}

test_no_history() {
	clock 10
	tmhi history
	eq "$RC" 1 "exit status"
	has "no history" "$T/err"
	tmhi history --json
	eq "$RC" 0 "json exit status"
	eq "$(json .samples)" 0 samples
}

test_update_events_merged() {
	history <<-E
		0 $N41 x10
	E
	events <<-E
		3 manual ok n41 100 MHz
	E
	printf '%s\tupdate\t1.00.18\t1.00.20\n' $((BASE + 5 * 60)) >>"$T/hist/events.tsv"
	clock 20
	eq "$(changes 1h)" "3 reboot manual ok (n41 100 MHz)
5 update 1.00.18 -> 1.00.20" changes
	tmhi history -s 1h
	has "gateway software update  (1.00.18 → 1.00.20)"
}

# The gateway not answering around an update is the update restarting it:
# one change, not an outage and back. An outage further away still shows.
test_unreachable_around_update_is_the_update() {
	history <<-E
		0 $N41 x10
		10 unreachable x2
		12 $N41 x10
		22 unreachable x2
		24 $N41 x5
	E
	printf '%s\tupdate\t1.00.18\t1.00.20\n' $((BASE + 10 * 60 + 30)) >"$T/hist/events.tsv"
	clock 30
	eq "$(changes 1h)" "10 update 1.00.18 -> 1.00.20
22 band n41 100 MHz -> (unreachable)
24 band (unreachable) -> n41 100 MHz" changes
	tmhi history -s 1h
	eq "$(grep -c 'n41 100 MHz → (unreachable)' "$T/out")" 1 "outages in the text changes"
}

# The one-bit glitch on the first sample of the window: with nothing before
# it to compare, it counted as the tower, and the next sample as a move to
# the real one. Samples before the window now set the tower and width the
# window starts from.
test_tower_glitch_at_start_of_window_is_not_a_move() {
	history <<-E
		0 $N41 x10
		10 registered n41 100 -94 23 185991 101 123 501390
		11 $N41 x59
	E
	clock 70
	eq "$(changes 1h)" "" changes
	eq "$(json '[.towers[].id] | join(",")')" 1234567 towers
	tmhi history -s 1h
	hasnt "185991"
}

test_width_missing_at_start_of_window_is_no_change() {
	history <<-E
		0 $N41 x10
		10 $N41_NOWIDTH
		11 $N41 x59
	E
	clock 70
	eq "$(changes 1h)" "" changes
	eq "$(json '[.bands[].key] | join(",")')" "n41 100 MHz" bands
}
