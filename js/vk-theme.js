/**
 * Синхронизация темы с VK (VKWebAppGetConfig / UpdateConfig) и системой.
 * data-theme на <html> + цвет status bar через VKWebAppSetViewSettings.
 */
const VkTheme = {
  appearance: "light",
  _bridgeBound: false,

  init(bridge) {
    this.setAppearance(this.detectSystemAppearance());

    if (window.matchMedia && !this._mediaBound) {
      this._mediaBound = true;
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", (e) => {
          if (!this._bridgeBound) {
            this.setAppearance(e.matches ? "dark" : "light");
          }
        });
    }

    if (!bridge || this._bridgeBound) return;

    this._bridgeBound = true;

    bridge.subscribe((event) => {
      if (event.detail.type === "VKWebAppUpdateConfig") {
        const next = event.detail.data?.appearance;
        if (next) this.setAppearance(next);
      }
    });

    bridge
      .send("VKWebAppGetConfig")
      .then((data) => {
        if (data?.appearance) {
          this.setAppearance(data.appearance);
        }
      })
      .catch(() => {});
  },

  detectSystemAppearance() {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
    return "light";
  },

  setAppearance(appearance) {
    const theme = appearance === "dark" ? "dark" : "light";
    this.appearance = theme;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        theme === "dark" ? "#0f1e30" : "#2669B8"
      );
    }

    this.syncVkChrome(theme);
  },

  syncVkChrome(theme) {
    const bridge = typeof vkBridge !== "undefined" ? vkBridge : null;
    if (!bridge) return;

    // На тёмном фоне — светлые иконки статус-бара и наоборот
    const statusBarStyle = theme === "dark" ? "light" : "dark";

    bridge
      .send("VKWebAppSetViewSettings", {
        status_bar_style: statusBarStyle,
        action_bar_color: theme === "dark" ? "#0f1e30" : "#2669B8",
        navigation_bar_color: theme === "dark" ? "#0f1e30" : "#2669B8",
      })
      .catch(() => {});
  },
};

// Тема сразу при загрузке страницы (до VKWebAppInit)
VkTheme.setAppearance(VkTheme.detectSystemAppearance());
