#!/bin/sh
# Make tmhi's source archive, tmhi-<version>.tar.xz, in OUT_DIR and print its
# sha256. The tmhi package's Makefile downloads this from the GitHub release
# (PKG_SOURCE_URL) and checks it against PKG_HASH; a vX.Y.Z release uploads it.
#
#   openwrt/source-tarball.sh OUT_DIR
#
# Only the files the package installs (and LICENSE) go in, with fixed owners,
# modes and times, so the same files give the same archive on any machine with
# GNU tar and xz. A change to one of them means a new PKG_HASH at release.

set -eu

[ $# -eq 1 ] || {
	echo "usage: $0 OUT_DIR" >&2
	exit 64
}
top=$(cd "$(dirname "$0")/.." && pwd)
out=$(cd "$1" && pwd)
version=$(sed -n 's/^VERSION=\([^ ]*\).*/\1/p' "$top/tmhi")
name=tmhi-$version

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/$name"
install -m 755 "$top/tmhi" "$stage/$name/tmhi"
for f in tmhi.init tmhi.config tmhi.hotplug LICENSE; do
	install -m 644 "$top/$f" "$stage/$name/$f"
done
chmod 755 "$stage/$name"

# 2026-01-01 00:00 UTC: any fixed time does.
tar -C "$stage" --sort=name --format=gnu --owner=0 --group=0 --numeric-owner \
	--mtime=@1767225600 -cf - "$name" | xz -9 -T1 >"$out/$name.tar.xz"
sha256sum "$out/$name.tar.xz" | cut -d ' ' -f 1
