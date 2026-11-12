# openwrt/image/image-upgrade: finds the newest release's image for this
# router's variant, says what would change, and upgrades with a checked
# download. Run from a copy with its fixed paths (/etc, /tmp, /lib, /proc,
# /dev/tty) moved into $T; GitHub is the fake curl's $T/web.
# shellcheck shell=sh disable=SC2154 # T, RC: lib.sh

API=api.github.com/repos/dave-atx/g4arctrl/releases/latest
DL=github.com/dave-atx/g4arctrl/releases/download

# iu_setup: an image router on OpenWrt 25.12.5 with tmhi 0.3.4, from release
# v0.3.4 of the given variant (the image's marker file).
iu_setup() {
	mkdir -p "$T/etc/image-upgrade" "$T/lib/apk/db" "$T/web/${API%/*}" "$T/proc"
	sed -e "s#/etc/#$T/etc/#g" -e "s#/tmp/image-upgrade#$T/work#" -e "s#/lib/apk/#$T/lib/apk/#" \
		-e "s#/proc/mounts#$T/proc/mounts#" -e "s#/dev/tty#$T/tty#" \
		"$ROOT/openwrt/image/image-upgrade" >"$T/image-upgrade"
	printf "REPO=dave-atx/g4arctrl\nVARIANT=%s\nTAG=v0.3.4\n" "$1" >"$T/etc/g4arctrl-image"
	echo "DISTRIB_RELEASE='25.12.5'" >"$T/etc/openwrt_release"
	printf 'P:tmhi\nV:0.3.4\n\nP:luci-app-tmhi\nV:0.3.4\n\nP:base-files\nV:1\n\nP:extra\nV:2.0\n' >"$T/lib/apk/db/installed"
	echo "/dev/root /rom squashfs ro 0 0" >"$T/proc/mounts"
}

# release TAG OPENWRT VARIANT... : the latest release, with a manifest and
# images for each variant. The manifest has tmhi 0.4.0 and a new package.
release() {
	tag=$1 owrt=$2
	shift 2
	mkdir -p "$T/web/$DL/$tag"
	: >"$T/web/$DL/$tag/sha256sums"
	assets=''
	for v in "$@"; do
		base="openwrt-$owrt-$v-bcm27xx-bcm2712-rpi-5"
		printf 'base-files - 1\nluci-app-tmhi - 0.4.0\nnew-pkg - 1.0\ntmhi - 0.4.0\n' >"$T/web/$DL/$tag/$base.manifest"
		for fs in squashfs ext4; do
			echo "image $v $fs" >"$T/web/$DL/$tag/$base-$fs-sysupgrade.img.gz"
			(cd "$T/web/$DL/$tag" && sha256sum "$base-$fs-sysupgrade.img.gz") >>"$T/web/$DL/$tag/sha256sums"
		done
		assets="$assets $base.manifest $base-squashfs-sysupgrade.img.gz $base-ext4-sysupgrade.img.gz"
	done
	assets="$assets sha256sums"
	for a in $assets; do echo "$a"; done | jq -R --arg u "https://$DL/$tag/" '{name: ., browser_download_url: ($u + .)}' |
		jq -s --arg tag "$tag" '{tag_name: $tag, assets: .}' >"$T/web/$API"
}

iu() {
	RC=0
	${TEST_SH:-sh} "$T/image-upgrade" "$@" >"$T/out" 2>"$T/err" || RC=$?
}

test_check_shows_changes() {
	iu_setup tmhi
	release v0.4.0 25.12.6 tmhi tmhi-cake-adapt
	iu check
	eq "$RC" 2 "exit status"
	has "Release: v0.3.4 installed, v0.4.0 latest"
	has "OpenWrt: 25.12.5 -> 25.12.6"
	has "tmhi                             0.3.4 -> 0.4.0"
	has "new-pkg                          1.0"
	has "extra                            2.0"
	hasnt "older!"
	[ ! -f "$T/sysupgrade" ] || fail "upgraded on check"
}

test_check_up_to_date() {
	iu_setup tmhi
	release v0.3.4 25.12.5 tmhi
	printf 'base-files - 1\nluci-app-tmhi - 0.3.4\nextra - 2.0\ntmhi - 0.3.4\n' \
		>"$T/web/$DL/v0.3.4/openwrt-25.12.5-tmhi-bcm27xx-bcm2712-rpi-5.manifest"
	iu
	eq "$RC" 0 "exit status"
	has "Up to date."
}

