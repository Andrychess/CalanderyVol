/**
 * Чистые функции данных: баллы, отпечаток JsonBox, валидация ссылок, очистка заявок.
 */
const AppData = (window.AppData = {
  EVENT_LEVEL_POINTS: {
    вузовский: 100,
    городской: 100,
    региональный: 500,
    межрегиональный: 500,
    всероссийский: 700,
    международный: 800,
  },

  getFormDefaults() {
    const cfg = window.APP_CONFIG || {};
    return {
      location: cfg.DEFAULT_EVENT_LOCATION || "ЮРГПУ(НПИ)",
      buttonLabel:
        cfg.DEFAULT_BUTTON_LABEL ||
        "Подтвердить участие (перейти в информационный чат)",
      functionality:
        cfg.DEFAULT_FUNCTIONALITY ||
        "Сопровождение концертного зала\nОрганизация работы гардероба",
      conditions:
        cfg.DEFAULT_CONDITIONS ||
        "освобождение от занятий на время проведения мероприятия;\nбаллы для повышенной стипендии;\nверифицированные часы на платформе",
    };
  },

  fingerprint(data) {
    const eventIds = (data?.events || []).map((item) => String(item.id)).sort();
    const enrollmentIds = (data?.enrollments || [])
      .map((item) => `${item.eventId}:${item.userId}:${item.status}:${item.updatedAt}`)
      .sort();
    return `${eventIds.join("|")}::${enrollmentIds.join("|")}`;
  },

  isAllowedChatUrl(url) {
    const value = String(url || "").trim();
    if (!value) return false;
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
      const host = parsed.hostname.toLowerCase();
      const allowedHosts = [
        "vk.me",
        "vk.com",
        "m.vk.com",
        "t.me",
        "telegram.me",
      ];
      return allowedHosts.some(
        (item) => host === item || host.endsWith(`.${item}`)
      );
    } catch {
      return false;
    }
  },

  cleanupOrphanEnrollments(enrollmentList, eventList) {
    const eventIds = new Set((eventList || []).map((item) => String(item.id)));
    return (enrollmentList || []).filter((item) =>
      eventIds.has(String(item.eventId))
    );
  },

  cleanupOldEnrollments(enrollmentList, months = 6) {
    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
    return (enrollmentList || []).filter((item) => {
      const ts = new Date(item.updatedAt || item.createdAt || 0).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
  },

  buildEnrollmentsCsv(rows, getEventTitle, getUserName) {
    const header = ["event_id", "event_title", "user_id", "user_name", "status", "updated_at"];
    const lines = [header.join(";")];
    rows.forEach((item) => {
      lines.push(
        [
          item.eventId,
          getEventTitle(item.eventId),
          item.userId,
          getUserName(item.userId),
          item.status,
          item.updatedAt,
        ]
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(";")
      );
    });
    return `\uFEFF${lines.join("\n")}`;
  },

  downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
});
