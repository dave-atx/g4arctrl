#!/bin/sh
# Build a Raspberry Pi 5 OpenWrt image that includes tmog4ar and trusts the
# tmog4ar package repository, so `apk upgrade` keeps it current.
#
# Runs inside the OpenWrt Image Builder container for bcm27xx/bcm2712:
#   docker run --rm -v "$PWD:/src:ro" -v "$PWD/image:/out" \
#     ghcr.io/openwrt/imagebuilder:bcm27xx-bcm2712-25.12.6 \
#     sh /src/openwrt/image/build.sh /path/to/dir/with/apk /out
#
# The image is meant to be published, so it carries no configuration: set the
# gateway password in /etc/tmog4ar.conf after flashing (sysupgrade keeps it).

set -eu

[ $# -eq 2 ] || { echo "usage: $0 APK_DIR OUT_DIR" >&2; exit 64; }
apk_dir=$1
out_dir=$2
here=$(cd "$(dirname "$0")" && pwd)
repo_url=https://dave-atx.github.io/g4arctrl/packages.adb

cd /builder

# The Image Builder indexes whatever is in packages/ alongside the official
# feeds. That index is signed with a throwaway key that stays out of the image.
cp "$apk_dir"/tmog4ar-*.apk packages/

files=$(mktemp -d)
mkdir -p "$files/etc/apk/keys" "$files/etc/apk/repositories.d"
cp "$here/../tmog4ar.pem" "$files/etc/apk/keys/tmog4ar.pem"
cat > "$files/etc/apk/repositories.d/customfeeds.list" <<EOF
# add your custom package feeds here
#
# http://www.example.com/path/to/files/packages.adb
$repo_url
EOF

packages="$(grep -v '^#' "$here/packages.txt" | tr '\n' ' ') tmog4ar"

make image \
	PROFILE=rpi-5 \
	PACKAGES="$packages" \
	FILES="$files" \
	EXTRA_IMAGE_NAME=tmog4ar \
	BIN_DIR="$out_dir"
