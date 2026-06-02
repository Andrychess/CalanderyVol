/**
 * Главный модуль VK Mini App «Календарь мероприятий».
 * Список/календарь, CRUD через JsonBox, карточки, экспорт PNG, связь с EventSchedule.
 *
 * Глобальное состояние (без фреймворка):
 *   events — кэш мероприятий после loadEvents;
 *   hasAdminAccess — право VK или dev-пароль;
 *   isAdmin — hasAdminAccess и не включён «Как пользователь».
 */
const EVENT_LEVELS = LevelColors.order;

/** Оценочные баллы за прошедшее мероприятие по уровню (для ознакомления) */
const EVENT_LEVEL_POINTS = {
  вузовский: 100,
  городской: 100,
  региональный: 500,
  всероссийский: 700,
  международный: 800,
};

const DEFAULT_LOCATION = "ЮРГПУ(НПИ)";
const DEFAULT_BUTTON_LABEL =
  "Подтвердить участие (перейти в информационный чат)";
const DEFAULT_FUNCTIONALITY =
  "Сопровождение концертного зала\nОрганизация работы гардероба";
const DEFAULT_CONDITIONS =
  "освобождение от занятий на время проведения мероприятия;\nбаллы для повышенной стипендии;\nверифицированные часы на платформе";

let events = [];
let enrollments = [];
let currentUserId = null;
const participantProfiles = new Map();
/** Контакт директора из VK «Контакты» — для кнопки «Задать вопрос» */
let groupDirectorContact = null;
/** Есть ли у пользователя права руководства (независимо от превью) */
let hasAdminAccess = false;
/** Режим «Как пользователь» для проверки UI участником */
let adminPreviewAsUser = false;
/** Показывать ли панель редактирования и архив */
let isAdmin = false;
let editingEventId = null;
let viewMode = "list";

const filterState = {
  search: "",
  level: "all",
  favoritesOnly: false,
  showPast: false,
};

const ADMIN_PREVIEW_STORAGE_KEY = "cal_admin_preview_as_user";
const ENROLLMENT_STATUSES = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

// --- Конфигурация и нормализация данных ---

function ensureConfig() {
  if (!window.APP_CONFIG) {
    throw new Error(
      "Создайте config.js из config.example.js и укажите ключи JsonBox"
    );
  }
}

function normalizeTextField(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join("\n");
  }
  return String(value);
}

function normalizeSchedule(raw) {
  return {
    date: raw?.date || "",
    time: raw?.time || raw?.timeStart || "",
    timeEnd: raw?.timeEnd || "",
  };
}

/** Новый формат schedules[] или одна дата в корне карточки (старые JSON) */
function normalizeSchedules(raw) {
  if (Array.isArray(raw?.schedules) && raw.schedules.length) {
    return raw.schedules.map(normalizeSchedule).filter((item) => item.date);
  }

  const legacy = normalizeSchedule({
    date: raw?.date,
    time: raw?.time || raw?.timeStart,
    timeEnd: raw?.timeEnd,
  });

  return legacy.date ? [legacy] : [];
}

function normalizeEvent(raw) {
  if (raw?.archived) {
    const schedules = normalizeSchedules(raw)
      .map((item) => ({ date: item.date, time: "", timeEnd: "" }))
      .filter((item) => item.date);
    const first = schedules[0] || { date: raw.date || "", time: "", timeEnd: "" };

    return {
      id: String(raw.id || ""),
      title: raw.title || "",
      schedules,
      date: first.date,
      time: "",
      timeEnd: "",
      level: EVENT_LEVELS.includes(raw.level)
        ? raw.level
        : mapLegacyLevel(raw.level),
      archived: true,
      location: "",
      enrollment: "closed",
      functionality: "",
      conditions: "",
      description: "",
      buttonLabel: "",
      buttonUrl: "",
      plan: EventSchedule.emptyPlan(),
    };
  }

  const functionality = normalizeTextField(raw.functionality ?? raw.tasks);
  const conditions = normalizeTextField(raw.conditions);
  const schedules = normalizeSchedules(raw);
  const first = schedules[0] || { date: "", time: "", timeEnd: "" };

  const enrollment =
    raw.enrollment === "closed" || raw.enrollmentStatus === "closed"
      ? "closed"
      : "open";

  return {
    id: String(raw.id || Date.now()),
    title: raw.title || "",
    schedules,
    date: first.date,
    time: first.time,
    timeEnd: first.timeEnd,
    location: raw.location || DEFAULT_LOCATION,
    level: EVENT_LEVELS.includes(raw.level)
      ? raw.level
      : mapLegacyLevel(raw.level),
    enrollment,
    functionality,
    conditions,
    description: raw.description || "",
    buttonLabel: raw.buttonLabel || DEFAULT_BUTTON_LABEL,
    buttonUrl: raw.buttonUrl || raw.link || "",
    plan: raw?.plan ? EventSchedule.normalizePlan(raw.plan) : EventSchedule.emptyPlan(),
  };
}

function isEventArchived(event) {
  return event?.archived === true;
}

/** Прошедшее мероприятие: только id, название, даты, уровень (экономия JsonBox) */
function compactPastEvent(event) {
  const normalized = isEventArchived(event) ? event : normalizeEvent(event);
  const schedules = getEventSchedules(normalized).map((item) => ({
    date: item.date,
    time: "",
    timeEnd: "",
  }));
  const first = schedules[0] || { date: normalized.date || "", time: "", timeEnd: "" };

  return {
    id: String(normalized.id),
    title: normalized.title || "",
    level: normalized.level,
    date: first.date,
    schedules,
    archived: true,
  };
}

/** Сжимает прошедшие карточки; возвращает true, если что-то изменилось */
function trimPastEventsData() {
  let changed = false;
  events = events.map((event) => {
    if (!isEventPast(event) || isEventArchived(event)) return event;
    changed = true;
    return compactPastEvent(event);
  });
  return changed;
}

function normalizeEnrollment(raw = {}) {
  const status = String(raw.status || ENROLLMENT_STATUSES.PENDING).toLowerCase();
  return {
    id:
      String(raw.id || "").trim() ||
      `enr-${String(raw.eventId || "").trim()}-${String(raw.userId || "").trim()}`,
    eventId: String(raw.eventId || "").trim(),
    userId: Number(raw.userId) || 0,
    status: Object.values(ENROLLMENT_STATUSES).includes(status)
      ? status
      : ENROLLMENT_STATUSES.PENDING,
    createdAt: String(raw.createdAt || raw.updatedAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    updatedBy: Number(raw.updatedBy) || null,
  };
}

function dedupeEnrollments(list = []) {
  const byKey = new Map();
  list.forEach((raw) => {
    const item = normalizeEnrollment(raw);
    if (!item.eventId || !item.userId) return;
    const key = getEnrollmentKey(item.eventId, item.userId);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      return;
    }
    if (new Date(item.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      byKey.set(key, item);
    }
  });
  return [...byKey.values()];
}

/** Старые подписи уровней до перехода на вузовский/городской/… */
function mapLegacyLevel(level) {
  const map = {
    Муниципальное: "городской",
    Региональное: "региональный",
    Федеральное: "всероссийский",
  };
  return map[level] || "региональный";
}

function resolveEventLevelKey(level) {
  if (EVENT_LEVELS.includes(level)) return level;
  return mapLegacyLevel(level);
}

function getEventLevelPoints(level) {
  return EVENT_LEVEL_POINTS[resolveEventLevelKey(level)] ?? 0;
}

function sumEventsLevelPoints(eventList) {
  return eventList.reduce((sum, event) => sum + getEventLevelPoints(event.level), 0);
}

function formatPoints(value) {
  return Number(value).toLocaleString("ru-RU");
}

function formatAttendedEventsCountLabel(count) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  const word = n1 === 1 && n !== 11 ? "посещённому мероприятию" : "посещённым мероприятиям";
  return `${count} ${word}`;
}

