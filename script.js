const EVENT_LEVELS = [
  "вузовский",
  "городской",
  "региональный",
  "межрегиональный",
  "всероссийский",
  "международный",
];

const DEFAULT_LOCATION = "ЮРГПУ(НПИ)";

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

function normalizeEvent(raw) {
  const functionality = normalizeTextField(raw.functionality ?? raw.tasks);

  const conditions = normalizeTextField(raw.conditions);

  const enrollment =
    raw.enrollment === "closed" || raw.enrollmentStatus === "closed"
      ? "closed"
      : "open";

  return {
    id: String(raw.id || Date.now()),
    title: raw.title || "",
    date: raw.date || "",
    time: raw.time || raw.timeStart || "",
    timeEnd: raw.timeEnd || "",
    location: raw.location || DEFAULT_LOCATION,
    level: EVENT_LEVELS.includes(raw.level)
      ? raw.level
      : mapLegacyLevel(raw.level),
    enrollment,
    functionality,
    conditions,
    description: raw.description || "",
    buttonLabel: raw.buttonLabel || "Перейти",
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

function getEventStartDate(event) {
  const time = event.time || "00:00";
  return new Date(`${event.date}T${time}`);
}

function getEventEndDate(event) {
  const time = event.timeEnd || event.time || "23:59";
  return new Date(`${event.date}T${time}`);
}

function isEventPast(event) {
  if (!event.date) return false;
  return getEventEndDate(event) < new Date();
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

function formatTimeRange(event) {
  if (!event.time) return "";
  return event.timeEnd
    ? `${event.time} – ${event.timeEnd}`
    : event.time;
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

  list.sort((a, b) => getEventStartDate(a) - getEventStartDate(b));
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
              <p class="event-datetime">${escapeHtml(formatDate(event.date))} · ${escapeHtml(formatTimeRange(event))}</p>
              <p class="event-location">📍 ${escapeHtml(event.location)}</p>
            </div>
            <button type="button" class="favorite-btn ${isFavorite ? "active" : ""}" data-action="favorite" data-id="${escapeHtml(event.id)}" aria-label="В избранное">${isFavorite ? "★" : "☆"}</button>
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

          <div class="card-actions">
            <button type="button" class="join-btn" data-url="${escapeHtml(event.buttonUrl)}">
              ${escapeHtml(event.buttonLabel || "Перейти")}
            </button>
            <button type="button" class="secondary-btn" data-action="share" data-id="${escapeHtml(event.id)}">Поделиться</button>
          </div>

          ${
            isAdmin
              ? `<div class="edit-buttons">
                  <button type="button" class="edit-btn" data-action="edit" data-id="${escapeHtml(event.id)}">Изменить</button>
                  <button type="button" class="delete-btn" data-action="delete" data-id="${escapeHtml(event.id)}">Удалить</button>
                </div>`
              : ""
          }
        </article>
      `;
    })
    .join("");

  container.querySelectorAll(".join-btn").forEach((btn) => {
    btn.addEventListener("click", () => VkAuth.openLink(btn.dataset.url));
  });

  container.querySelectorAll("[data-action=share]").forEach((btn) => {
    btn.addEventListener("click", () => {
      VkAuth.shareLink(getEventShareUrl(btn.dataset.id));
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
  document.getElementById("eventButtonLabel").value = "Перейти";
  document.getElementById("eventLevel").value = "региональный";
  document.getElementById("eventLocation").value = DEFAULT_LOCATION;
  document.getElementById("eventEnrollment").value = "open";
  document.getElementById("eventDate").value = getTodayDateString();
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
  document.getElementById("eventDate").value = event.date;
  document.getElementById("eventTime").value = event.time;
  document.getElementById("eventTimeEnd").value = event.timeEnd || "";
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
  return normalizeEvent({
    id: document.getElementById("eventId").value || generateEventId(),
    title: document.getElementById("eventTitle").value.trim(),
    date: document.getElementById("eventDate").value,
    time: document.getElementById("eventTime").value,
    timeEnd: document.getElementById("eventTimeEnd").value,
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

    if (!eventData.title || !eventData.date || !eventData.buttonUrl) {
      setFormError("Заполните обязательные поля.");
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
    showModal(false);
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
