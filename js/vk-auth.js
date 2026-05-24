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

    try {
      await this.bridge.send("VKWebAppInit");
      this.isVkEnvironment = true;
    } catch (e) {
      console.warn("VKWebAppInit:", e);
      const qp = new URLSearchParams(window.location.search);
      this.isVkEnvironment =
        qp.has("vk_platform") || qp.has("vk_user_id") || qp.has("vk_app_id");
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

  getLaunchPlatform() {
    return (
      new URLSearchParams(window.location.search).get("vk_platform") || ""
    ).toLowerCase();
  },

  isMobileVkClient() {
    const platform = this.getLaunchPlatform();
    return (
      platform === "android" ||
      platform === "ios" ||
      platform.startsWith("mobile")
    );
  },

  getJoinLinkCandidates(url) {
    const primary = this.normalizeLink(url);
    if (!primary) return [];

    const candidates = [primary];

    try {
      const parsed = new URL(primary);
      if (parsed.hostname === "vk.me") {
        candidates.push(
          primary.replace("https://vk.me/", "https://m.vk.com/")
        );
        candidates.push(primary.replace(/^https:\/\//i, "vk://"));
      }
    } catch {
      /* ignore */
    }

    const groupId = window.APP_CONFIG?.VK_GROUP_ID;
    if (groupId) {
      candidates.push(`https://vk.com/im?sel=-${groupId}`);
      candidates.push(`https://vk.com/write-${groupId}`);
    }

    return [...new Set(candidates)];
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

  bridgeSend(method, params) {
    if (!this.bridge) {
      return Promise.reject(new Error("VK Bridge недоступен"));
    }
    return this.bridge.send(method, params);
  },

  tryOpenLinkViaBridge(link, mobileFirst = false) {
    if (!this.bridge || !this.isVkEnvironment) {
      return;
    }

    const candidates = this.getJoinLinkCandidates(link);
    const tryCandidate = (candidate, method) => {
      if (method === "external") {
        return this.bridgeSend("VKWebAppOpenURLInExternalBrowser", {
          url: candidate,
        });
      }
      return this.bridgeSend("VKWebAppOpenLink", { link: candidate });
    };

    const methods = mobileFirst
      ? ["external", "link"]
      : ["link", "external"];

    let chain = Promise.reject();
    candidates.forEach((candidate) => {
      methods.forEach((method) => {
        chain = chain.catch(() => tryCandidate(candidate, method));
      });
    });
    chain.catch(() => {});
  },

  removeJoinSheet() {
    document.getElementById("joinSheet")?.remove();
    if (!document.getElementById("joinLinkModal")?.classList.contains("open")) {
      document.body.style.overflow = "";
    }
  },

  showJoinSheet(link) {
    this.removeJoinSheet();

    const sheet = document.createElement("div");
    sheet.id = "joinSheet";
    sheet.className = "join-sheet";
    sheet.innerHTML = `
      <div class="join-sheet__panel" role="dialog" aria-modal="true">
        <button type="button" class="join-sheet__close" aria-label="Закрыть">&times;</button>
        <h2 class="join-sheet__title">Переход в чат</h2>
        <p class="join-sheet__hint">На телефоне откройте чат через кнопку ниже.</p>
        <button type="button" class="join-btn join-sheet__primary">Открыть чат в VK</button>
        <a class="secondary-btn join-sheet__link" href="${this.escapeAttr(
          link
        )}" rel="noopener noreferrer">Открыть по ссылке</a>
        <button type="button" class="secondary-btn join-sheet__copy">Скопировать ссылку</button>
      </div>
    `;

    const close = () => this.removeJoinSheet();
    sheet.querySelector(".join-sheet__close").addEventListener("click", close);
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) close();
    });

    sheet.querySelector(".join-sheet__primary").addEventListener("click", () => {
      this.tryOpenLinkViaBridge(link, true);
    });

    sheet.querySelector(".join-sheet__copy").addEventListener("click", () => {
      this.copyJoinLink(link);
    });

    document.body.appendChild(sheet);
    document.body.style.overflow = "hidden";
  },

  escapeAttr(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  },

  copyJoinLink(link) {
    if (this.bridge && this.isVkEnvironment) {
      this.bridgeSend("VKWebAppCopyText", { text: link })
        .then(() => alert("Ссылка скопирована"))
        .catch(() => prompt("Скопируйте ссылку:", link));
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(link)
        .then(() => alert("Ссылка скопирована"))
        .catch(() => prompt("Скопируйте ссылку:", link));
      return;
    }
    prompt("Скопируйте ссылку:", link);
  },

  showJoinModal(link) {
    const modal = document.getElementById("joinLinkModal");
    const anchor = document.getElementById("joinModalLink");
    if (!modal || !anchor) {
      prompt("Откройте ссылку в VK:", link);
      return;
    }

    anchor.href = link;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  },

  hideJoinModal() {
    const modal = document.getElementById("joinLinkModal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  },

  initJoinModal() {
    const modal = document.getElementById("joinLinkModal");
    const closeBtn = document.getElementById("joinModalClose");
    const copyBtn = document.getElementById("joinModalCopy");

    closeBtn?.addEventListener("click", () => this.hideJoinModal());
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) {
        this.hideJoinModal();
      }
    });

    copyBtn?.addEventListener("click", () => {
      const link = document.getElementById("joinModalLink")?.href;
      if (!link || link === "#") return;
      this.copyJoinLink(link);
    });
  },

  setupJoinHandlers() {
    if (this._joinHandlersReady) return;
    this._joinHandlersReady = true;

    document.getElementById("eventsContainer")?.addEventListener(
      "click",
      (e) => {
        const btn = e.target.closest(".join-btn");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        this.openJoin(btn.dataset.joinUrl || "");
      },
      true
    );
  },

  openJoin(rawUrl) {
    const link = this.normalizeLink(rawUrl);
    if (!link) {
      alert("Ссылка для перехода не указана");
      return;
    }

    if (!this.isVkEnvironment) {
      window.location.href = link;
      return;
    }

    if (this.isMobileVkClient()) {
      this.tryOpenLinkViaBridge(link, true);
      this.showJoinSheet(link);
      return;
    }

    this.tryOpenLinkViaBridge(link, false);
    this.showJoinModal(link);
  },

  /** @deprecated */
  onJoinClick(event) {
    event?.preventDefault?.();
    const el = event?.currentTarget;
    this.openJoin(el?.dataset?.joinUrl || el?.href || "");
    return false;
  },

  openLink(url) {
    this.openJoin(url);
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
