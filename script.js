const EVENT_LEVELS = [
  "вузовский",
  "городской",
  "региональный",
  "межрегиональный",
  "всероссийский",
  "международный",
];

const DEFAULT_LOCATION = "ЮРГПУ(НПИ)";
const DEFAULT_BUTTON_LABEL =
  "Подтвердить участие (перейти в информационный чат)";

let events = [];
let isAdmin = false;
let editingEventId = null;

const filterState = {
  search: "",
  level: "all",
  favoritesOnly: false,
  showPast: false,
};

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
  };
}

function mapLegacyLevel(level) {
  const map = {
    Муниципальное: "городской",
    Региональное: "региональный",
    Федеральное: "всероссийский",
  };
  return map[level] || "региональный";
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

function isSchedulePast(schedule) {
  if (!schedule.date) return false;
  return getScheduleEnd(schedule) < new Date();
}

function isEventPast(event) {
  const schedules = getEventSchedules(event);
  if (!schedules.length) return false;
  return schedules.every(isSchedulePast);
}

function getEventSortDate(event) {
  const schedules = getEventSchedules(event);
  const upcoming = schedules.filter((item) => !isSchedulePast(item));
  const target = upcoming.length ? upcoming : schedules;
  return target.length ? getScheduleStart(target[0]) : new Date(0);
}

function formatLevelLabel(level) {
  if (!level) return "";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function formatEnrollmentLabel(enrollment) {
  return enrollment === "closed" ? "Набор закрыт" : "Набор открыт";
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString + "T12:00:00");
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatScheduleLine(schedule) {
  const datePart = formatDate(schedule.date);
  if (!schedule.time) return datePart;
  const timePart = schedule.timeEnd
    ? `${schedule.time} – ${schedule.timeEnd}`
    : schedule.time;
  return `${datePart} · ${timePart}`;
}

function renderSchedulesList(event) {
  const schedules = getEventSchedules(event);
  if (!schedules.length) {
    return '<p class="event-datetime">Дата не указана</p>';
  }

  if (schedules.length === 1) {
    return `<p class="event-datetime">${escapeHtml(formatScheduleLine(schedules[0]))}</p>`;
  }

  return `
    <ul class="event-schedules">
      ${schedules.map((item) => `<li>${escapeHtml(formatScheduleLine(item))}</li>`).join("")}
    </ul>
  `;
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

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderJoinButton(event) {
  const label = escapeHtml(event.buttonLabel || DEFAULT_BUTTON_LABEL);
  const url = VkAuth.normalizeLink(event.buttonUrl);

  if (!url) {
    return `<span class="join-btn join-btn--disabled" aria-disabled="true">${label}</span>`;
  }

  return `<a class="join-btn" href="${escapeAttr(url)}" rel="noopener noreferrer">${label}</a>`;
}

function textToList(text) {
  if (text == null || text === "") return [];
  if (Array.isArray(text)) {
    return text.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const PNG_EXPORT_LIST_LIMIT = 7;
const PNG_EXPORT_DESC_LIMIT = 360;

function truncateForExport(text, maxLen) {
  const value = String(text || "").trim();
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1).trim()}…`;
}

function renderExportSchedules(event) {
  const schedules = getEventSchedules(event);
  if (!schedules.length) {
    return '<p class="png-export-story__schedule">Дата не указана</p>';
  }

  if (schedules.length === 1) {
    return `<p class="png-export-story__schedule">${escapeHtml(formatScheduleLine(schedules[0]))}</p>`;
  }

  return `
    <ul class="png-export-story__schedules">
      ${schedules
        .map(
          (item) =>
            `<li class="png-export-story__schedule">${escapeHtml(formatScheduleLine(item))}</li>`
        )
        .join("")}
    </ul>
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

function getEventShareUrl(eventId) {
  const url = new URL(window.location.href);
  url.searchParams.set("event", eventId);
  return url.toString();
}

function setSubtitle(text) {
  document.getElementById("appSubtitle").textContent = text;
}

function setFormError(message) {
  document.getElementById("formError").textContent = message || "";
}

function getFilteredEvents() {
  let list = [...events];

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
  container.innerHTML = '<div class="loading">Загрузка мероприятий...</div>';

  try {
    events = (await JsonBoxStorage.getEvents()).map(normalizeEvent);

    if (events.length === 0) {
      const seeded = await trySeedFromLocalFile();
      if (seeded.length > 0 && isAdmin) {
        events = seeded;
        await JsonBoxStorage.saveEvents(events);
      }
    }

    renderEvents();
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="error-msg">Не удалось загрузить данные: ${escapeHtml(error.message)}</div>`;
    setSubtitle("Ошибка загрузки");
  }
}

async function trySeedFromLocalFile() {
  try {
    const response = await fetch("events.json?v=" + Date.now());
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data) ? data : data.events;
    return Array.isArray(list) ? list.map(normalizeEvent) : [];
  } catch {
    return [];
  }
}

async function saveEvents() {
  await JsonBoxStorage.saveEvents(events);
}

async function reloadEventsFromStorage() {
  const loaded = (await JsonBoxStorage.getEvents()).map(normalizeEvent);
  const byId = new Map();
  loaded.forEach((item) => byId.set(item.id, item));
  events = [...byId.values()];
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

function renderEvents() {
  const container = document.getElementById("eventsContainer");
  const visible = getFilteredEvents();

  document.getElementById("pastEventsFilterBtn")?.classList.toggle(
    "active",
    filterState.showPast
  );
  document.getElementById("favoritesFilterBtn")?.classList.toggle(
    "active",
    filterState.favoritesOnly
  );

  if (!visible.length) {
    container.innerHTML = renderEmptyState();
    document.getElementById("emptyAddBtn")?.addEventListener("click", openAddModal);
    return;
  }

  container.innerHTML = visible
    .map((event) => {
      const functionalityItems = textToList(event.functionality);
      const conditionItems = textToList(event.conditions);
      const isFavorite = Favorites.has(event.id);
      const enrollmentClass =
        event.enrollment === "closed" ? "enrollment-closed" : "enrollment-open";

      return `
        <article class="event-card ${isEventPast(event) ? "event-card-past" : ""}" data-id="${escapeHtml(event.id)}">
          <div class="card-top-row">
            <div class="event-header">
              <h2 class="event-title">${escapeHtml(event.title)}</h2>
              ${renderSchedulesList(event)}
              <p class="event-location">📍 ${escapeHtml(event.location)}</p>
            </div>
            <button type="button" class="favorite-btn no-export ${isFavorite ? "active" : ""}" data-action="favorite" data-id="${escapeHtml(event.id)}" aria-label="В избранное">${isFavorite ? "★" : "☆"}</button>
          </div>

          <div class="badge-row">
            <span class="badge level">${escapeHtml(formatLevelLabel(event.level))}</span>
            <span class="badge ${enrollmentClass}">${escapeHtml(formatEnrollmentLabel(event.enrollment))}</span>
          </div>

          ${
            event.description
              ? `<p class="event-desc">${escapeHtml(event.description)}</p>`
              : ""
          }

          ${
            functionalityItems.length
              ? `<div class="event-block">
                  <strong>Функционал</strong>
                  <ul>${functionalityItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                </div>`
              : ""
          }

          ${
            conditionItems.length
              ? `<div class="event-block">
                  <strong>Условия</strong>
                  <ul>${conditionItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                </div>`
              : ""
          }

          <div class="card-actions no-export">
            ${renderJoinButton(event)}
            <button type="button" class="secondary-btn" data-action="share" data-id="${escapeHtml(event.id)}">Поделиться</button>
          </div>

          ${
            isAdmin
              ? `<div class="edit-buttons no-export">
                  <button type="button" class="edit-btn" data-action="edit" data-id="${escapeHtml(event.id)}">Изменить</button>
                  <button type="button" class="delete-btn" data-action="delete" data-id="${escapeHtml(event.id)}">Удалить</button>
                  <button type="button" class="secondary-btn" data-action="export-png" data-id="${escapeHtml(event.id)}" data-title="${escapeHtml(event.title)}">Скачать PNG 9:16</button>
                </div>`
              : ""
          }
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-action=share]").forEach((btn) => {
    btn.addEventListener("click", () => {
      VkAuth.shareLink(getEventShareUrl(btn.dataset.id));
    });
  });

  container.querySelectorAll("[data-action=export-png]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Создаём PNG…";
      try {
        const event = events.find(
          (item) => String(item.id) === String(btn.dataset.id)
        );
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
      renderEvents();
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

  scrollToEventFromUrl();
}

function scrollToEventFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");
  if (!eventId) return;

  const card = document.querySelector(`.event-card[data-id="${CSS.escape(eventId)}"]`);
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
  renderScheduleForm([{ date: getTodayDateString(), time: "", timeEnd: "" }]);
  setFormError("");
  showModal(true);
}

function openEditModal(eventId) {
  const event = events.find((item) => item.id === eventId);
  if (!event) return;

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
}

function readFormData() {
  const schedules = readSchedulesFromForm().filter(
    (item) => item.date && item.time
  );

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
        updateAdminUi();
      }
    } else if (!isVisible) {
      alert(
        "Мероприятие сохранено. Если его не видно — сбросьте поиск, фильтр уровня или «Избранное»."
      );
    }

    renderEvents();
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
    await saveEvents();
    await reloadEventsFromStorage();
    renderEvents();
  } catch (error) {
    alert(error.message || "Ошибка удаления");
  }
}

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

