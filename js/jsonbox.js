/**
 * Хранилище мероприятий на JsonBox.ru (без собственного бэкенда).
 * Чтение — ro_ ключ, запись — полный ключ из config.js (оба попадают в сборку фронта).
 */
const JSONBOX_BASE = "https://jsonbox.ru/api.php";

const JsonBoxStorage = {
  getConfig() {
    return window.APP_CONFIG || {};
  },

  /** GET: query = "action=get&api_key=…"; POST store: query = null */
  async _request(query, options = {}) {
    const url = query
      ? `${JSONBOX_BASE}?${query}`
      : `${JSONBOX_BASE}?action=store`;

    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `JsonBox: HTTP ${response.status}`);
    }

    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload;
  },

  async getEvents() {
    const payload = await this.getAppData();
    return payload.events;
  },

  async getAppData() {
    const cfg = this.getConfig();
    const apiKey =
      cfg.JSONBOX_API_KEY_READONLY || cfg.JSONBOX_API_KEY || "";

    if (!apiKey) {
      throw new Error("Не задан JSONBOX_API_KEY_READONLY в config.js");
    }

    const query = `action=get&api_key=${encodeURIComponent(apiKey)}`;
    const payload = await this._request(query);
    const data = payload.data || {};
    return {
      events: Array.isArray(data.events) ? data.events : [],
      enrollments: Array.isArray(data.enrollments) ? data.enrollments : [],
    };
  },

  async saveEvents(events) {
    const current = await this.getAppData();
    return this.saveAppData({
      events,
      enrollments: current.enrollments,
    });
  },

  async saveAppData(data) {
    const cfg = this.getConfig();
    const apiKey = cfg.JSONBOX_API_KEY || "";

    if (!apiKey) {
      throw new Error("Не задан JSONBOX_API_KEY в config.js");
    }

    await this._request(null, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        data: {
          events: Array.isArray(data?.events) ? data.events : [],
          enrollments: Array.isArray(data?.enrollments) ? data.enrollments : [],
        },
      }),
    });
  },
};
