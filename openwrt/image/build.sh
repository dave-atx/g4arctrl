#!/bin/sh
# Build the Raspberry Pi 5 OpenWrt images: one per file in variants/, each
# with the packages in packages.txt plus its own. Every image includes the
# tmhi repository, so `apk upgrade` keeps tmhi current.
#
# Runs inside the OpenWrt Image Builder container for bcm27xx/bcm2712:
#   docker run --rm -v "$PWD:/src:ro" -v "$PWD/image:/out" \
#     ghcr.io/openwrt/imagebuilder:bcm27xx-bcm2712-25.12.6 \
#     sh /src/openwrt/image/build.sh /path/to/dir/with/apk /out [VARIANT...]
#
# Mount a directory on /builder/dl to keep downloaded packages between runs.
# OUT_DIR gets each image's files in OUT_DIR/<variant>/, and the images and
# manifests of all of them, with one sha256sums, in OUT_DIR itself.
#
# The images are meant to be published, so they carry no configuration: set
# the gateway password after flashing (LuCI: Status > Cellular > Settings, or
# uci set tmhi.main.password=...); sysupgrade keeps /etc/config/tmhi.
#
# IMAGE_TAG and IMAGE_REPO (default: dev, dave-atx/g4arctrl) go in each
# image's /etc/g4arctrl-image, which image-upgrade reads.

set -eu

[ $# -ge 2 ] || {
	echo "usage: $0 APK_DIR OUT_DIR [VARIANT...]" >&2
	exit 64
}
apk_dir=$1
out_dir=$2
shift 2
here=$(cd "$(dirname "$0")" && pwd)
repo_url=https://dave-atx.github.io/g4arctrl/packages.adb

if [ $# -eq 0 ]; then
	for f in "$here"/variants/*.txt; do
		set -- "$@" "$(basename "$f" .txt)"
	done
fi

# Package names in a list: comments and apk lines dropped, one line.
names() {
	sed -e 's/#.*//' -e '/^[[:space:]]*apk[[:space:]]/d' "$1" | tr -s ' \t\n' ' '
}

fetch() {
	if command -v curl >/dev/null; then
		curl -fsSL -o "$2" "$1"
	else
		wget -q -O "$2" "$1"
	fi
}

cd /builder
apk=/builder/staging_dir/host/bin/apk

# The Image Builder indexes whatever is in packages/ alongside the official
# feeds. That index is signed with a throwaway key that stays out of the image.
cp "$apk_dir"/tmhi-*.apk "$apk_dir"/luci-app-tmhi-*.apk packages/

files=$(mktemp -d)
mkdir -p "$files/etc/apk/keys" "$files/etc/apk/repositories.d"
cp "$here/../tmog4ar.pem" "$files/etc/apk/keys/tmog4ar.pem"
cat >"$files/etc/apk/repositories.d/customfeeds.list" <<EOF
# add your custom package feeds here
#
# http://www.example.com/path/to/files/packages.adb
$repo_url
EOF

# image-upgrade, and the hook directory it keeps across upgrades.
mkdir -p "$files/usr/sbin" "$files/lib/upgrade/keep.d"
cp "$here/image-upgrade" "$files/usr/sbin/image-upgrade"
chmod 755 "$files/usr/sbin/image-upgrade"
echo /etc/image-upgrade/ >"$files/lib/upgrade/keep.d/image-upgrade"

for variant; do
	list=$here/variants/$variant.txt
	[ -f "$list" ] || {
		echo "no such variant: $variant ($list)" >&2
		exit 64
	}
	echo "::group::$variant"

	cat >"$files/etc/g4arctrl-image" <<EOF
REPO=${IMAGE_REPO:-dave-atx/g4arctrl}
VARIANT=$variant
TAG=${IMAGE_TAG:-dev}
EOF

	# Packages from outside the feeds: download, check, add to packages/.
	# apk finds a local package by the file name <name>-<version>.apk, which
	# release assets often don't use, so name it from its own metadata.
	sed -n 's/^[[:space:]]*apk[[:space:]]\{1,\}//p' "$list" |
		while read -r url sum; do
			tmp=$(mktemp)
			fetch "$url" "$tmp"
			echo "$sum  $tmp" | sha256sum -c -
			nv=$("$apk" adbdump "$tmp" |
				awk '/^  name: / { n = $2 } /^  version: / { v = $2 } n && v { print n "-" v; exit }')
			[ -n "$nv" ] || {
				echo "::error::can't read the name and version of $url"
				exit 1
			}
			mv "$tmp" "packages/$nv.apk"
			echo "$url -> packages/$nv.apk"
		done

	make image \
		PROFILE=rpi-5 \
		PACKAGES="$(names "$here/packages.txt") $(names "$list")" \
		FILES="$files" \
		EXTRA_IMAGE_NAME="$variant" \
		BIN_DIR="$out_dir/$variant"
	echo "::endgroup::"
done

cd "$out_dir"
for variant; do
	cp "$variant"/*.img.gz "$variant"/*.manifest .
done
sha256sum ./*.img.gz ./*.manifest | sed 's| \./| |' >sha256sums
ls -l

# Fail if an image has an older version of a package in minimum-versions.txt.
bad=0
for manifest in ./*.manifest; do
	sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$here/minimum-versions.txt" |
		while read -r pkg min; do
			have=$(sed -n "s/^$pkg - //p" "$manifest")
			if [ -z "$have" ]; then
				echo "::error::$manifest: $pkg isn't in the image"
				exit 1
			fi
			if [ "$("$apk" version -t "$have" "$min")" = "<" ]; then
				echo "::error::$manifest: $pkg is $have, older than $min"
				exit 1
			fi
			echo "$manifest: $pkg $have (>= $min)"
		done || bad=1
done
exit "$bad"