test_check_flags_an_older_package() {
	iu_setup tmhi
	printf 'P:tmhi\nV:0.5.0\n' >"$T/lib/apk/db/installed"
	release v0.4.0 25.12.6 tmhi
	iu check
	has "0.5.0 -> 0.4.0  (older!)"
}

# The images were tmog4ar and tmog4ar-cake-adapt before 0.4.0: a router
# with the old name in its marker gets the renamed image, not the other one.
test_old_variant_names_map_to_new() {
	iu_setup tmog4ar-cake-adapt
	release v0.4.0 25.12.6 tmhi tmhi-cake-adapt
	iu check
	eq "$RC" 2 "exit status"
	has "Image:   dave-atx/g4arctrl, tmhi-cake-adapt"
	has "GET https://$DL/v0.4.0/openwrt-25.12.6-tmhi-cake-adapt-bcm27xx-bcm2712-rpi-5.manifest" "$T/requests"
}

test_variant_option_overrides_marker() {
	iu_setup tmhi
	rm -f "${T:?}/etc/g4arctrl-image"
	iu check
	eq "$RC" 1 "exit status without a marker"
	has "give the image variant with -v" "$T/err"
	release v0.4.0 25.12.6 tmhi tmhi-cake-adapt
	iu -v tmog4ar check
	eq "$RC" 2 "exit status"
	has "Image:   dave-atx/g4arctrl, tmhi"
}

test_release_without_the_variant() {
	iu_setup tmhi-cake-adapt
	release v0.4.0 25.12.6 tmhi
	iu check
	eq "$RC" 1 "exit status"
	has "v0.4.0 has no tmhi-cake-adapt image" "$T/err"
}

test_upgrade() {
	iu_setup tmhi
	release v0.4.0 25.12.6 tmhi tmhi-cake-adapt
	printf '#!/bin/sh\necho backup >"%s/hook-ran"\n' "$T" >"$T/etc/image-upgrade/pre-upgrade"
	chmod +x "$T/etc/image-upgrade/pre-upgrade"
	echo y >"$T/tty"
	iu upgrade
	eq "$RC" 0 "exit status"
	eq "$(cat "$T/sysupgrade")" "upgrade openwrt-25.12.6-tmhi-bcm27xx-bcm2712-rpi-5-squashfs-sysupgrade.img.gz" sysupgrade
	[ -f "$T/hook-ran" ] || fail "pre-upgrade hook didn't run"
	has "sysupgrade keeps 2 files"
}

test_upgrade_ext4() {
	iu_setup tmhi
	echo "/dev/root / ext4 rw 0 0" >"$T/proc/mounts"
	release v0.4.0 25.12.6 tmhi
	echo y >"$T/tty"
	iu upgrade
	eq "$(cat "$T/sysupgrade")" "upgrade openwrt-25.12.6-tmhi-bcm27xx-bcm2712-rpi-5-ext4-sysupgrade.img.gz" sysupgrade
}

test_upgrade_declined() {
	iu_setup tmhi
	release v0.4.0 25.12.6 tmhi
	echo n >"$T/tty"
	iu upgrade
	eq "$RC" 1 "exit status"
	has "not upgrading" "$T/err"
	[ ! -f "$T/sysupgrade" ] || fail "upgraded"
}

test_upgrade_checksum_mismatch() {
	iu_setup tmhi
	release v0.4.0 25.12.6 tmhi
	echo corrupted >"$T/web/$DL/v0.4.0/openwrt-25.12.6-tmhi-bcm27xx-bcm2712-rpi-5-squashfs-sysupgrade.img.gz"
	echo y >"$T/tty"
	iu upgrade
	eq "$RC" 1 "exit status"
	has "checksum mismatch" "$T/err"
	[ ! -f "$T/sysupgrade" ] || fail "upgraded"
}

test_upgrade_hook_fails() {
	iu_setup tmhi
	release v0.4.0 25.12.6 tmhi
	printf '#!/bin/sh\nexit 1\n' >"$T/etc/image-upgrade/pre-upgrade"
	chmod +x "$T/etc/image-upgrade/pre-upgrade"
	echo y >"$T/tty"
	iu upgrade
	eq "$RC" 1 "exit status"
	has "pre-upgrade failed; not upgrading" "$T/err"
	[ ! -f "$T/sysupgrade" ] || fail "upgraded"
}

test_upgrade_image_rejected() {
	iu_setup tmhi
	release v0.4.0 25.12.6 tmhi
	: >"$T/sysupgrade-reject"
	echo y >"$T/tty"
	iu upgrade
	eq "$RC" 1 "exit status"
	has "sysupgrade rejected" "$T/err"
	[ ! -f "$T/sysupgrade" ] || fail "upgraded"
}
