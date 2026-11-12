#!/bin/sh
# Runs the tests: every test_* function in tests/t-*.sh, each in its own
# subshell with a fresh fake router (see lib.sh).
#
#   sh tests/run.sh               all of them
#   sh tests/run.sh width tower   only tests whose file or name has one of these
#   TEST_SH=bash sh tests/run.sh  run tmhi under another shell
#
# Runs on a laptop and in an OpenWrt rootfs (busybox ash, awk and OpenWrt's
# jq), which is how CI runs it as well.
#
# shellcheck disable=SC1090,SC1091,SC2013 # test files are sourced by path; names are words

set -u
TESTS=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$TESTS")
TMHI=${TMHI:-$ROOT/tmhi} # TMHI=path: test another copy, e.g. the last release
export TESTS ROOT TMHI

pass=0 failed=''
for file in "$TESTS"/t-*.sh; do
	for name in $(sed -n 's/^\(test_[a-z0-9_]*\)() {$/\1/p' "$file"); do
		if [ $# -gt 0 ]; then
			want=0
			for p in "$@"; do
				case "${file##*/} $name" in *"$p"*) want=1 ;; esac
			done
			[ "$want" = 1 ] || continue
		fi
		if (
			. "$TESTS/lib.sh"
			setup
			trap teardown EXIT
			. "$file"
			"$name"
		); then
			pass=$((pass + 1))
			echo "ok    ${file##*/} $name"
		else
			failed="$failed ${file##*/}:$name"
			echo "FAIL  ${file##*/} $name"
		fi
	done
done

if [ -n "$failed" ]; then
	echo
	echo "$pass passed, $(echo "$failed" | wc -w | tr -d ' ') failed:$failed"
	exit 1
fi
echo "$pass passed"
