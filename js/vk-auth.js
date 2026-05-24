const VK_API_VERSION = "5.199";

const VkAuth = {
  bridge: null,
  isVkEnvironment: false,

  async init() {
    if (typeof vkBridge === "undefined") {
      return;
    }

    this.bridge = vkBridge;
    this.isVkEnvironment = true;

    try {
      await this.bridge.send("VKWebAppInit");
    } catch (e) {
      console.warn("VKWebAppInit:", e);
    }
  },

  getLaunchGroupId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery =
      params.get("vk_group_id") || params.get("group_id") || "";

    if (fromQuery) {
      return parseInt(fromQuery, 10);
    }

    return window.APP_CONFIG?.VK_GROUP_ID || 0;
  },

  async isCommunityManager() {
    const cfg = window.APP_CONFIG || {};
    const appId = cfg.VK_APP_ID;
    const groupId = this.getLaunchGroupId() || cfg.VK_GROUP_ID;

    if (!this.bridge || !appId || !groupId) {
      return false;
    }

    try {
      const { access_token: accessToken } = await this.bridge.send(
        "VKWebAppGetAuthToken",
        { app_id: appId, scope: "groups" }
      );

      const url = new URL("https://api.vk.com/method/groups.getById");
      url.searchParams.set("group_id", String(groupId));
      url.searchParams.set(
        "fields",
        "is_admin,is_editor,is_moderator"
      );
      url.searchParams.set("access_token", accessToken);
      url.searchParams.set("v", VK_API_VERSION);

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.error) {
        console.warn("VK API:", data.error);
        return false;
      }

      const group = data.response?.groups?.[0];
      return (
        group?.is_admin === 1 ||
        group?.is_editor === 1 ||
        group?.is_moderator === 1
      );
    } catch (e) {
      console.warn("Проверка роли VK:", e);
      return false;
    }
  },

  openLink(url) {
    if (!url) return;

    if (this.bridge && this.isVkEnvironment) {
      this.bridge
        .send("VKWebAppOpenLink", { link: url })
        .catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
  },

  async storageGet(key) {
    if (this.bridge && this.isVkEnvironment) {
      try {
        const data = await this.bridge.send("VKWebAppStorageGet", {
          keys: [key],
        });
        return data?.keys?.[0]?.value || "";
      } catch (e) {
        console.warn("VKWebAppStorageGet:", e);
      }
    }
    return localStorage.getItem(key) || "";
  },

  async storageSet(key, value) {
    if (this.bridge && this.isVkEnvironment) {
      try {
        await this.bridge.send("VKWebAppStorageSet", { key, value });
        return;
      } catch (e) {
        console.warn("VKWebAppStorageSet:", e);
      }
    }
    localStorage.setItem(key, value);
  },

  async shareLink(url) {
    if (!url) return;

    if (this.bridge && this.isVkEnvironment) {
      try {
        await this.bridge.send("VKWebAppShare", { link: url });
        return;
      } catch (e) {
        console.warn("VKWebAppShare:", e);
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("Ссылка скопирована в буфер обмена");
    } catch {
      prompt("Скопируйте ссылку:", url);
    }
  },
};

const FAVORITES_STORAGE_KEY = "cal_favorite_events";

const Favorites = {
  ids: new Set(),

  async load() {
    const raw = await VkAuth.storageGet(FAVORITES_STORAGE_KEY);
    if (!raw) {
      this.ids = new Set();
      return;
    }
    try {
      const list = JSON.parse(raw);
      this.ids = new Set(Array.isArray(list) ? list : []);
    } catch {
      this.ids = new Set();
    }
  },

  async save() {
    await VkAuth.storageSet(
      FAVORITES_STORAGE_KEY,
      JSON.stringify([...this.ids])
    );
  },

  has(id) {
    return this.ids.has(String(id));
  },

  async toggle(id) {
    const key = String(id);
    if (this.ids.has(key)) {
      this.ids.delete(key);
    } else {
      this.ids.add(key);
    }
    await this.save();
    return this.has(key);
  },
};