/** Мероприятия из вкладки «Посещённые» — те же, к которым пользователь присоединился */
function getMyAttendedEventsFromRecords(records) {
  return records
    .map((record) => findEventById(events, record.eventId))
    .filter(Boolean);
}

function renderAttendedPointsSummary(eventList) {
  const total = sumEventsLevelPoints(eventList);
  const count = eventList.length;
  const countLabel = formatAttendedEventsCountLabel(count);

  return `
    <section class="attended-points" aria-label="Оценка баллов за посещённые мероприятия">
      <p class="attended-points__total">≈ <strong>${escapeHtml(formatPoints(total))}</strong> баллов</p>
      <p class="attended-points__meta">По ${escapeHtml(countLabel)}</p>
      <p class="attended-points__note">Баллы приблизительные и служат только для ознакомления.</p>
    </section>
  `;
}

function getEventSchedules(event) {
  const schedules =
    Array.isArray(event?.schedules) && event.schedules.length
      ? event.schedules.map(normalizeSchedule)
      : normalizeSchedules(event);

  return schedules
    .filter((item) => item.date)
    .sort((a, b) => getScheduleStart(a) - getScheduleStart(b));
}

function getScheduleStart(schedule) {
  return new Date(`${schedule.date}T${schedule.time || "00:00"}`);
}

function getScheduleEnd(schedule) {
  const time = schedule.timeEnd || schedule.time || "23:59";
  return new Date(`${schedule.date}T${time}`);
}

function getEnrollmentKey(eventId, userId) {
  return `${String(eventId)}:${Number(userId)}`;
}

function getEnrollmentForUser(eventId, userId = currentUserId) {
  const numericUserId = Number(userId);
  if (!numericUserId) return null;
  return (
    enrollments.find(
      (item) =>
        String(item.eventId) === String(eventId) &&
        Number(item.userId) === numericUserId
    ) || null
  );
}

function getEventEnrollments(eventId) {
  return enrollments.filter((item) => String(item.eventId) === String(eventId));
}

function getEnrollmentStatusLabel(status) {
  if (status === ENROLLMENT_STATUSES.APPROVED) return "Подтверждено";
  if (status === ENROLLMENT_STATUSES.REJECTED) return "Отклонено";
  return "Ожидает подтверждения";
}

function getEnrollmentStatusClass(status) {
  if (status === ENROLLMENT_STATUSES.APPROVED) return "approved";
  if (status === ENROLLMENT_STATUSES.REJECTED) return "rejected";
  return "pending";
}

function getUserDisplayName(userId) {
  const profile = participantProfiles.get(Number(userId));
  if (!profile) return `ID ${userId}`;
  const fullName = `${profile.last_name || ""} ${profile.first_name || ""}`.trim();
  return fullName || `ID ${userId}`;
}

async function ensureParticipantProfiles(userIds = []) {
  if (!VkAuth.isVkEnvironment) return;
  const missing = [...new Set(userIds.map((id) => Number(id)).filter((id) => id > 0))]
    .filter((id) => !participantProfiles.has(id));
  if (!missing.length) return;

  const profiles = await VkAuth.getUsersByIds(missing);
  profiles.forEach((profile) => {
    if (!profile?.id) return;
    participantProfiles.set(Number(profile.id), {
      first_name: String(profile.first_name || "").trim(),
      last_name: String(profile.last_name || "").trim(),
    });
  });

  if (
    isScheduleViewActive() &&
    (EventSchedule?.tab === "participants" || EventSchedule?.tab === "volunteer")
  ) {
    EventSchedule.render();
  }
}

function isSchedulePast(schedule) {
  if (!schedule.date) return false;
  return getScheduleEnd(schedule) < new Date();
}

/** Прошедшее — если все даты/слоты карточки уже закончились */
function isEventPast(event) {
  const schedules = getEventSchedules(event);
  if (!schedules.length) return false;
  return schedules.every(isSchedulePast);
}

/** Сортировка: ближайшая будущая дата; если все в прошлом — первая из прошлых */
function getEventSortDate(event) {
  const schedules = getEventSchedules(event);
  const upcoming = schedules.filter((item) => !isSchedulePast(item));
  const target = upcoming.length ? upcoming : schedules;
  return target.length ? getScheduleStart(target[0]) : new Date(0);
}

// --- Даты в карточке и экспорте ---

function getScheduleLinesHtml(event) {
  return getEventSchedules(event).map((item) =>
    escapeHtml(formatScheduleLine(item))
  );
}

function renderSchedulesList(event) {
  const lines = getScheduleLinesHtml(event);

  if (!lines.length) {
    return '<p class="event-datetime">Дата не указана</p>';
  }

  if (lines.length === 1) {
    return `<p class="event-datetime">${lines[0]}</p>`;
  }

  return `<ul class="event-schedules">${lines.map((line) => `<li>${line}</li>`).join("")}</ul>`;
}

function createScheduleRow(schedule = {}) {
  const row = document.createElement("div");
  row.className = "schedule-row";
  row.innerHTML = `
    <div class="schedule-fields">
      <div>
        <label class="field-label">Дата *</label>
        <input type="date" class="schedule-date" value="${escapeHtml(schedule.date || "")}" required>
      </div>
      <div>
        <label class="field-label">Начало *</label>
        <input type="time" class="schedule-time" value="${escapeHtml(schedule.time || "")}" required>
      </div>
      <div>
        <label class="field-label">Конец</label>
        <input type="time" class="schedule-time-end" value="${escapeHtml(schedule.timeEnd || "")}">
      </div>
    </div>
    <button type="button" class="schedule-remove-btn" aria-label="Удалить дату">&times;</button>
  `;

  row.querySelector(".schedule-remove-btn").addEventListener("click", () => {
    const list = document.getElementById("schedulesList");
    if (list.children.length <= 1) {
      setFormError("Нужна хотя бы одна дата проведения.");
      return;
    }
    row.remove();
    setFormError("");
  });

  return row;
}

function renderScheduleForm(schedules) {
  const list = document.getElementById("schedulesList");
  list.innerHTML = "";

  const items = schedules?.length
    ? schedules
    : [{ date: getTodayDateString(), time: "", timeEnd: "" }];

  items.forEach((item) => list.appendChild(createScheduleRow(item)));
}

function readSchedulesFromForm() {
  return [...document.querySelectorAll("#schedulesList .schedule-row")].map((row) => ({
    date: row.querySelector(".schedule-date").value,
    time: row.querySelector(".schedule-time").value,
    timeEnd: row.querySelector(".schedule-time-end").value,
  }));
}

