#!/bin/sh
# Build tmhi and luci-app-tmhi (and the transitional tmog4ar packages), and a
# signed index, in the OpenWrt SDK container. Release containers already hold
# the SDK, so nothing comes from the OpenWrt download mirrors; the feeds come
# from GitHub. Snapshot containers (sdk:<arch>-main) download the SDK first.
#
#   docker run --rm -e PRIVATE_KEY -v "$PWD:/src:ro" -v "$PWD/bin:/builder/bin" \
#     ghcr.io/openwrt/sdk:aarch64_generic-25.12.6 sh /src/openwrt/sdk-build.sh
#
# PRIVATE_KEY (optional) is the apk signing key. Without it, the index is
# signed with the SDK's own throwaway key. Packages end up in
# bin/packages/<arch>/action/, and tmhi's source archive in bin/source/.
#
# tmhi is built from its source archive, made here from this checkout
# (source-tarball.sh) rather than downloaded: before a release it isn't on
# GitHub yet. With RELEASE=1 (a vX.Y.Z tag) its sha256 has to match PKG_HASH in
# openwrt/tmhi/Makefile; otherwise a mismatch is only a warning, and the build
# uses the archive's own hash.

set -eu

cd /builder
if [ ! -d scripts ] && [ -x setup.sh ]; then
	./setup.sh
fi
[ -d scripts ] || {
	echo "this container has no SDK" >&2
	exit 1
}

# The build writes next to the Makefiles, so work on a copy.
cp -r /src /builder/src

mkdir -p dl bin/source
hash=$(sh /builder/src/openwrt/source-tarball.sh dl)
cp dl/tmhi-*.tar.xz bin/source/
want=$(sed -n 's/^PKG_HASH:=//p' /builder/src/openwrt/tmhi/Makefile)
if [ "$hash" != "$want" ]; then
	if [ "${RELEASE:-}" = 1 ]; then
		echo "::error::PKG_HASH in openwrt/tmhi/Makefile should be $hash" >&2
		exit 1
	fi
	echo "::warning::source archive changed: PKG_HASH should be $hash at the next release" >&2
	sed -i "s/^PKG_HASH:=.*/PKG_HASH:=$hash/" /builder/src/openwrt/tmhi/Makefile
fi

sed -e 's,https://git.openwrt.org/feed/,https://github.com/openwrt/,' \
	-e 's,https://git.openwrt.org/openwrt/,https://github.com/openwrt/,' \
	-e 's,https://git.openwrt.org/project/,https://github.com/openwrt/,' \
	feeds.conf.default >feeds.conf
echo "src-link action /builder/src/openwrt" >>feeds.conf

./scripts/feeds update -a
./scripts/feeds install -p action tmhi luci-app-tmhi tmog4ar luci-app-tmog4ar
make defconfig

signed=
if [ -n "${PRIVATE_KEY:-}" ]; then
	printf '%s\n' "$PRIVATE_KEY" >private-key.pem
	signed=y
fi

# Targets are directories: openwrt/tmog4ar/ builds both transitional packages.
make -j"$(nproc)" package/tmhi/compile package/luci-app-tmhi/compile package/tmog4ar/compile
make CONFIG_SIGNED_PACKAGES="$signed" package/index
