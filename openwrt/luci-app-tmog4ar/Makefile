# LuCI app for tmog4ar: Status > Cellular (status, history, settings), a card
# on Status > Overview and widgets for luci-mod-dashboard.
#
# Built with luci.mk from the LuCI feed, like the apps in openwrt/luci. To move
# it there, drop PKG_VERSION and include ../../luci.mk instead.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for tmog4ar (T-Mobile TMO-G4AR gateway)
LUCI_DEPENDS:=+luci-base +tmog4ar
LUCI_PKGARCH:=all

PKG_VERSION:=0.3.4
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Dave Marquard <8920060+dave-atx@users.noreply.github.com>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
