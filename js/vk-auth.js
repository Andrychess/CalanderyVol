/**
 * VK Mini App: Bridge, проверка прав руководства сообщества, API groups,
 * контакт директора, хранилище избранного (VK Storage / localStorage).
 */
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

  /** Инициализация Bridge; вне VK — только системная тема и dev-режим */
  async init() {
    if (typeof vkBridge === "undefined") {
      VkTheme.init(null);
      return;
    }

    this.bridge = vkBridge;

    try {
      await this.bridge.send("VKWebAppInit");
      this.isVkEnvironment = true;
    } catch (e) {
      console.warn("VKWebAppInit:", e);
      const qp = new URLSearchParams(window.location.search);
      this.isVkEnvironment =
        qp.has("vk_platform") || qp.has("vk_user_id") || qp.has("vk_app_id");
    }

    if (this.isVkEnvironment && this.bridge) {
      VkTheme.init(this.bridge);
    } else {
      VkTheme.init(null);
    }
  },

  /** ID сообщества из query (?vk_group_id) или fallback из config */
  getLaunchGroupId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery =
      params.get("vk_group_id") || params.get("group_id") || "";

    if (fromQuery) {
      return parseInt(fromQuery, 10);
    }

    return window.APP_CONFIG?.VK_GROUP_ID || 0;
  },

  getCommunityCredentials() {
    const cfg = window.APP_CONFIG || {};
    return {
      appId: cfg.VK_APP_ID,
      groupId: this.getLaunchGroupId() || cfg.VK_GROUP_ID,
    };
  },

  /** Токен пользователя с правом groups — для groups.getById, getMembers */
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

  /**
   * Редактирование карточек: сначала флаги текущего пользователя в группе,
   * затем точный поиск в managers (нужен user id).
   */
  async isCommunityManager() {
    const { appId, groupId } = this.getCommunityCredentials();

    if (!this.bridge || !appId || !groupId) {
      return false;
    }

    try {
      const accessToken = await this.getGroupsAccessToken(appId);
      const userId = await this.getCurrentUserId();

      if (await this.hasLeaderRoleViaGetById(accessToken, groupId)) {
        return true;
      }

      if (userId) {
        return this.hasLeaderRoleViaManagers(accessToken, groupId, userId);
      }

      return false;
    } catch (e) {
      console.warn("Проверка роли VK:", e);
      return false;
    }
  },

  /** Ссылки из админки: vk.me без схемы, принудительно https */
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

  /** Должности директора в контактах сообщества (сравнение без учёта регистра) */
  DIRECTOR_POSITIONS: new Set([
    "директор",
    "директор волонтерского центра",
    "директор центра",
  ]),

  normalizeContactPosition(desc) {
    return String(desc || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  },

  isDirectorPosition(desc) {
    return this.DIRECTOR_POSITIONS.has(this.normalizeContactPosition(desc));
  },

  getVkProfileUrl(userId) {
    const id = Number(userId);
    return id > 0 ? `https://vk.com/id${id}` : "";
  },

  async getGroupContacts(accessToken, groupId) {
    const response = await this.vkApi(
      "groups.getById",
      {
        group_id: groupId,
        fields: "contacts",
      },
      accessToken
    );

    const group = response?.groups?.[0];
    return Array.isArray(group?.contacts) ? group.contacts : [];
  },

  /** Первый контакт с должностью директора из раздела «Контакты» группы */
  async getDirectorContact() {
    if (!this.bridge || !this.isVkEnvironment) {
      return null;
    }

    const { appId, groupId } = this.getCommunityCredentials();
    if (!appId || !groupId) {
      return null;
    }

    try {
      const accessToken = await this.getGroupsAccessToken(appId);
      const contacts = await this.getGroupContacts(accessToken, groupId);

      return (
        contacts.find(
          (contact) => contact?.user_id && this.isDirectorPosition(contact.desc)
        ) || null
      );
    } catch (e) {
      console.warn("Контакт директора:", e);
      return null;
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

  async copyText(text) {
    const message = (text || "").trim();
    if (!message) return false;

    try {
      await navigator.clipboard.writeText(message);
      return true;
    } catch (e) {
      console.warn("clipboard:", e);
      return false;
    }
  },
};

const FAVORITES_STORAGE_KEY = "cal_favorite_events";

/** ID избранных мероприятий — синхронизация через VK Storage в mini app */
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
