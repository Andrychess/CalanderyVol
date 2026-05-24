const VK_API_VERSION = "5.199";

/** Роли с правом вести мероприятия в сообществе (владелец, админ, редактор, модератор) */
const COMMUNITY_LEADER_ROLES = new Set([
  "creator",
  "administrator",
  "editor",
  "moderator",
]);

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

  async getGroupsAccessToken(appId) {
    const { access_token: accessToken } = await this.bridge.send(
      "VKWebAppGetAuthToken",
      { app_id: appId, scope: "groups" }
    );
    return accessToken;
  },

  async getCurrentUserId() {
    try {
      const user = await this.bridge.send("VKWebAppGetUserInfo");
      return user?.id ?? user?.user_id ?? null;
    } catch (e) {
      console.warn("VKWebAppGetUserInfo:", e);
      return null;
    }
  },

  /**
   * Вызов VK API через Bridge (без CORS). Прямой fetch к api.vk.com из mini app запрещён.
   */
  async vkApi(method, params, accessToken) {
    if (!this.bridge || !this.isVkEnvironment) {
      return null;
    }

    const apiParams = { ...params, access_token: accessToken, v: VK_API_VERSION };

    try {
      const data = await this.bridge.send("VKWebAppCallAPIMethod", {
        method,
        params: apiParams,
      });

      if (data?.error) {
        console.warn(`VK API ${method}:`, data.error);
        return null;
      }

      return data?.response ?? data;
    } catch (e) {
      console.warn(`VKWebAppCallAPIMethod ${method}:`, e);
      return null;
    }
  },

  isLeaderRole(role) {
    return role && COMMUNITY_LEADER_ROLES.has(String(role).toLowerCase());
  },

  /** groups.getMembers filter=managers — роли creator, administrator, editor, moderator */
  async hasLeaderRoleViaManagers(accessToken, groupId, userId) {
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const response = await this.vkApi(
        "groups.getMembers",
        {
          group_id: groupId,
          filter: "managers",
          offset,
          count: pageSize,
        },
        accessToken
      );

      if (!response) {
        return false;
      }

      const items = response.items || [];
      const roles = response.roles || [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const id =
          typeof item === "object" && item !== null ? item.id : item;
        const role =
          typeof item === "object" && item !== null && item.role
            ? item.role
            : roles[i];

        if (Number(id) === Number(userId) && this.isLeaderRole(role)) {
          return true;
        }
      }

      if (items.length < pageSize) {
        break;
      }
      offset += pageSize;
    }

    return false;
  },

  /** Запасной вариант: флаги is_admin / is_editor / is_moderator (создатель обычно is_admin) */
  async hasLeaderRoleViaGetById(accessToken, groupId) {
    const response = await this.vkApi(
      "groups.getById",
      {
        group_id: groupId,
        fields: "is_admin,is_editor,is_moderator",
      },
      accessToken
    );

    const group = response?.groups?.[0];
    if (!group) {
      return false;
    }

    return (
      group.is_admin === 1 ||
      group.is_editor === 1 ||
      group.is_moderator === 1
    );
  },

  async isCommunityManager() {
    const cfg = window.APP_CONFIG || {};
    const appId = cfg.VK_APP_ID;
    const groupId = this.getLaunchGroupId() || cfg.VK_GROUP_ID;

    if (!this.bridge || !appId || !groupId) {
      return false;
    }

    try {
      const accessToken = await this.getGroupsAccessToken(appId);
      const userId = await this.getCurrentUserId();

      const viaGetById = await this.hasLeaderRoleViaGetById(
        accessToken,
        groupId
      );
      if (viaGetById) {
        return true;
      }

      if (userId) {
        return await this.hasLeaderRoleViaManagers(
          accessToken,
          groupId,
          userId
        );
      }

      return false;
    } catch (e) {
      console.warn("Проверка роли VK:", e);
      return false;
    }
  },

  normalizeLink(url) {
    if (!url) return "";
    let link = String(url).trim();
    if (!link) return "";

    if (/^vk\.me\//i.test(link) || /^m\.vk\.com\//i.test(link)) {
      link = `https://${link}`;
    }
    if (/^vk\.com\//i.test(link) || /^www\./i.test(link)) {
      link = `https://${link}`;
    }
    if (!/^https?:\/\//i.test(link)) {
      link = `https://${link}`;
    }
    return link.replace(/^http:\/\//i, "https://");
  },

  isVkHost(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return (
        host === "vk.com" ||
        host.endsWith(".vk.com") ||
        host === "vk.me" ||
        host.endsWith(".vk.me")
      );
    } catch {
      return false;
    }
  },

  async tryBridge(method, params) {
    if (!this.bridge || !this.isVkEnvironment) {
      return false;
    }
    try {
      const result = await this.bridge.send(method, params);
      if (result && result.result === false) {
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`${method}:`, e);
      return false;
    }
  },

  /** Клик по ссылке внутри iframe (без доступа к window.top) */
  openLinkViaAnchor(link) {
    try {
      const anchor = document.createElement("a");
      anchor.href = link;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } catch (e) {
      console.warn("openLinkViaAnchor:", e);
      return false;
    }
  },

  async openLinkViaBridge(link) {
    const bridgeMethods = [
      ["VKWebAppOpenLink", { link }],
      ["VKWebAppOpenURLInExternalBrowser", { url: link }],
      ["VKWebAppOpenURLInExternalBrowser", { link }],
      ["VKWebAppOpenURL", { url: link }],
      ["VKWebAppOpenURL", { link }],
    ];

    for (const [method, params] of bridgeMethods) {
      if (await this.tryBridge(method, params)) {
        return true;
      }
    }
    return false;
  },

  async openLink(url) {
    const link = this.normalizeLink(url);
    if (!link) {
      alert("Ссылка для перехода не указана");
      return false;
    }

    if (this.bridge && this.isVkEnvironment) {
      if (await this.openLinkViaBridge(link)) {
        return true;
      }

      if (this.openLinkViaAnchor(link)) {
        return true;
      }

      try {
        const opened = window.open(link, "_blank", "noopener,noreferrer");
        if (opened) {
          return true;
        }
      } catch (e) {
        console.warn("window.open:", e);
      }

      prompt(
        "Не удалось открыть ссылку автоматически. Скопируйте адрес и откройте в VK или браузере:",
        link
      );
      return false;
    }

    try {
      const opened = window.open(link, "_blank", "noopener,noreferrer");
      if (opened) return true;
    } catch (e) {
      console.warn("window.open:", e);
    }

    window.location.href = link;
    return true;
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
