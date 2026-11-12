include $(TOPDIR)/rules.mk

PKG_NAME:=tmhi
PKG_VERSION:=0.3.4
PKG_RELEASE:=1

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.xz
PKG_SOURCE_URL:=https://github.com/dave-atx/g4arctrl/releases/download/v$(PKG_VERSION)
PKG_HASH:=3cf2c119668d8f5db0ed630613dde06a28a24eff32125d74cdc934319743d2ee

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Dave Marquard <dave@marquard.org>

include $(INCLUDE_DIR)/package.mk

define Package/tmhi
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Status, history and stuck-band detection for T-Mobile Home Internet
  URL:=https://github.com/dave-atx/g4arctrl
  PKGARCH:=all
  # Runtime-only dependencies: the script needs curl and jq on the device, but
  # nothing is compiled against them, so don't make the SDK build them.
  # curl 7.55 added -H @file, which the script uses for the auth header.
  EXTRA_DEPENDS:=curl (>=7.55), jq (>=1.6)
endef

define Package/tmhi/description
  Shows band, channel width and signal quality from a T-Mobile Home Internet
  gateway (Arcadyan KVD21 / TMO-G4AR, Sagemcom Fast 5688W, Sercomm TMO-G4SE)
  on the router's WAN side, logs them once a minute, and tells you when the
  gateway has been stuck on the wrong band long enough to need a reboot.
endef

define Package/tmhi/conffiles
/etc/config/tmhi
/etc/hotplug.d/tmhi/50-example
endef

# Appended to the post-install and post-upgrade scripts, after default_postinst.
# Its "start" leaves a running daemon alone (procd sees the same command), and
# that shell keeps running the old script, so restart it on an upgrade. Only
# if it's running: someone who stopped it keeps it stopped. Stopping flushes
# the RAM buffer first.
define Package/tmhi/postinst
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ] && [ "$${PKG_UPGRADE}" = 1 ] && /etc/init.d/tmhi running; then
	/etc/init.d/tmhi restart
fi
endef

define Build/Compile
endef

define Package/tmhi/install
	$(INSTALL_DIR) $(1)/usr/bin $(1)/etc/init.d $(1)/etc/config $(1)/etc/hotplug.d/tmhi $(1)/lib/upgrade/keep.d
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/tmhi $(1)/usr/bin/tmhi
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/tmhi.init $(1)/etc/init.d/tmhi
	# INSTALL_CONF is mode 600: the file holds the gateway's admin password.
	$(INSTALL_CONF) $(PKG_BUILD_DIR)/tmhi.config $(1)/etc/config/tmhi
	# Notification hooks: an example that does nothing until edited.
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/tmhi.hotplug $(1)/etc/hotplug.d/tmhi/50-example
	# Keep history (the default history_dir) and every notification hook,
	# including ones added by hand, across sysupgrade.
	printf '%s\n' /root/.tmhi/ /etc/hotplug.d/tmhi/ > $(1)/lib/upgrade/keep.d/tmhi
endef

$(eval $(call BuildPackage,tmhi))
