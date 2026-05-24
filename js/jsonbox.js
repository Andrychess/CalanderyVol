const JSONBOX_BASE = "https://jsonbox.ru/api.php";

const JsonBoxStorage = {
  getConfig() {
    return window.APP_CONFIG || {};
  },

  async getEvents() {
    const cfg = this.getConfig();
    const apiKey =
      cfg.JSONBOX_API_KEY_READONLY || cfg.JSONBOX_API_KEY || "";

    if (!apiKey) {
      throw new Error("Не задан JSONBOX_API_KEY_READONLY в config.js");
    }

    const url = `${JSONBOX_BASE}?action=get&api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`JsonBox: HTTP ${response.status}`);
    }

    const payload = await response.json();

    if (payload.error) {
      throw new Error(payload.error);
    }

    const events = payload.data?.events;
    return Array.isArray(events) ? events : [];
  },

  async saveEvents(events) {
    const cfg = this.getConfig();
    const apiKey = cfg.JSONBOX_API_KEY || "";

    if (!apiKey) {
      throw new Error("Не задан JSONBOX_API_KEY в config.js");
    }

    const response = await fetch(`${JSONBOX_BASE}?action=store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        data: { events },
      }),
    });

    const payload = await response.json();

    if (!response.ok || payload.error) {
      throw new Error(payload.error || `JsonBox: HTTP ${response.status}`);
    }

    return payload;
  },
};
