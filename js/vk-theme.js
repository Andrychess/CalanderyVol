/** Синхронизация темы мини-приложения с VK (светлая / тёмная) */
const VkTheme = {
  appearance: "light",

  init(bridge) {
    this.setAppearance(this.detectSystemAppearance());

    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", (e) => {
          if (!bridge) {
            this.setAppearance(e.matches ? "dark" : "light");
          }
        });
    }

    if (!bridge) return;

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
