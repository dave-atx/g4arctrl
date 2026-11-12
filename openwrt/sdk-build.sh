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
# bin/packages/<arch>/action/.

set -eu

cd /builder
if [ ! -d scripts ] && [ -x setup.sh ]; then
	./setup.sh
fi
[ -d scripts ] || {
	echo "this container has no SDK" >&2
	exit 1
}

# The Makefiles read files from the top of the repository, and the build
# writes next to them, so work on a copy.
cp -r /src /builder/src

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
