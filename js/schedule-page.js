/** Расписание внутри index.html — без перехода на отдельную страницу (важно для VK Mini App) */

function getScheduleRequestParams() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");
  if (params.get("page") !== "schedule" || !eventId) {
    return null;
  }
  return eventId;
}

function isScheduleViewActive() {
  const view = document.getElementById("scheduleView");
  return Boolean(view && !view.classList.contains("hidden"));
}

function buildMainPageUrl() {
  const url = new URL("index.html", window.location.href);
  url.searchParams.delete("page");
  url.searchParams.delete("event");
  EventSchedule.appendVkParams(url);
  return url.pathname + url.search;
}

function syncScheduleHistory(eventId, mode) {
  const url = new URL(window.location.href);
  if (mode === "schedule") {
    url.searchParams.set("page", "schedule");
    url.searchParams.set("event", eventId);
  } else {
    url.searchParams.delete("page");
    url.searchParams.delete("event");
  }

  const nextUrl = url.pathname + url.search;
  const state =
    mode === "schedule"
      ? { view: "schedule", eventId: String(eventId) }
      : { view: "main" };

  if (mode === "schedule") {
    history.pushState(state, "", nextUrl);
    return;
  }

  history.replaceState(state, "", nextUrl);
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

function openScheduleView(eventId, options = {}) {
  const mainView = document.getElementById("mainView");
  const scheduleView = document.getElementById("scheduleView");
  if (!mainView || !scheduleView || !eventId) return false;

  mainView.classList.add("hidden");
  scheduleView.classList.remove("hidden");
  document.body.classList.add("schedule-page");
  document.title = "Расписание";

  if (!options.skipHistory) {
    syncScheduleHistory(eventId, "schedule");
  }

  mountScheduleView(eventId);
  window.scrollTo(0, 0);
  return true;
}

function closeScheduleView(options = {}) {
  const mainView = document.getElementById("mainView");
  const scheduleView = document.getElementById("scheduleView");
  if (!mainView || !scheduleView) return;
  if (scheduleView.classList.contains("hidden")) return;

  scheduleView.classList.add("hidden");
  mainView.classList.remove("hidden");
  document.body.classList.remove("schedule-page");
  document.title = "Мероприятия";

  EventSchedule.eventId = null;

  if (!options.skipHistory) {
    syncScheduleHistory(null, "main");
  }

  window.scrollTo(0, 0);
}

function openSchedulePage(eventId) {
  if (!eventId) return;
  openScheduleView(eventId);
}

function setupScheduleNavigation() {
  document.getElementById("scheduleBackLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (history.state?.view === "schedule") {
      history.back();
      return;
    }
    closeScheduleView({ skipHistory: true });
    syncScheduleHistory(null, "main");
  });

  window.addEventListener("popstate", () => {
    const eventId = getScheduleRequestParams();
    if (eventId) {
      openScheduleView(eventId, { skipHistory: true });
      return;
    }
    closeScheduleView({ skipHistory: true });
  });
}

function tryOpenScheduleFromUrl() {
  const eventId = getScheduleRequestParams();
  if (!eventId) return false;
  return openScheduleView(eventId, { skipHistory: true });
}

/** Запуск отдельной schedule.html — перенаправление на index.html */
async function bootstrapSchedulePage() {
  const params = new URLSearchParams(window.location.search);
  const url = new URL("index.html", window.location.href);
  url.searchParams.set("page", "schedule");

  const eventId = params.get("event");
  if (eventId) {
    url.searchParams.set("event", eventId);
  }

  EventSchedule.appendVkParams(url);
  window.location.replace(url.pathname + url.search);
}

if (document.body.classList.contains("schedule-page")) {
  bootstrapSchedulePage();
}
