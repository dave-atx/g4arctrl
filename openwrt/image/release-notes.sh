#!/bin/sh
# Print Markdown release notes listing, for each image, the packages that
# changed since the previous release: updated, added and removed.
#
#   release-notes.sh PREV_TAG PREV_DIR CUR_DIR
#
# PREV_DIR and CUR_DIR hold the images' .manifest files (lines of
# "name - version"). Images are matched by the variant in the file name, so a
# new OpenWrt version still compares with the old one. PREV_TAG may be empty
# when there's no previous release.

set -eu

[ $# -eq 3 ] || {
	echo "usage: $0 PREV_TAG PREV_DIR CUR_DIR" >&2
	exit 64
}
prev_tag=$1
prev_dir=$2
cur_dir=$3

# openwrt-25.12.6-tmog4ar-bcm27xx-bcm2712-rpi-5.manifest -> tmog4ar
variant() {
	basename "$1" .manifest | sed 's/^openwrt-[^-]*-//; s/-bcm27xx-bcm2712-rpi-5$//'
}

echo "## Packages"
echo
for cur in "$cur_dir"/*.manifest; do
	v=$(variant "$cur")
	prev=
	for f in "$prev_dir"/*.manifest; do
		[ -f "$f" ] && [ "$(variant "$f")" = "$v" ] && prev=$f
	done

	echo "### \`$v\` image"
	echo
	if [ -z "$prev" ]; then
		echo "New image: $(wc -l <"$cur" | tr -d ' ') packages, listed in its manifest."
		echo
		continue
	fi

	awk -v tag="$prev_tag" '
		{ split($0, f, " - ") }
		FNR == NR { old[f[1]] = f[2]; next }
		{ new[f[1]] = f[2] }
		END {
			n = 0
			for (p in new) if (p in old && old[p] != new[p]) up[++n] = p
			if (n) {
				sort(up, n)
				print "| Updated | " tag " | This release |"
				print "|---|---|---|"
				for (i = 1; i <= n; i++) print "| " up[i] " | " old[up[i]] " | " new[up[i]] " |"
				print ""
			}
			list("Added", new, old)
			list("Removed", old, new)
			if (!n && !listed) print "No package changes since " tag ".\n"
		}
		function list(title, a, b,    p, k, x, i) {
			k = 0
			for (p in a) if (!(p in b)) x[++k] = p
			if (!k) return
			sort(x, k)
			printf "%s: ", title
			for (i = 1; i <= k; i++) printf "%s%s %s", (i > 1 ? ", " : ""), x[i], a[x[i]]
			print "\n"
			listed = 1
		}
		function sort(a, n,    i, j, t) {
			for (i = 2; i <= n; i++)
				for (j = i; j > 1 && a[j - 1] > a[j]; j--) {
					t = a[j]; a[j] = a[j - 1]; a[j - 1] = t
				}
		}
	' "$prev" "$cur"
done
