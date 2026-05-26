/** Запуск отдельной страницы schedule.html */
async function bootstrapSchedulePage() {
  const panel = document.getElementById("schedulePanel");

  try {
    ensureConfig();
    await VkAuth.init();
    isAdmin = await resolveAdminAccess();
    await loadEvents();

    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event");
    if (!eventId) {
      panel.innerHTML =
        '<div class="error-msg">Не указано мероприятие. Вернитесь к списку.</div>';
      return;
    }

    EventSchedule.init();
    const ok = EventSchedule.loadPage(eventId);
    if (!ok) {
      panel.innerHTML =
        '<div class="error-msg">Расписание недоступно или мероприятие не найдено.</div>';
    }

    const backLink = document.getElementById("scheduleBackLink");
    if (backLink) {
      backLink.href = EventSchedule.getIndexUrl();
    }
  } catch (error) {
    console.error(error);
    if (panel) {
      panel.innerHTML = `<div class="error-msg">${escapeHtml(
        error.message || "Не удалось загрузить расписание"
      )}</div>`;
    }
  }
}

if (document.body.classList.contains("schedule-page")) {
  bootstrapSchedulePage();
}