// --- Кнопки на карточке ---

function renderJoinButton(event) {
  const label = escapeHtml(event.buttonLabel || DEFAULT_BUTTON_LABEL);
  const url = VkAuth.normalizeLink(event.buttonUrl);

  if (!url) {
    return `<span class="join-btn join-btn--disabled" aria-disabled="true">${label}</span>`;
  }

  return `<a class="join-btn" href="${escapeAttr(url)}" rel="noopener noreferrer" data-action="join-chat" data-id="${escapeAttr(event.id)}">${label}</a>`;
}

function renderAskDirectorButton() {
  const userId = groupDirectorContact?.user_id;
  const url = VkAuth.getVkProfileUrl(userId);
  if (!url) {
    return "";
  }

  return `<a class="ask-director-btn" href="${escapeAttr(url)}" rel="noopener noreferrer">Задать вопрос</a>`;
}

/** «В чат» и при наличии — «Задать вопрос» директору в одну строку */
function renderCardPrimaryActions(event) {
  const join = renderJoinButton(event);
  const ask = renderAskDirectorButton();
  if (!ask) {
    return join;
  }

  return `<div class="card-actions__row">${join}${ask}</div>`;
}

async function loadGroupDirectorContact() {
  groupDirectorContact = await VkAuth.getDirectorContact();
}

async function loadCurrentUser() {
  currentUserId = await VkAuth.getCurrentUserId();
}

// --- Экспорт PNG карточки ---

const PNG_EXPORT_LIST_LIMIT = 7;
const PNG_EXPORT_DESC_LIMIT = 360;

function truncateForExport(text, maxLen) {
  const value = String(text || "").trim();
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1).trim()}…`;
}

function renderExportSchedules(event) {
  const lines = getScheduleLinesHtml(event);

  if (!lines.length) {
    return '<p class="png-export-story__schedule">Дата не указана</p>';
  }

  if (lines.length === 1) {
    return `<p class="png-export-story__schedule">${lines[0]}</p>`;
  }

  return `<ul class="png-export-story__schedules">${lines
    .map((line) => `<li class="png-export-story__schedule">${line}</li>`)
    .join("")}</ul>`;
}

function renderEventBulletSection(title, items) {
  if (!items.length) return "";

  return `
    <div class="event-block">
      <strong>${escapeHtml(title)}</strong>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderExportListBlock(title, items) {
  if (!items.length) return "";

  const visible = items.slice(0, PNG_EXPORT_LIST_LIMIT);
  const rest = items.length - visible.length;

  return `
    <section class="png-export-story__block">
      <h2 class="png-export-story__block-title">${escapeHtml(title)}</h2>
      <ul class="png-export-story__block-list">
        ${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        ${rest > 0 ? `<li class="png-export-story__more">и ещё ${rest}</li>` : ""}
      </ul>
    </section>
  `;
}

/** DOM 1080×1920 (9:16) — только для экспорта PNG, не для экрана приложения */
function buildEventExportStoryElement(event) {
  const functionalityItems = textToList(event.functionality);
  const conditionItems = textToList(event.conditions);
  const enrollmentClass =
    event.enrollment === "closed"
      ? "png-export-story__badge--closed"
      : "png-export-story__badge--open";
  const sectionsHtml = [
    renderExportListBlock("Функционал", functionalityItems),
    renderExportListBlock("Условия", conditionItems),
  ]
    .filter(Boolean)
    .join("");

  const root = document.createElement("div");
  root.className = "png-export-story";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <header class="png-export-story__header">
      <p class="png-export-story__eyebrow">Мероприятие</p>
      <h1 class="png-export-story__title">${escapeHtml(event.title)}</h1>
      <div class="png-export-story__when">${renderExportSchedules(event)}</div>
      <p class="png-export-story__location">📍 ${escapeHtml(event.location || DEFAULT_LOCATION)}</p>
    </header>
    <main class="png-export-story__main">
      <div class="png-export-story__badges">
        <span class="png-export-story__badge png-export-story__badge--level">${escapeHtml(formatLevelLabel(event.level))}</span>
        <span class="png-export-story__badge ${enrollmentClass}">${escapeHtml(formatEnrollmentLabel(event.enrollment))}</span>
      </div>
      ${
        event.description
          ? `<p class="png-export-story__desc">${escapeHtml(truncateForExport(event.description, PNG_EXPORT_DESC_LIMIT))}</p>`
          : ""
      }
      ${sectionsHtml ? `<div class="png-export-story__sections">${sectionsHtml}</div>` : ""}
    </main>
    <footer class="png-export-story__footer">Календарь мероприятий</footer>
  `;

  return root;
}

function getAppVkUrl() {
  const appId = window.APP_CONFIG?.VK_APP_ID || 54607109;
  return `https://vk.com/app${appId}`;
}

function formatShareDates(schedules) {
  if (!schedules.length) return "дата не указана";
  return schedules
    .map((item) => formatDate(item.date))
    .filter(Boolean)
    .join(", ");
}

function formatShareTimes(schedules) {
  if (!schedules.length) return "время не указано";
  return schedules
    .map((item) => {
      if (!item.time) return "весь день";
      return item.timeEnd ? `${item.time}–${item.timeEnd}` : item.time;
    })
    .join(", ");
}

function formatShareMultilineField(text) {
  const items = textToList(text);
  if (!items.length) return "—";
  if (items.length === 1) return items[0];
  return items.map((item) => `• ${item}`).join("\n");
}

function buildEventShareText(event) {
  const schedules = getEventSchedules(event);
  const title = event.title || "Мероприятие";
  const dates = formatShareDates(schedules);
  const times = formatShareTimes(schedules);
  const description = (event.description || "").trim() || "—";
  const level = formatLevelLabel(event.level) || "—";
  const functionality = formatShareMultilineField(event.functionality);
  const conditions = formatShareMultilineField(event.conditions);
  const chatUrl = VkAuth.normalizeLink(event.buttonUrl) || "—";
  const appUrl = getAppVkUrl();

  return [
    `📌 ${title} | ${dates} | ${times} 📌`,
    description,
    `Уровень: ${level}`,
    "Функционал:",
    functionality,
    "Условия:",
    conditions,
    `Информационный чат: ${chatUrl}`,
    `Календарь мероприятий: ${appUrl}`,
  ].join("\n");
}

function setSubtitle(text) {
  document.getElementById("appSubtitle").textContent = text;
}

/** Оценочный размер JSON, который уходит в JsonBox */
function estimateJsonStorageBytes() {
  const payload = { events, enrollments };
  return new Blob([JSON.stringify(payload)]).size;
}

function formatStorageSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function updateJsonStorageBadge() {
  const show = hasAdminAccess;
  const label = `JSON: ${formatStorageSize(estimateJsonStorageBytes())}`;
  const title = "Оценочный размер данных в JsonBox (мероприятия и заявки)";

  document.querySelectorAll(".json-storage-badge").forEach((el) => {
    el.classList.toggle("hidden", !show);
    if (!show) return;
    el.textContent = label;
    el.title = title;
  });
}

function setFormError(message) {
  document.getElementById("formError").textContent = message || "";
}

// --- Список и фильтры ---

