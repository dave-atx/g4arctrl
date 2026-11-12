# History readers (AWK_LIB, `tmhi history`, `history --json`): what counts
# as a change of band or tower, and what counts as good.
# shellcheck shell=sh disable=SC2154 # T, RC: lib.sh

# Samples: reg band bw rsrp sinr id cid pci arfcn (see history() in lib.sh)
N41="registered n41 100 -94 23 1234567 101 123 501390"
N25="registered n25 20 -93 14 1234567 102 124 396970"

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
test_tower_id_seen_once_does_not_hold() {
	history <<-E
		0 $N41 x5
		5 registered n41 100 -94 23 7654321 201 222 501390
		6 registered n41 100 -94 23 7654000 201 222 501390 x5
	E
	clock 20
	eq "$(changes 1h)" "5 tower 1234567 -> 7654321
6 tower 7654321 -> 7654000" changes
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
