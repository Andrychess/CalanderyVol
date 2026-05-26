/** Расписание: только подмена блоков на index.html, без смены URL (важно для VK Mini App) */

const PENDING_SCHEDULE_KEY = "cal_pending_schedule";

function isScheduleViewActive() {
  const view = document.getElementById("scheduleView");
  return Boolean(view && !view.classList.contains("hidden"));
}

function mountScheduleView(eventId) {
  const panel = document.getElementById("schedulePanel");
  if (!panel) return false;

  EventSchedule.init();
  setupAdminPreviewToggle();
  updateAdminPreviewToggle();

  const ok = EventSchedule.loadPage(eventId);
  if (!ok) {
    panel.innerHTML =
      '<div class="error-msg">Расписание недоступно или мероприятие не найдено.</div>';
  }

  return ok;
}

function openScheduleView(eventId) {
  const mainView = document.getElementById("mainView");
  const scheduleView = document.getElementById("scheduleView");
  if (!mainView || !scheduleView || !eventId) return false;

  mainView.classList.add("hidden");
  scheduleView.classList.remove("hidden");
  document.body.classList.add("schedule-page");
  document.title = "Расписание";

  mountScheduleView(eventId);
  window.scrollTo(0, 0);
  return true;
}

function closeScheduleView() {
  const mainView = document.getElementById("mainView");
  const scheduleView = document.getElementById("scheduleView");
  if (!mainView || !scheduleView) return;
  if (scheduleView.classList.contains("hidden")) return;

  if (EventSchedule._regulationTimer) {
    clearInterval(EventSchedule._regulationTimer);
    EventSchedule._regulationTimer = null;
  }

  scheduleView.classList.add("hidden");
  mainView.classList.remove("hidden");
  document.body.classList.remove("schedule-page");
  document.title = "Мероприятия";

  EventSchedule.eventId = null;
  window.scrollTo(0, 0);
}

function openSchedulePage(eventId) {
  if (!eventId) return;
  openScheduleView(eventId);
}

function setupScheduleNavigation() {
  document.getElementById("scheduleBackLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    closeScheduleView();
  });
}

function tryOpenPendingSchedule() {
  let eventId = null;

  try {
    eventId = sessionStorage.getItem(PENDING_SCHEDULE_KEY);
    if (eventId) {
      sessionStorage.removeItem(PENDING_SCHEDULE_KEY);
    }
  } catch {
    eventId = null;
  }

  if (!eventId) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("page") === "schedule") {
      eventId = params.get("event");
    }
  }

  if (eventId) {
    openScheduleView(eventId);
  }
}

/** Старые ссылки schedule.html → index.html через sessionStorage, без page= в URL */
function redirectLegacySchedulePage() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");

  if (eventId) {
    try {
      sessionStorage.setItem(PENDING_SCHEDULE_KEY, eventId);
    } catch {
      // ignore
    }
  }

  const url = new URL("index.html", window.location.href);
  EventSchedule.appendVkParams(url);
  window.location.replace(url.pathname + url.search);
}

if (document.body.classList.contains("schedule-page-legacy")) {
  redirectLegacySchedulePage();
}