function getFilteredEvents() {
  let list = [...events];

  // Архив «Прошедшие» — только для isAdmin; участники видят только актуальные
  if (isAdmin && filterState.showPast) {
    list = list.filter(isEventPast);
  } else {
    list = list.filter((event) => !isEventPast(event));
  }

  if (filterState.level !== "all") {
    list = list.filter((event) => event.level === filterState.level);
  }

  if (filterState.search.trim()) {
    const query = filterState.search.trim().toLowerCase();
    list = list.filter((event) =>
      event.title.toLowerCase().includes(query)
    );
  }

  if (filterState.favoritesOnly) {
    list = list.filter((event) => Favorites.has(event.id));
  }

  list.sort((a, b) => getEventSortDate(a) - getEventSortDate(b));
  return list;
}

async function loadEvents() {
  const container = document.getElementById("eventsContainer");
  if (container) {
    container.innerHTML = '<div class="loading">Загрузка мероприятий...</div>';
  }

  try {
    const payload = await JsonBoxStorage.getAppData();
    events = payload.events.map(normalizeEvent);
    enrollments = dedupeEnrollments(payload.enrollments);
    if (trimPastEventsData()) {
      try {
        await JsonBoxStorage.saveAppData({ events, enrollments });
      } catch (trimError) {
        console.warn("Не удалось сохранить сжатые прошедшие мероприятия:", trimError);
      }
    }
    if (container) {
      renderCurrentView();
    }
    updateJsonStorageBadge();
  } catch (error) {
    console.error(error);
    if (container) {
      container.innerHTML = `<div class="error-msg">Не удалось загрузить данные: ${escapeHtml(error.message)}</div>`;
      setSubtitle("Ошибка загрузки");
    }
    throw error;
  }
}

async function saveEvents() {
  enrollments = dedupeEnrollments(enrollments);
  trimPastEventsData();
  await JsonBoxStorage.saveAppData({
    events,
    enrollments,
  });
  updateJsonStorageBadge();
}

/** После save — подтянуть с сервера и убрать дубликаты id */
async function reloadEventsFromStorage() {
  const payload = await JsonBoxStorage.getAppData();
  const loaded = payload.events.map(normalizeEvent);
  const byId = new Map();
  loaded.forEach((item) => byId.set(item.id, item));
  events = [...byId.values()];
  enrollments = dedupeEnrollments(payload.enrollments);
  trimPastEventsData();
  updateJsonStorageBadge();
}

