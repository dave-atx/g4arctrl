# Transitional packages: tmog4ar was renamed tmhi in 0.4.0. Routers that have
# tmog4ar and luci-app-tmog4ar get these on `apk upgrade`, which pulls in tmhi
# and luci-app-tmhi and moves the settings and history over (files/). Only in
# this repository's feed and images, never upstream. They can go once the
# routers that had tmog4ar have upgraded.

include $(TOPDIR)/rules.mk

PKG_NAME:=tmog4ar
PKG_VERSION:=0.4.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Dave Marquard <dave@marquard.org>

include $(INCLUDE_DIR)/package.mk

define Package/tmog4ar
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Transitional package: tmog4ar is now tmhi
  URL:=https://github.com/dave-atx/g4arctrl
  PKGARCH:=all
  DEPENDS:=+tmhi
endef

define Package/tmog4ar/description
  tmog4ar is now called tmhi. This package installs tmhi, moves the tmog4ar
  settings, history and notification hooks to it, and can then be removed.
endef

define Package/luci-app-tmog4ar
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Transitional package: luci-app-tmog4ar is now luci-app-tmhi
  URL:=https://github.com/dave-atx/g4arctrl
  PKGARCH:=all
  DEPENDS:=+luci-app-tmhi
endef

define Package/luci-app-tmog4ar/description
  luci-app-tmog4ar is now called luci-app-tmhi. This package installs it and
  can then be removed.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

# The old command name, for scripts and cron jobs that still use it.
define Package/tmog4ar/install
	$(INSTALL_DIR) $(1)/etc/uci-defaults $(1)/usr/bin
	$(INSTALL_DATA) ./files/tmog4ar-to-tmhi $(1)/etc/uci-defaults/90-tmog4ar-to-tmhi
	$(LN) tmhi $(1)/usr/bin/tmog4ar
endef

define Package/luci-app-tmog4ar/install
	true
endef

$(eval $(call BuildPackage,tmog4ar))
$(eval $(call BuildPackage,luci-app-tmog4ar))