function updateAdminUi() {
  document.getElementById("adminToolbar").classList.toggle("hidden", !isAdmin);
  document
    .getElementById("pastEventsFilterBtn")
    .classList.toggle("hidden", !isAdmin);

  if (isAdmin) {
    setSubtitle(
      filterState.showPast
        ? "Архив прошедших мероприятий"
        : "Руководство сообщества: актуальные мероприятия"
    );
  } else {
    setSubtitle("Актуальные мероприятия");
  }
}

function setupFilters() {
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("input", () => {
    filterState.search = searchInput.value;
    renderEvents();
  });

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      filterState.level = chip.dataset.level;
      document.querySelectorAll(".filter-chip").forEach((el) => {
        el.classList.toggle("active", el === chip);
      });
      renderEvents();
    });
  });

  document.getElementById("favoritesFilterBtn").addEventListener("click", () => {
    filterState.favoritesOnly = !filterState.favoritesOnly;
    renderEvents();
  });

  document.getElementById("pastEventsFilterBtn").addEventListener("click", () => {
    filterState.showPast = !filterState.showPast;
    updateAdminUi();
    renderEvents();
  });
}

function setupModal() {
  document.getElementById("addEventBtn").addEventListener("click", openAddModal);
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

async function bootstrap() {
  try {
    ensureConfig();
  } catch (error) {
    document.getElementById("eventsContainer").innerHTML =
      `<div class="error-msg">${escapeHtml(error.message)}</div>`;
    setSubtitle("Нужна настройка");
    return;
  }

  await VkAuth.init();
  await Favorites.load();
  isAdmin = await resolveAdminAccess();
  updateAdminUi();
  setupFilters();
  setupModal();
  await loadEvents();
}

bootstrap();