function generateEventId() {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getTodayDateString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function renderEmptyState() {
  const hasAnyEvents = events.length > 0;
  const inPastMode = isAdmin && filterState.showPast;
  const upcomingCount = events.filter((event) => !isEventPast(event)).length;

  if (!hasAnyEvents) {
    if (isAdmin) {
      return `
        <div class="empty-state">
          <div class="empty-icon">📅</div>
          <h2>Пока нет мероприятий</h2>
          <p>Добавьте первое мероприятие — его увидят участники сообщества.</p>
          <button type="button" class="add-event-btn empty-cta" id="emptyAddBtn">Добавить мероприятие</button>
        </div>
      `;
    }
    return `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <h2>Пока нет мероприятий</h2>
        <p>Загляните позже — здесь появятся анонсы.</p>
      </div>
    `;
  }

  if (inPastMode) {
    return `
      <div class="empty-state">
        <div class="empty-icon">🗂️</div>
        <h2>Нет прошедших мероприятий</h2>
        <p>В архиве пока пусто или они скрыты другими фильтрами.</p>
      </div>
    `;
  }

  if (upcomingCount === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">⏳</div>
        <h2>Нет предстоящих мероприятий</h2>
        <p>Скоро здесь появятся новые анонсы.</p>
      </div>
    `;
  }

  if (filterState.favoritesOnly) {
    return `
      <div class="empty-state">
        <div class="empty-icon">⭐</div>
        <h2>В избранном пусто</h2>
        <p>Нажмите звёздочку на карточке, чтобы сохранить мероприятие.</p>
      </div>
    `;
  }

  return `
    <div class="empty-state">
      <div class="empty-icon">🔍</div>
      <h2>Ничего не найдено</h2>
      <p>Попробуйте другой уровень или измените поиск.</p>
    </div>
  `;
}

function renderArchivedEventCard(event, options = {}) {
  const { viewOnly = false } = options;

  return `
    <article class="event-card event-card-past event-card-archived" data-id="${escapeHtml(event.id)}">
      <div class="card-top-row">
        <div class="event-header ${LevelColors.className(event.level)}">
          <h2 class="event-title">${escapeHtml(event.title)}</h2>
          ${renderSchedulesList(event)}
        </div>
      </div>
      <div class="badge-row">
        <span class="badge level ${LevelColors.className(event.level)}">${escapeHtml(formatLevelLabel(event.level))}</span>
        <span class="badge enrollment-closed">Архив</span>
      </div>
      <p class="event-archived-note">Сохранены только дата, название и уровень.</p>
      ${
        !viewOnly && isAdmin
          ? `<div class="edit-buttons no-export">
              <button type="button" class="delete-btn" data-action="delete" data-id="${escapeHtml(event.id)}">Удалить</button>
            </div>`
          : ""
      }
    </article>
  `;
}

function renderEventCard(event, options = {}) {
  if (isEventArchived(event)) {
    return renderArchivedEventCard(event, options);
  }

  const { viewOnly = false } = options;
  const functionalityItems = textToList(event.functionality);
  const conditionItems = textToList(event.conditions);
  const isFavorite = Favorites.has(event.id);
  const enrollmentClass =
    event.enrollment === "closed" ? "enrollment-closed" : "enrollment-open";
  const showScheduleBtn =
    isAdmin || EventSchedule.canView(event);
  const scheduleBtnLabel = EventSchedule.getCardButtonLabel();

  return `
    <article class="event-card ${isEventPast(event) ? "event-card-past" : ""}" data-id="${escapeHtml(event.id)}">
      <div class="card-top-row">
        <div class="event-header ${LevelColors.className(event.level)}">
          <h2 class="event-title">${escapeHtml(event.title)}</h2>
          ${renderSchedulesList(event)}
          <p class="event-location">📍 ${escapeHtml(event.location)}</p>
        </div>
        <div class="card-top-actions no-export">
          <button type="button" class="favorite-btn ${isFavorite ? "active" : ""}" data-action="favorite" data-id="${escapeHtml(event.id)}" aria-label="В избранное">${isFavorite ? "★" : "☆"}</button>
        </div>
      </div>

      <div class="badge-row">
        <span class="badge level ${LevelColors.className(event.level)}">${escapeHtml(formatLevelLabel(event.level))}</span>
        <span class="badge ${enrollmentClass}">${escapeHtml(formatEnrollmentLabel(event.enrollment))}</span>
      </div>

      ${
        event.description
          ? `<p class="event-desc">${escapeHtml(event.description)}</p>`
          : ""
      }

      ${renderEventBulletSection("Функционал", functionalityItems)}
      ${renderEventBulletSection("Условия", conditionItems)}

      <div class="card-actions no-export">
        ${renderCardPrimaryActions(event)}
        ${
          showScheduleBtn
            ? `<button type="button" class="schedule-card-btn" data-action="open-schedule" data-id="${escapeHtml(event.id)}">${escapeHtml(scheduleBtnLabel)}</button>`
            : ""
        }
      </div>

      ${
        isAdmin
          ? `<div class="admin-card-actions no-export">
              <button type="button" class="secondary-btn" data-action="copy-info" data-id="${escapeHtml(event.id)}">Скопировать информацию</button>
            </div>`
          : ""
      }

      ${
        !viewOnly && isAdmin
          ? `<div class="edit-buttons no-export">
              <button type="button" class="edit-btn" data-action="edit" data-id="${escapeHtml(event.id)}">Изменить</button>
              <button type="button" class="delete-btn" data-action="delete" data-id="${escapeHtml(event.id)}">Удалить</button>
              <button type="button" class="secondary-btn" data-action="export-png" data-id="${escapeHtml(event.id)}" data-title="${escapeHtml(event.title)}">Скачать PNG 9:16</button>
            </div>`
          : ""
      }
    </article>
  `;
}

async function upsertEnrollment(eventId, userId, status, updatedBy = userId) {
  const normalizedStatus = Object.values(ENROLLMENT_STATUSES).includes(status)
    ? status
    : ENROLLMENT_STATUSES.PENDING;
  const now = new Date().toISOString();
  const numericUserId = Number(userId);
  if (!eventId || !numericUserId) return null;

  const existing = getEnrollmentForUser(eventId, numericUserId);
  const record = normalizeEnrollment({
    ...(existing || {}),
    id: existing?.id || `enr-${getEnrollmentKey(eventId, numericUserId)}`,
    eventId,
    userId: numericUserId,
    status: normalizedStatus,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: Number(updatedBy) || null,
  });

  if (existing) {
    enrollments = enrollments.map((item) => (item.id === existing.id ? record : item));
  } else {
    enrollments = [record, ...enrollments];
  }

  await saveEvents();
  await reloadEventsFromStorage();
  return record;
}

async function removeEnrollmentById(enrollmentId) {
  if (!enrollmentId) return;
  enrollments = enrollments.filter((item) => item.id !== enrollmentId);
  await saveEvents();
  await reloadEventsFromStorage();
}

async function applyEnrollmentDecisions(decisions = [], updatedBy = currentUserId) {
  const valid = Array.isArray(decisions)
    ? decisions.filter(
        (item) =>
          item &&
          item.enrollmentId &&
          (item.action === "approve" || item.action === "reject" || item.action === "delete")
      )
    : [];

  if (!valid.length) return 0;

  const byId = new Map(enrollments.map((item) => [item.id, item]));
  let changed = 0;

  valid.forEach((decision) => {
    const current = byId.get(decision.enrollmentId);
    if (!current) return;

    if (decision.action === "delete") {
      byId.delete(decision.enrollmentId);
      changed += 1;
      return;
    }

    const nextStatus =
      decision.action === "approve"
        ? ENROLLMENT_STATUSES.APPROVED
        : ENROLLMENT_STATUSES.REJECTED;

    if (current.status === nextStatus) return;

    byId.set(
      decision.enrollmentId,
      normalizeEnrollment({
        ...current,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
        updatedBy: Number(updatedBy) || null,
      })
    );
    changed += 1;
  });

  if (!changed) return 0;

  enrollments = [...byId.values()];
  await saveEvents();
  await reloadEventsFromStorage();
  return changed;
}

// --- Карточки: обработчики (делегирование после innerHTML) ---

function bindEventCardActions(container) {
  if (!container) return;

  container.querySelectorAll("[data-action=copy-info]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const event = findEventById(events, btn.dataset.id);
      if (!event) return;

      const text = buildEventShareText(event);
      const copied = await VkAuth.copyText(text);

      if (copied) {
        flashButtonLabel(btn, "Скопировано!");
      } else {
        prompt("Скопируйте текст:", text);
      }
    });
  });

  container.querySelectorAll("[data-action=export-png]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Создаём PNG…";
      try {
        const event = findEventById(events, btn.dataset.id);
        await CardPngExport.exportCard(event);
      } catch (error) {
        alert(error.message || "Не удалось скачать PNG");
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });

  container.querySelectorAll("[data-action=favorite]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Favorites.toggle(btn.dataset.id);
      renderCurrentView();
    });
  });

  container.querySelectorAll("[data-action=open-schedule]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openSchedulePage(btn.dataset.id);
    });
  });

  container.querySelectorAll("[data-action=join-chat]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      const link = btn.getAttribute("href") || "";
      const eventId = btn.dataset.id;
      if (!link) return;

      event.preventDefault();
      btn.classList.add("join-btn--loading");
      btn.setAttribute("aria-disabled", "true");
      try {
        if (currentUserId) {
          await upsertEnrollment(eventId, currentUserId, ENROLLMENT_STATUSES.PENDING);
        }
      } catch (error) {
        console.warn("enrollment:", error);
      } finally {
        btn.classList.remove("join-btn--loading");
        btn.removeAttribute("aria-disabled");
      }

      window.location.href = link;
    });
  });

  if (isAdmin) {
    container.querySelectorAll("[data-action=edit]").forEach((btn) => {
      btn.addEventListener("click", () => openEditModal(btn.dataset.id));
    });
    container.querySelectorAll("[data-action=delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteEvent(btn.dataset.id));
    });
  }
}

function showEventViewModal(visible) {
  const modal = document.getElementById("eventViewModal");
  modal.classList.toggle("open", visible);
  modal.setAttribute("aria-hidden", visible ? "false" : "true");
  document.body.style.overflow = visible ? "hidden" : "";
}

function openEventViewModal(eventId) {
  const event = findEventById(events, eventId);
  if (!event) return;
  if (isEventArchived(event) && !isAdmin) {
    return;
  }

  const body = document.getElementById("eventViewBody");
  body.innerHTML = renderEventCard(event, { viewOnly: true });
  bindEventCardActions(body);
  showEventViewModal(true);
}

function setViewMode(mode) {
  viewMode =
    mode === "calendar" || mode === "attended" || mode === "users"
      ? mode
      : "list";
  if (viewMode === "users" && !isAdmin) {
    viewMode = "list";
  }

  document.querySelectorAll(".view-switch-btn").forEach((btn) => {
    const active = btn.dataset.view === viewMode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.getElementById("listView").classList.toggle("hidden", viewMode !== "list");
  const calendarView = document.getElementById("calendarView");
  calendarView.classList.toggle("hidden", viewMode !== "calendar");
  calendarView.setAttribute(
    "aria-hidden",
    viewMode !== "calendar" ? "true" : "false"
  );
  const attendedView = document.getElementById("attendedView");
  attendedView?.classList.toggle("hidden", viewMode !== "attended");
  attendedView?.setAttribute("aria-hidden", viewMode !== "attended" ? "true" : "false");
  const usersView = document.getElementById("usersView");
  usersView?.classList.toggle("hidden", viewMode !== "users");
  usersView?.setAttribute("aria-hidden", viewMode !== "users" ? "true" : "false");
  document
    .querySelector(".toolbar")
    ?.classList.toggle("hidden", viewMode === "attended" || viewMode === "users");

  renderCurrentView();
}

function renderCurrentView() {
  if (hasAdminAccess) {
    updateAdminUi();
  }

  updateEventsFilterUi();

  if (viewMode === "calendar") {
    CalendarView.render();
    return;
  }

  if (viewMode === "attended") {
    renderAttendedEvents();
    return;
  }

  if (viewMode === "users") {
    renderUsersRegistry();
    return;
  }

  renderEvents();
}

function renderEvents() {
  const container = document.getElementById("eventsContainer");
  const visible = getFilteredEvents();

  if (!visible.length) {
    container.innerHTML = renderEmptyState();
    document.getElementById("emptyAddBtn")?.addEventListener("click", openAddModal);
    return;
  }

  container.innerHTML = visible.map((event) => renderEventCard(event)).join("");
  bindEventCardActions(container);
  scrollToEventFromUrl();
}

function getMyEnrollmentRecords() {
  if (!currentUserId) return [];
  return enrollments
    .filter((item) => Number(item.userId) === Number(currentUserId))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function renderAttendedEvents() {
  const container = document.getElementById("attendedContainer");
  if (!container) return;
  if (!currentUserId) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><h2>Недоступно вне VK</h2><p>История посещений доступна в mini app VK.</p></div>`;
    return;
  }

  const myRecords = getMyEnrollmentRecords();
  if (!myRecords.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📌</div><h2>Пока нет записей</h2><p>Нажмите «Перейти в чат» у мероприятия, чтобы добавить его сюда.</p></div>`;
    return;
  }

  const cards = myRecords
    .map((record) => {
      const event = findEventById(events, record.eventId);
      if (!event) return "";
      const firstSchedule = getEventSchedules(event)[0];
      return `
        <article class="attended-mini-card">
          <h3 class="attended-mini-card__title">${escapeHtml(event.title)}</h3>
          <div class="attended-mini-card__meta">
            <span>${escapeHtml(formatDate(firstSchedule?.date || "") || "Дата не указана")}</span>
            <span>${escapeHtml(formatLevelLabel(event.level) || "Уровень не указан")}</span>
          </div>
        </article>
      `;
    })
    .filter(Boolean)
    .join("");

  const attendedForPoints = getMyAttendedEventsFromRecords(myRecords);

  container.innerHTML =
    (cards || `<div class="empty-state"><h2>Нет доступных карточек</h2></div>`) +
    renderAttendedPointsSummary(attendedForPoints);
}

function buildUsersRegistryItems() {
  const grouped = new Map();
  enrollments.forEach((item) => {
    const userId = Number(item.userId);
    if (!userId) return;
    if (!grouped.has(userId)) {
      grouped.set(userId, {
        userId,
        pending: 0,
        approved: 0,
        rejected: 0,
        events: new Set(),
      });
    }
    const target = grouped.get(userId);
    if (item.status === ENROLLMENT_STATUSES.APPROVED) target.approved += 1;
    else if (item.status === ENROLLMENT_STATUSES.REJECTED) target.rejected += 1;
    else target.pending += 1;
    target.events.add(String(item.eventId));
  });

  return [...grouped.values()].sort((a, b) => {
    const totalA = a.pending + a.approved + a.rejected;
    const totalB = b.pending + b.approved + b.rejected;
    return totalB - totalA;
  });
}

function renderUsersRegistry() {
  const container = document.getElementById("usersContainer");
  if (!container) return;

  if (!isAdmin) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><h2>Доступ только для администратора</h2></div>`;
    return;
  }

  const items = buildUsersRegistryItems();
  ensureParticipantProfiles(items.map((item) => item.userId));

  if (!items.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><h2>Пользователей пока нет</h2><p>Список формируется автоматически из заявок.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="user-registry-toolbar">
      <button type="button" class="delete-btn" data-action="clear-users-registry">Очистить список пользователей</button>
    </div>
    ${items
      .map((item) => {
        const eventsCount = item.events.size;
        return `
          <article class="user-registry-card">
            <h3 class="user-registry-card__name">${escapeHtml(getUserDisplayName(item.userId))}</h3>
            <p class="user-registry-card__id">ID: ${escapeHtml(String(item.userId))}</p>
            <div class="user-registry-card__stats">
              <span class="badge enrollment-status enrollment-status--pending">Ожидает: ${item.pending}</span>
              <span class="badge enrollment-status enrollment-status--approved">Подтверждено: ${item.approved}</span>
              <span class="badge enrollment-status enrollment-status--rejected">Отклонено: ${item.rejected}</span>
            </div>
            <p class="user-registry-card__events">Мероприятий: ${eventsCount}</p>
          </article>
        `;
      })
      .join("")}
  `;

  container
    .querySelector("[data-action=clear-users-registry]")
    ?.addEventListener("click", async () => {
      const confirmed = confirm(
        "Очистить список пользователей? Это удалит все заявки (enrollments)."
      );
      if (!confirmed) return;

      enrollments = [];
      participantProfiles.clear();
      await saveEvents();
      await reloadEventsFromStorage();
      renderUsersRegistry();
      renderCurrentView();
    });
}

function scrollToEventFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");
  if (!eventId) return;

  if (viewMode === "calendar") {
    openEventViewModal(eventId);
    return;
  }

  const card = document.querySelector(
    `.event-card[data-id="${CSS.escape(eventId)}"]`
  );
  if (card) {
    card.classList.add("event-card-highlight");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function openAddModal() {
  editingEventId = null;
  document.getElementById("modalTitle").textContent = "Новое мероприятие";
  document.getElementById("eventForm").reset();
  document.getElementById("eventId").value = "";
  document.getElementById("eventButtonLabel").value = DEFAULT_BUTTON_LABEL;
  document.getElementById("eventLevel").value = "региональный";
  document.getElementById("eventLocation").value = DEFAULT_LOCATION;
  document.getElementById("eventEnrollment").value = "open";
  document.getElementById("eventFunctionality").value = DEFAULT_FUNCTIONALITY;
  document.getElementById("eventConditions").value = DEFAULT_CONDITIONS;
  renderScheduleForm([{ date: getTodayDateString(), time: "", timeEnd: "" }]);
  setFormError("");
  showModal(true);
}

function openEditModal(eventId) {
  const event = findEventById(events, eventId);
  if (!event) return;

  if (isEventArchived(event)) {
    alert(
      "Архивная запись: полные данные удалены для экономии места. Доступно только удаление карточки."
    );
    return;
  }

  editingEventId = eventId;
  document.getElementById("modalTitle").textContent = "Редактировать мероприятие";
  document.getElementById("eventId").value = event.id;
  document.getElementById("eventTitle").value = event.title;
  renderScheduleForm(getEventSchedules(event));
  document.getElementById("eventLocation").value = event.location;
  document.getElementById("eventLevel").value = event.level;
  document.getElementById("eventEnrollment").value = event.enrollment;
  document.getElementById("eventFunctionality").value = event.functionality;
  document.getElementById("eventConditions").value = event.conditions;
  document.getElementById("eventDescription").value = event.description;
  document.getElementById("eventButtonLabel").value = event.buttonLabel;
  document.getElementById("eventButtonUrl").value = event.buttonUrl;
  setFormError("");
  showModal(true);
}

function showModal(visible) {
  const modal = document.getElementById("eventModal");
  modal.classList.toggle("open", visible);
  modal.setAttribute("aria-hidden", visible ? "false" : "true");
  if (!document.getElementById("eventViewModal")?.classList.contains("open")) {
    document.body.style.overflow = visible ? "hidden" : "";
  }
}

function readFormData() {
  const schedules = readSchedulesFromForm().filter(
    (item) => item.date && item.time
  );

  // plan сохраняем с существующего мероприятия при редактировании
  return normalizeEvent({
    id: document.getElementById("eventId").value || generateEventId(),
    title: document.getElementById("eventTitle").value.trim(),
    schedules,
    location: document.getElementById("eventLocation").value.trim(),
    level: document.getElementById("eventLevel").value,
    enrollment: document.getElementById("eventEnrollment").value,
    functionality: document.getElementById("eventFunctionality").value.trim(),
    conditions: document.getElementById("eventConditions").value.trim(),
    description: document.getElementById("eventDescription").value.trim(),
    buttonLabel: document.getElementById("eventButtonLabel").value.trim(),
    buttonUrl: document.getElementById("eventButtonUrl").value.trim(),
    plan:
      events.find(
        (item) =>
          String(item.id) === String(document.getElementById("eventId").value)
      )?.plan || EventSchedule.emptyPlan(),
  });
}

async function handleFormSubmit(event) {
  event.preventDefault();
  setFormError("");

  const submitBtn = document.getElementById("formSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Сохранение...";

  try {
    const eventData = readFormData();

    if (!eventData.title || !eventData.schedules.length || !eventData.buttonUrl) {
      setFormError(
        "Заполните название, ссылку и хотя бы одну дату с временем начала."
      );
      return;
    }

    if (editingEventId) {
      events = events.map((item) =>
        item.id === editingEventId ? eventData : item
      );
    } else {
      events = [eventData, ...events];
    }

    await saveEvents();
    await reloadEventsFromStorage();
    showModal(false);

    const isVisible = getFilteredEvents().some(
      (item) => item.id === eventData.id
    );

    if (!isVisible && isEventPast(eventData) && isAdmin) {
      const openPast = confirm(
        "Мероприятие сохранено, но дата уже в прошлом — в основном списке его не видно.\n\nОткрыть «Прошедшие мероприятия»?"
      );
      if (openPast) {
        filterState.showPast = true;
      }
    } else if (!isVisible) {
      alert(
        "Мероприятие сохранено. Если его не видно — сбросьте поиск, фильтр уровня или «Избранное»."
      );
    }

    renderCurrentView();
  } catch (error) {
    setFormError(error.message || "Ошибка сохранения");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Сохранить";
  }
}

async function deleteEvent(eventId) {
  if (!confirm("Удалить это мероприятие?")) return;

  try {
    events = events.filter((item) => item.id !== eventId);
    enrollments = enrollments.filter((item) => String(item.eventId) !== String(eventId));
    await saveEvents();
    await reloadEventsFromStorage();
    renderCurrentView();
  } catch (error) {
    alert(error.message || "Ошибка удаления");
  }
}

async function deleteAllPastEvents() {
  const pastEvents = events.filter(isEventPast);
  if (!pastEvents.length) {
    alert("Нет прошедших мероприятий для удаления.");
    return;
  }

  const count = pastEvents.length;
  const confirmed = confirm(
    `Удалить все прошедшие мероприятия (${count})?\n\nДействие нельзя отменить.`
  );
  if (!confirmed) return;

  try {
    const pastIds = new Set(pastEvents.map((item) => String(item.id)));
    events = events.filter((event) => !isEventPast(event));
    enrollments = enrollments.filter((item) => !pastIds.has(String(item.eventId)));
    await saveEvents();
    await reloadEventsFromStorage();
    renderCurrentView();
    alert(`Удалено мероприятий: ${count}.`);
  } catch (error) {
    alert(error.message || "Ошибка удаления");
  }
}

// --- Админ и предпросмотр ---

async function resolveAdminAccess() {
  const cfg = window.APP_CONFIG || {};

  if (await VkAuth.isCommunityManager()) {
    return true;
  }

  const devPassword = cfg.DEV_ADMIN_PASSWORD;
  if (devPassword && !VkAuth.isVkEnvironment) {
    const entered = prompt("Режим разработки: введите пароль администратора");
    return entered === devPassword;
  }

  return false;
}

function loadAdminPreviewPreference() {
  try {
    adminPreviewAsUser =
      sessionStorage.getItem(ADMIN_PREVIEW_STORAGE_KEY) === "1";
  } catch {
    adminPreviewAsUser = false;
  }
}

function saveAdminPreviewPreference() {
  try {
    sessionStorage.setItem(
      ADMIN_PREVIEW_STORAGE_KEY,
      adminPreviewAsUser ? "1" : "0"
    );
  } catch {
    // ignore
  }
}

/** UI админа отключён в режиме предпросмотра участника */
function applyAdminAccessState() {
  isAdmin = hasAdminAccess && !adminPreviewAsUser;
}

async function initAdminAccess() {
  hasAdminAccess = await resolveAdminAccess();
  loadAdminPreviewPreference();
  applyAdminAccessState();
}

function updateAdminPreviewToggle() {
  document
    .querySelectorAll("#adminPreviewToggleBtn, #scheduleAdminPreviewToggleBtn")
    .forEach((btn) => {
      btn.classList.toggle("hidden", !hasAdminAccess);
      if (!hasAdminAccess) return;

      btn.textContent = adminPreviewAsUser
        ? "Режим администратора"
        : "Как пользователь";
      btn.classList.toggle("active", adminPreviewAsUser);
      btn.setAttribute("aria-pressed", adminPreviewAsUser ? "true" : "false");
      btn.title = adminPreviewAsUser
        ? "Вернуться к инструментам управления"
        : "Посмотреть приложение глазами участника";
    });
}

function toggleAdminPreviewMode() {
  if (!hasAdminAccess) return;

  adminPreviewAsUser = !adminPreviewAsUser;
  saveAdminPreviewPreference();
  applyAdminAccessState();

  if (adminPreviewAsUser) {
    filterState.showPast = false;
  }

  updateAdminUi();
  renderCurrentView();
  refreshSchedulePageAccess();
}

function refreshSchedulePageAccess() {
  if (!isScheduleViewActive()) return;
  if (typeof EventSchedule === "undefined" || !EventSchedule.eventId) return;

  const event = EventSchedule.getEvent();
  const panel = document.getElementById("schedulePanel");
  const adminBar = document.getElementById("scheduleAdminBar");

  if (!event || (!isAdmin && !EventSchedule.canView(event))) {
    if (panel) {
      panel.innerHTML =
        '<div class="error-msg">Расписание недоступно или мероприятие не найдено.</div>';
    }
    adminBar?.classList.add("hidden");
    return;
  }

  EventSchedule.volunteerEditOpen = false;
  EventSchedule.render();
}

function setupAdminPreviewToggle() {
  document
    .querySelectorAll("#adminPreviewToggleBtn, #scheduleAdminPreviewToggleBtn")
    .forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", toggleAdminPreviewMode);
    });
}

function updateAdminUi() {
  updateAdminPreviewToggle();
  const hideAdminToolbar = !isAdmin || viewMode === "attended" || viewMode === "users";
  document.getElementById("adminToolbar")?.classList.toggle("hidden", hideAdminToolbar);
  document
    .getElementById("usersRegistryViewBtn")
    ?.classList.toggle("hidden", !isAdmin);
  document
    .getElementById("pastEventsFilterOption")
    ?.classList.toggle("hidden", !isAdmin);

  const deletePastBtn = document.getElementById("deleteAllPastBtn");
  if (deletePastBtn) {
    const pastCount = events.filter(isEventPast).length;
    const showDeletePast = isAdmin && filterState.showPast;
    deletePastBtn.classList.toggle("hidden", !showDeletePast);
    deletePastBtn.disabled = pastCount === 0;
    deletePastBtn.textContent =
      pastCount > 0
        ? `Удалить все прошедшие мероприятия (${pastCount})`
        : "Удалить все прошедшие мероприятия";
  }

  if (isAdmin) {
    if (viewMode === "users") {
      setSubtitle("Реестр пользователей");
      return;
    }
    if (viewMode === "attended") {
      setSubtitle("История посещений");
      return;
    }
    setSubtitle(
      filterState.showPast
        ? "Архив прошедших мероприятий"
        : "Руководство сообщества: актуальные мероприятия"
    );
  } else if (hasAdminAccess && adminPreviewAsUser) {
    setSubtitle(viewMode === "attended" ? "Мои посещённые мероприятия" : "Просмотр как участник");
  } else {
    setSubtitle(viewMode === "attended" ? "Мои посещённые мероприятия" : "Актуальные мероприятия");
  }

  updateJsonStorageBadge();
}

function isEventsFilterMenuOpen() {
  const dropdown = document.getElementById("eventsFilterDropdown");
  return dropdown && !dropdown.classList.contains("hidden");
}

function setEventsFilterMenuOpen(open) {
  const menu = document.getElementById("eventsFilterMenu");
  const trigger = document.getElementById("eventsFilterBtn");
  const dropdown = document.getElementById("eventsFilterDropdown");
  if (!menu || !trigger || !dropdown) return;

  menu.classList.toggle("filter-menu--open", open);
  dropdown.classList.toggle("hidden", !open);
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
}

function resetEventsFilters() {
  filterState.level = "all";
  filterState.favoritesOnly = false;
  filterState.showPast = false;
}

function updateEventsFilterUi() {
  const trigger = document.getElementById("eventsFilterBtn");
  const label = document.getElementById("eventsFilterBtnLabel");
  const dropdown = document.getElementById("eventsFilterDropdown");
  if (!trigger || !label || !dropdown) return;

  dropdown.querySelectorAll('[data-filter="level"]').forEach((item) => {
    const active = item.dataset.value === filterState.level;
    item.classList.toggle("active", active);
    item.setAttribute("aria-checked", active ? "true" : "false");
  });

  const favoritesItem = dropdown.querySelector('[data-filter="favorites"]');
  if (favoritesItem) {
    favoritesItem.classList.toggle("active", filterState.favoritesOnly);
    favoritesItem.setAttribute(
      "aria-checked",
      filterState.favoritesOnly ? "true" : "false"
    );
  }

  const pastItem = dropdown.querySelector('[data-filter="past"]');
  if (pastItem) {
    pastItem.classList.toggle("active", filterState.showPast);
    pastItem.setAttribute("aria-checked", filterState.showPast ? "true" : "false");
    pastItem.classList.toggle("hidden", !isAdmin);
  }

  const parts = [];
  if (filterState.level !== "all") {
    parts.push(formatLevelLabel(filterState.level));
  }
  if (filterState.favoritesOnly) {
    parts.push("Избранное");
  }
  if (filterState.showPast) {
    parts.push("Прошедшие");
  }

  label.textContent = parts.length ? parts.join(" · ") : "Фильтры";
  trigger.classList.toggle("filter-menu__trigger--active", parts.length > 0);
}

function setupFilters() {
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("input", () => {
    filterState.search = searchInput.value;
    renderCurrentView();
  });

  const menu = document.getElementById("eventsFilterMenu");
  const trigger = document.getElementById("eventsFilterBtn");
  const dropdown = document.getElementById("eventsFilterDropdown");

  trigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    setEventsFilterMenuOpen(!isEventsFilterMenuOpen());
  });

  dropdown?.addEventListener("click", (event) => {
    const item = event.target.closest(".filter-menu__item");
    if (!item) return;

    const filterType = item.dataset.filter;
    if (filterType === "level") {
      filterState.level = item.dataset.value || "all";
      setEventsFilterMenuOpen(false);
    } else if (filterType === "favorites") {
      filterState.favoritesOnly = !filterState.favoritesOnly;
    } else if (filterType === "past") {
      filterState.showPast = !filterState.showPast;
    } else if (filterType === "reset") {
      resetEventsFilters();
      setEventsFilterMenuOpen(false);
    }

    updateEventsFilterUi();
    renderCurrentView();
  });

  document.addEventListener("click", (event) => {
    if (!isEventsFilterMenuOpen()) return;
    if (menu?.contains(event.target)) return;
    setEventsFilterMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isEventsFilterMenuOpen()) {
      setEventsFilterMenuOpen(false);
    }
  });

  updateEventsFilterUi();
}

function setupViewSwitch() {
  document.querySelectorAll(".view-switch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setViewMode(btn.dataset.view);
    });
  });
}

function setupModal() {
  document.getElementById("eventViewClose")?.addEventListener("click", () => {
    showEventViewModal(false);
  });
  document.getElementById("eventViewModal")?.addEventListener("click", (e) => {
    if (e.target.id === "eventViewModal") {
      showEventViewModal(false);
    }
  });

  document.getElementById("addEventBtn").addEventListener("click", openAddModal);
  document
    .getElementById("deleteAllPastBtn")
    ?.addEventListener("click", deleteAllPastEvents);
  document.getElementById("addScheduleBtn").addEventListener("click", () => {
    document
      .getElementById("schedulesList")
      .appendChild(createScheduleRow({ date: getTodayDateString() }));
    setFormError("");
  });
  document.getElementById("modalClose").addEventListener("click", () => showModal(false));
  document.getElementById("eventForm").addEventListener("submit", handleFormSubmit);

  document.getElementById("eventModal").addEventListener("click", (e) => {
    if (e.target.id === "eventModal") showModal(false);
  });
}

// --- Запуск ---

async function bootstrap() {
  try {
    ensureConfig();
    await VkAuth.init();
    await loadCurrentUser();
    await loadGroupDirectorContact();
    await Favorites.load();
    await initAdminAccess();
    updateAdminUi();
    setupAdminPreviewToggle();
    setupScheduleNavigation();
    setupFilters();
    setupViewSwitch();
    CalendarView.init();
    setupModal();
    await loadEvents();
    tryOpenPendingSchedule();
  } catch (error) {
    console.error(error);
    const container = document.getElementById("eventsContainer");
    if (container) {
      container.innerHTML = `<div class="error-msg">${escapeHtml(
        error.message || "Не удалось запустить приложение"
      )}</div>`;
    }
    setSubtitle("Ошибка запуска");
  }
}

// schedule.html (legacy) не вызывает bootstrap — только redirect в schedule-page.js
if (!document.body.classList.contains("schedule-page")) {
  bootstrap();
}
