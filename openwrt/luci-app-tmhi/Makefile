# LuCI app for tmhi: Status > Cellular (status, history, settings), a card
# on Status > Overview and widgets for luci-mod-dashboard.
#
# Built with luci.mk from the LuCI feed, like the apps in openwrt/luci. To move
# it there, drop PKG_VERSION and include ../../luci.mk instead.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for tmhi (T-Mobile Home Internet gateways)
LUCI_DEPENDS:=+luci-base +tmhi
LUCI_PKGARCH:=all

PKG_VERSION:=0.4.1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Dave Marquard <dave@marquard.org>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
