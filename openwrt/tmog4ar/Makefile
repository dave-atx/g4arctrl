# OpenWrt package for tmog4ar. Build it with the OpenWrt SDK by adding this
# directory's parent as a feed:
#   echo "src-link tmog4ar /path/to/g4arctrl/openwrt" >> feeds.conf
#   ./scripts/feeds update tmog4ar && ./scripts/feeds install tmog4ar
#   make package/tmog4ar/compile

include $(TOPDIR)/rules.mk

PKG_NAME:=tmog4ar
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Dave Marquard <8920060+dave-atx@users.noreply.github.com>

include $(INCLUDE_DIR)/package.mk

# The files live at the top of the repository. CURDIR is the real path even
# when the SDK reaches this directory through a feed symlink.
REPO_DIR:=$(CURDIR)/../..

define Package/tmog4ar
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Status, history and stuck-band detection for the T-Mobile TMO-G4AR
  URL:=https://github.com/dave-atx/g4arctrl
  PKGARCH:=all
  # Runtime-only dependencies: the script needs curl and jq on the device, but
  # nothing is compiled against them, so don't make the SDK build them.
  # curl 7.55 added -H @file, which the script uses for the auth header.
  EXTRA_DEPENDS:=curl (>=7.55), jq (>=1.6)
endef

define Package/tmog4ar/description
  Shows band, channel width and signal quality from a T-Mobile Home Internet
  TMO-G4AR (Arcadyan) gateway, logs them once a minute, and tells you when the
  gateway has been stuck on the wrong band long enough to need a reboot.
endef

define Package/tmog4ar/conffiles
/etc/tmog4ar.conf
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/tmog4ar/install
	$(INSTALL_DIR) $(1)/usr/bin $(1)/etc/init.d $(1)/lib/upgrade/keep.d
	$(INSTALL_BIN) $(REPO_DIR)/tmog4ar $(1)/usr/bin/tmog4ar
	$(INSTALL_BIN) $(REPO_DIR)/tmog4ar.init $(1)/etc/init.d/tmog4ar
	$(INSTALL_CONF) $(REPO_DIR)/tmog4ar.conf.example $(1)/etc/tmog4ar.conf
	# Keep history across sysupgrade.
	echo /root/.tmog4ar/ > $(1)/lib/upgrade/keep.d/tmog4ar
endef

$(eval $(call BuildPackage,tmog4ar))
