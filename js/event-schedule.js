/**
 * Расписание мероприятия: event.plan в JsonBox
 *
 * plan: {
 *   published: boolean,           // видно участникам (кроме isAdmin)
 *   regulationDays: [{ date, items: [{ id, time, timeEnd, title, note }] }],
 *   volunteerDays: [{ date, rows: [{ id, label, shifts: [{ id, from, to, note }] }] }]
 * }
 *
 * draft — черновик в памяти до «Сохранить»; ensure*Days синхронизирует дни с датами карточки.
 */
const EventSchedule = {
  eventId: null,
  tab: "regulations",
  draft: null,
  volunteerEditOpen: false,
  regulationShowPast: false,
  regulationDayDate: null,
  volunteerDayDate: null,
  participantDecisions: new Map(),
  _regulationTimer: null,
  _ready: false,

  /** Параметры VK при редиректе schedule.html → index.html */
  VK_PARAMS: ["vk_platform", "vk_user_id", "vk_group_id", "vk_app_id", "vk_ref"],

  appendVkParams(url) {
    const current = new URLSearchParams(window.location.search);
    this.VK_PARAMS.forEach((key) => {
      if (current.has(key)) {
        url.searchParams.set(key, current.get(key));
      }
    });
    return url;
  },

  getPageUrl(eventId) {
    return `#schedule-${eventId}`;
  },

  getIndexUrl() {
    return "#";
  },

  init() {
    if (this._ready) return;
    this._ready = true;

    document.getElementById("scheduleSaveBtn")?.addEventListener("click", () => {
      this.save(false);
    });
    document.getElementById("schedulePublishBtn")?.addEventListener("click", () => {
      this.save(true);
    });

    document.querySelectorAll(".schedule-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (this.tab === "regulations") {
          this.syncRegulationsFromDom();
        }
        if (this.tab === "volunteer") {
          this.syncVolunteerFromDom();
        }
        if (btn.dataset.tab === "participants" && !isAdmin) {
          return;
        }
        this.tab = btn.dataset.tab;
        this.render();
      });
    });
  },

  emptyPlan() {
    return {
      published: false,
      regulationDays: [],
      volunteerDays: [],
    };
  },

  /** Миграция plan.regulations[] → regulationDays[], нормализация полей */
  normalizePlan(input) {
    const plan =
      input?.plan && typeof input.plan === "object"
        ? input.plan
        : input?.regulationDays !== undefined ||
            input?.regulations !== undefined ||
            input?.volunteerDays !== undefined ||
            input?.published !== undefined
          ? input
          : this.emptyPlan();

    let regulationDays = Array.isArray(plan.regulationDays)
      ? plan.regulationDays.map((day) => this.normalizeRegulationDay(day))
      : [];

    const legacyRegulations = Array.isArray(plan.regulations)
      ? plan.regulations
          .map((item) => this.normalizeRegulation(item))
          .filter((item) => item.title || item.time || item.note)
      : [];

    if (
      legacyRegulations.length &&
      !regulationDays.some((day) => day.items.length)
    ) {
      regulationDays = [{ date: "", items: legacyRegulations }];
    }

    const volunteerDays = Array.isArray(plan.volunteerDays)
      ? plan.volunteerDays.map((day) => this.normalizeVolunteerDay(day))
      : [];

    return {
      published: Boolean(plan.published),
      regulationDays: regulationDays.filter((day) => day.date || day.items.length),
      volunteerDays: volunteerDays.filter((day) => day.date),
    };
  },

  normalizeRegulationDay(raw = {}) {
    const items = Array.isArray(raw.items)
      ? raw.items.map((item) => this.normalizeRegulation(item))
      : [];
    return {
      date: raw.date || "",
      items: items.filter((item) => item.title || item.time || item.note),
    };
  },

  normalizeRegulation(raw = {}) {
    return {
      id: String(raw.id || generateEventId()),
      time: raw.time || "",
      timeEnd: raw.timeEnd || "",
      title: String(raw.title || "").trim(),
      note: String(raw.note || "").trim(),
    };
  },

  normalizeVolunteerDay(raw = {}) {
    const rows = Array.isArray(raw.rows)
      ? raw.rows.map((row) => this.normalizeVolunteerRow(row))
      : [];
    return {
      date: raw.date || "",
      rows: rows.filter((row) => row.label || row.shifts.length),
    };
  },

  normalizeVolunteerRow(raw = {}) {
    const shifts = Array.isArray(raw.shifts)
      ? raw.shifts.map((shift) => this.normalizeShift(shift))
      : [];
    return {
      id: String(raw.id || generateEventId()),
      label: String(raw.label || "").trim(),
      shifts: shifts.filter((shift) => shift.from && shift.to),
    };
  },

  normalizeShift(raw = {}) {
    return {
      id: String(raw.id || generateEventId()),
      from: raw.from || "",
      to: raw.to || "",
      note: String(raw.note || "").trim(),
    };
  },

  hasContent(plan) {
    if (!plan) return false;
    if (
      plan.regulationDays?.some((day) =>
        day.items?.some((item) => item.title || item.time || item.note)
      )
    ) {
      return true;
    }
    if (
      plan.regulations?.some((item) => item.title || item.time || item.note)
    ) {
      return true;
    }
    return plan.volunteerDays?.some((day) =>
      day.rows?.some((row) => row.label || row.shifts?.length)
    );
  },

  /** Участник видит расписание только если опубликовано и есть содержимое */
  canView(event) {
    const plan = event?.plan;
    if (!plan || !this.hasContent(plan)) return false;
    return isAdmin || plan.published;
  },

  getCardButtonLabel() {
    return isAdmin ? "Сформировать расписание" : "Посмотреть расписание";
  },

  getEvent() {
    return events.find((item) => String(item.id) === String(this.eventId));
  },

  loadPage(eventId) {
    const event = events.find((item) => String(item.id) === String(eventId));
    if (!event) return false;
    if (!isAdmin && !this.canView(event)) return false;

    this.eventId = eventId;
    this.tab = "regulations";
    this.regulationShowPast = false;
    this.regulationDayDate = null;
    this.volunteerDayDate = null;
    this.participantDecisions = new Map();
    this.draft = structuredClone(event.plan || this.emptyPlan());
    this.ensureRegulationDays(this.draft, event);
    this.ensureVolunteerDays(this.draft, event);
    this.regulationDayDate = this.getDefaultRegulationDate(
      event,
      this.draft.regulationDays
    );
    this.volunteerDayDate = this.getDefaultScheduleDayDate(
      event,
      this.draft.volunteerDays
    );
    this.render();
    return true;
  },

  /**
   * Один объект regulationDays на каждую дату мероприятия.
   * Старые данные без date подставляются в первый день; лишние даты отбрасываются.
   */
  ensureRegulationDays(plan, event) {
    const dates = this.getEventDates(event);

    if (
      Array.isArray(plan.regulations) &&
      plan.regulations.length &&
      !plan.regulationDays?.some((day) => day.items?.length)
    ) {
      plan.regulationDays = [
        {
          date: dates[0] || "",
          items: plan.regulations.map((item) => this.normalizeRegulation(item)),
        },
      ];
      delete plan.regulations;
    }

    if (!Array.isArray(plan.regulationDays)) {
      plan.regulationDays = [];
    }

    const legacyOnlyDay = plan.regulationDays.find(
      (day) => !day.date && day.items?.length
    );
    if (legacyOnlyDay && dates[0]) {
      legacyOnlyDay.date = dates[0];
    }

    const byDate = new Map();
    for (const day of plan.regulationDays) {
      if (!day?.date) continue;
      byDate.set(day.date, this.cloneRegulationDay(day));
    }

    if (!dates.length) {
      const fallback =
        byDate.values().next().value ||
        this.cloneRegulationDay({ date: getTodayDateString(), items: [] });
      plan.regulationDays = [fallback];
      return;
    }

    plan.regulationDays = dates.map((date) => {
      const existing = byDate.get(date);
      return existing
        ? this.cloneRegulationDay(existing)
        : { date, items: [] };
    });
  },

  /** Аналогично regulationDays: по одному volunteerDay на дату, deep clone строк */
  ensureVolunteerDays(plan, event) {
    const dates = this.getEventDates(event);

    if (!Array.isArray(plan.volunteerDays)) {
      plan.volunteerDays = [];
    }

    const byDate = new Map();
    for (const day of plan.volunteerDays) {
      if (!day?.date) continue;
      byDate.set(day.date, this.cloneVolunteerDay(day));
    }

    if (!dates.length) {
      const fallback =
        byDate.values().next().value ||
        this.cloneVolunteerDay({ date: getTodayDateString(), rows: [] });
      plan.volunteerDays = [fallback];
      return;
    }

    plan.volunteerDays = dates.map((date) => {
      const existing = byDate.get(date);
      return existing
        ? this.cloneVolunteerDay(existing)
        : { date, rows: [] };
    });
  },

  cloneRegulationDay(raw = {}) {
    return this.normalizeRegulationDay({
      date: raw.date || "",
      items: Array.isArray(raw.items)
        ? raw.items.map((item) => this.normalizeRegulation(item))
        : [],
    });
  },

  cloneVolunteerDay(raw = {}) {
    return this.normalizeVolunteerDay({
      date: raw.date || "",
      rows: Array.isArray(raw.rows)
        ? raw.rows.map((row) => this.normalizeVolunteerRow(row))
        : [],
    });
  },

  getEventDates(event) {
    const dates = getEventSchedules(event)
      .map((item) => item.date)
      .filter(Boolean);
    return [...new Set(dates)];
  },

  getDefaultScheduleDayDate(event, days) {
    return this.getDefaultRegulationDate(event, days);
  },

  getDefaultRegulationDate(event, days) {
    const today = getTodayDateString();
    const dates = days.map((day) => day.date).filter(Boolean);
    if (!dates.length) return today;
    if (dates.includes(today)) return today;

    const upcoming = dates.find((date) => date > today);
    if (upcoming) return upcoming;

    return dates[dates.length - 1];
  },

  getSelectedRegulationDay(event) {
    const days = this.draft?.regulationDays || [];
    if (!days.length) return null;

    const eventRef = event || this.getEvent();
    const defaultDate = eventRef
      ? this.getDefaultRegulationDate(eventRef, days)
      : days[0].date;
    const date = this.regulationDayDate || defaultDate;
    const day = days.find((item) => item.date === date);

    if (day) return day;

    this.regulationDayDate = days[0].date;
    return days[0];
  },

  formatScheduleDayTabLabel(date, event) {
    if (!date) return "День";
    const shortDate = new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
    const schedule = getEventSchedules(event).find((item) => item.date === date);
    if (!schedule?.time) return shortDate;
    const time = schedule.timeEnd
      ? `${schedule.time}–${schedule.timeEnd}`
      : schedule.time;
    return `${shortDate} · ${time}`;
  },

  renderScheduleDayTabs(days, selectedDate, event, options = {}) {
    const {
      action = "select-regulation-day",
      ariaLabel = "Дни мероприятия",
      countField = "items",
    } = options;

    if (!days.length) {
      return `<p class="schedule-day-label">Дни мероприятия не указаны</p>`;
    }

    const activeDate =
      selectedDate ||
      (event ? this.getDefaultScheduleDayDate(event, days) : days[0].date);

    return `
      <div class="schedule-day-tabs" role="tablist" aria-label="${escapeAttr(ariaLabel)}">
        ${days
          .map((day) => {
            const isActive = day.date === activeDate;
            const count = day[countField]?.length || 0;
            return `
              <button
                type="button"
                class="schedule-day-tab ${isActive ? "active" : ""}"
                data-action="${escapeAttr(action)}"
                data-date="${escapeAttr(day.date)}"
                role="tab"
                aria-selected="${isActive ? "true" : "false"}"
              >
                <span class="schedule-day-tab__label">${escapeHtml(this.formatScheduleDayTabLabel(day.date, event))}</span>
                ${
                  count
                    ? `<span class="schedule-day-tab__count">${count}</span>`
                    : ""
                }
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  },

  renderRegulationDayTabs(days, selectedDate, event) {
    return this.renderScheduleDayTabs(days, selectedDate, event, {
      action: "select-regulation-day",
      ariaLabel: "Дни регламента",
      countField: "items",
    });
  },

  renderVolunteerDayTabs(days, selectedDate, event) {
    return this.renderScheduleDayTabs(days, selectedDate, event, {
      action: "select-volunteer-day",
      ariaLabel: "Дни волонтёрской смены",
      countField: "rows",
    });
  },

  getSelectedVolunteerDay(event) {
    const days = this.draft?.volunteerDays || [];
    if (!days.length) return null;

    const eventRef = event || this.getEvent();
    const defaultDate = eventRef
      ? this.getDefaultScheduleDayDate(eventRef, days)
      : days[0].date;
    const date = this.volunteerDayDate || defaultDate;
    const day = days.find((item) => item.date === date);

    if (day) return day;

    this.volunteerDayDate = days[0].date;
    return days[0];
  },

  render() {
    const event = this.getEvent();
    if (!event || !this.draft) return;
    if (this.tab === "participants" && !isAdmin) {
      this.tab = "regulations";
    }

    document.getElementById("schedulePageTitle").textContent = event.title;
    document.getElementById("schedulePageSubtitle").textContent =
      getEventSchedules(event)
        .map((item) => formatScheduleLine(item))
        .join(" · ") || "Даты не указаны";

    document.querySelectorAll(".schedule-tab").forEach((btn) => {
      if (btn.dataset.tab === "participants") {
        btn.classList.toggle("hidden", !isAdmin);
      }
      const active = btn.dataset.tab === this.tab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    const adminBar = document.getElementById("scheduleAdminBar");
    adminBar.classList.toggle("hidden", !isAdmin);

    const publishBtn = document.getElementById("schedulePublishBtn");
    if (publishBtn) {
      publishBtn.textContent = this.draft.published
        ? "Снять с публикации"
        : "Опубликовать расписание";
    }

    const panel = document.getElementById("schedulePanel");
    panel.innerHTML =
      this.tab === "regulations"
        ? this.renderRegulationsPanel(event)
        : this.tab === "volunteer"
          ? this.renderVolunteerPanel(event)
          : this.renderParticipantsPanel(event);

    this.bindPanelActions(event);
    this.scheduleRegulationRefresh();
  },

  /** У участника подсветка «сейчас» в регламенте обновляется раз в минуту */
  scheduleRegulationRefresh() {
    if (this._regulationTimer) {
      clearInterval(this._regulationTimer);
      this._regulationTimer = null;
    }

    if (this.tab !== "regulations" || isAdmin) return;

    this._regulationTimer = setInterval(() => {
      if (this.tab === "regulations" && !isAdmin && this.eventId) {
        this.render();
      }
    }, 60000);
  },

  getRegulationTimelineStatus(item, index, items, dayDate, event) {
    const today = getTodayDateString();
    if (!dayDate) return "upcoming";
    if (dayDate < today) return "past";
    if (dayDate > today) return "upcoming";

    if (!item.time && !item.timeEnd) return "neutral";

    const nowMinutes = this.timeToMinutes(
      `${String(new Date().getHours()).padStart(2, "0")}:${String(
        new Date().getMinutes()
      ).padStart(2, "0")}`
    );
    const start = item.time ? this.timeToMinutes(item.time) : null;
    let end = item.timeEnd ? this.timeToMinutes(item.timeEnd) : null;

    if (start !== null && end === null) {
      const next = items[index + 1];
      if (next?.time) {
        end = this.timeToMinutes(next.time);
      } else {
        end = this.timeToMinutes(this.getDayRange(event, dayDate).to);
      }
    }

    if (start === null) {
      return end !== null && nowMinutes >= end ? "past" : "upcoming";
    }

    if (nowMinutes >= (end ?? start)) return "past";
    if (nowMinutes >= start) return "current";
    return "upcoming";
  },

  renderRegulationsPanel(event) {
    const editable = isAdmin;
    const days = this.draft.regulationDays || [];
    const day = this.getSelectedRegulationDay(event) || {
      date: "",
      items: [],
    };
    const dayTabs = this.renderRegulationDayTabs(
      days,
      day.date,
      event
    );
    const sortedItems = [...(day.items || [])].sort(
      (a, b) => this.timeToMinutes(a.time) - this.timeToMinutes(b.time)
    );

    const pastCount = editable
      ? 0
      : sortedItems.filter(
          (item, index) =>
            this.getRegulationTimelineStatus(
              item,
              index,
              sortedItems,
              day.date,
              event
            ) === "past"
        ).length;

    const visibleItems = editable
      ? sortedItems
      : sortedItems.filter((item, index) => {
          const status = this.getRegulationTimelineStatus(
            item,
            index,
            sortedItems,
            day.date,
            event
          );
          return status !== "past" || this.regulationShowPast;
        });

    const totalItems = sortedItems.length;
    const dayHasContent = totalItems > 0;

    if (!dayHasContent && !editable) {
      return `
        <section class="schedule-section" data-regulation-date="${escapeAttr(day.date)}">
          ${dayTabs}
          <p class="schedule-empty">Регламент на этот день пока не добавлен.</p>
        </section>
      `;
    }

    if (!visibleItems.length && !editable && pastCount > 0) {
      return `
        <section class="schedule-section" data-regulation-date="${escapeAttr(day.date)}">
          ${dayTabs}
          <p class="schedule-empty">На выбранный день все пункты регламента уже прошли.</p>
          <button type="button" class="toggle-btn regulation-past-toggle" data-action="toggle-regulation-past">
            Показать прошедшие (${pastCount})
          </button>
          ${this.renderScheduleExportBtn("export-regulation-png", "Скачать регламент PNG")}
        </section>
      `;
    }

    return `
      <section class="schedule-section" data-regulation-date="${escapeAttr(day.date)}">
        ${dayTabs}
        ${
          editable
            ? `<button type="button" class="schedules-add-btn" data-action="add-regulation">+ Пункт регламента на ${escapeHtml(formatDate(day.date) || "этот день")}</button>`
            : pastCount > 0
              ? `<button type="button" class="toggle-btn regulation-past-toggle ${this.regulationShowPast ? "active" : ""}" data-action="toggle-regulation-past">
                  ${this.regulationShowPast ? "Скрыть прошедшие" : `Показать прошедшие (${pastCount})`}
                </button>`
              : ""
        }
        <ol class="regulation-list">
          ${visibleItems
            .map((item) => {
              const index = sortedItems.findIndex(
                (entry) => entry.id === item.id
              );
              const status = editable
                ? ""
                : this.getRegulationTimelineStatus(
                    item,
                    index,
                    sortedItems,
                    day.date,
                    event
                  );
              return this.renderRegulationItem(item, editable, status);
            })
            .join("")}
        </ol>
        ${
          !dayHasContent && editable
            ? `<p class="schedule-hint">Пункты добавляются отдельно для каждого дня. Переключайте вкладки выше.</p>`
            : ""
        }
        ${dayHasContent ? this.renderScheduleExportBtn("export-regulation-png", "Скачать регламент PNG") : ""}
      </section>
    `;
  },

  renderRegulationItem(item, editable, status = "") {
    const timeLabel = item.timeEnd
      ? `${item.time}–${item.timeEnd}`
      : item.time || "—";

    if (!editable) {
      const statusClass =
        status === "current" ? " regulation-item--current" : "";
      const statusBadge =
        status === "current"
          ? `<span class="regulation-item__badge">Сейчас</span>`
          : "";

      return `
        <li class="regulation-item${statusClass}">
          <span class="regulation-item__time">${escapeHtml(timeLabel)}</span>
          <div class="regulation-item__body">
            ${statusBadge}
            <strong>${escapeHtml(item.title || "Без названия")}</strong>
            ${
              item.note
                ? `<p class="regulation-item__note">${escapeHtml(item.note)}</p>`
                : ""
            }
          </div>
        </li>
      `;
    }

    return `
      <li class="regulation-item regulation-item--edit" data-reg-id="${escapeAttr(item.id)}">
        <div class="regulation-edit__times">
          <input type="time" class="regulation-time" value="${escapeAttr(item.time)}">
          <span>—</span>
          <input type="time" class="regulation-time-end" value="${escapeAttr(item.timeEnd)}">
        </div>
        <input type="text" class="regulation-title" value="${escapeAttr(item.title)}" placeholder="Название этапа" maxlength="200">
        <input type="text" class="regulation-note" value="${escapeAttr(item.note)}" placeholder="Комментарий (необязательно)" maxlength="300">
        <button type="button" class="schedule-remove-btn" data-action="remove-regulation" aria-label="Удалить">&times;</button>
      </li>
    `;
  },

  renderVolunteerPanel(event) {
    const editable = isAdmin;
    const days = this.draft.volunteerDays || [];
    const day = this.getSelectedVolunteerDay(event) || { date: "", rows: [] };
    const dayTabs = this.renderVolunteerDayTabs(days, day.date, event);
    const range = this.getDayRange(event, day.date);
    const hours = this.buildHourMarks(range.from, range.to);

    if (!day.rows.length && !editable) {
      return `
        <section class="schedule-section" data-volunteer-date="${escapeAttr(day.date)}">
          ${dayTabs}
          <p class="schedule-empty">Волонтерская смена на этот день пока не составлена.</p>
        </section>
      `;
    }

    return `
      <section class="schedule-section" data-volunteer-date="${escapeAttr(day.date)}">
        ${dayTabs}
        ${
          editable
            ? `<button type="button" class="toggle-btn volunteer-edit-toggle ${this.volunteerEditOpen ? "active" : ""}" data-action="toggle-volunteer-edit" type="button">
                ${this.volunteerEditOpen ? "Скрыть редактирование" : "Редактировать смены"}
              </button>`
            : ""
        }
        <div class="gantt-wrap">
          <div class="gantt" style="--gantt-cols: ${hours.length}">
            <div class="gantt__head">
              <div class="gantt__label-col">Участник</div>
              <div class="gantt__scale">
                ${hours.map((h) => `<span>${escapeHtml(h)}</span>`).join("")}
              </div>
            </div>
            ${day.rows
              .map((row) =>
                this.renderGanttRow(row, range, hours.length, editable, event)
              )
              .join("")}
          </div>
        </div>
        ${
          editable && this.volunteerEditOpen
            ? `<p class="schedule-hint">Новые участники добавляются автоматически через кнопку «Перейти в чат» в карточке мероприятия.</p>`
            : ""
        }
        ${day.rows.length ? this.renderScheduleExportBtn("export-volunteer-png", "Скачать смену PNG") : ""}
      </section>
    `;
  },

  renderParticipantsPanel(event) {
    const list = getEventEnrollments(event.id).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
    if (typeof ensureParticipantProfiles === "function") {
      ensureParticipantProfiles(list.map((item) => item.userId));
    }

    return `
      <section class="schedule-section">
        <h3>Участники мероприятия</h3>
        ${
          !list.length
            ? `<p class="schedule-empty">Пока нет заявок. Они появятся после нажатия «Перейти в чат».</p>`
            : `<div class="participant-list">
                ${list
                  .map(
                    (item) => `
                    <article class="participant-item" data-enrollment-id="${escapeAttr(item.id)}" data-user-id="${escapeAttr(item.userId)}">
                      <div class="participant-item__meta">
                        <strong>${escapeHtml(
                          typeof getUserDisplayName === "function"
                            ? getUserDisplayName(item.userId)
                            : `ID ${String(item.userId)}`
                        )}</strong>
                        <span class="badge enrollment-status enrollment-status--${escapeAttr(getEnrollmentStatusClass(item.status))}">${escapeHtml(getEnrollmentStatusLabel(item.status))}</span>
                      </div>
                      <p class="participant-item__date">Обновлено: ${escapeHtml(new Date(item.updatedAt).toLocaleString("ru-RU"))}</p>
                      <div class="participant-item__actions">
                        ${this.renderParticipantDecisionControls(item)}
                      </div>
                    </article>
                  `
                  )
                  .join("")}
              </div>
              <div class="participant-actions-bar">
                <button type="button" class="submit-btn" data-action="apply-participant-decisions">Принять изменения</button>
              </div>`
        }
      </section>
    `;
  },

  renderParticipantDecisionControls(item) {
    const selected = this.participantDecisions.get(item.id) || "none";
    const rowName = `decision-${item.id}`;
    return `
      <label class="participant-choice">
        <input type="radio" name="${escapeAttr(rowName)}" value="none" data-action="participant-decision" data-enrollment-id="${escapeAttr(item.id)}" ${selected === "none" ? "checked" : ""}>
        <span>Без изменений</span>
      </label>
      <label class="participant-choice">
        <input type="radio" name="${escapeAttr(rowName)}" value="approve" data-action="participant-decision" data-enrollment-id="${escapeAttr(item.id)}" ${selected === "approve" ? "checked" : ""}>
        <span>Да</span>
      </label>
      <label class="participant-choice">
        <input type="radio" name="${escapeAttr(rowName)}" value="reject" data-action="participant-decision" data-enrollment-id="${escapeAttr(item.id)}" ${selected === "reject" ? "checked" : ""}>
        <span>Нет</span>
      </label>
      <label class="participant-choice">
        <input type="radio" name="${escapeAttr(rowName)}" value="delete" data-action="participant-decision" data-enrollment-id="${escapeAttr(item.id)}" ${selected === "delete" ? "checked" : ""}>
        <span>Удалить</span>
      </label>
    `;
  },

  renderScheduleExportBtn(action, label) {
    return `
      <div class="schedule-export-bar">
        <button type="button" class="secondary-btn schedule-export-btn" data-action="${escapeAttr(action)}">${escapeHtml(label)}</button>
      </div>
    `;
  },

  renderGanttRow(row, range, colCount, editable, event) {
    const total = this.timeToMinutes(range.to) - this.timeToMinutes(range.from);
    const bars = row.shifts
      .map((shift) => {
        const left =
          ((this.timeToMinutes(shift.from) - this.timeToMinutes(range.from)) /
            total) *
          100;
        const width =
          ((this.timeToMinutes(shift.to) - this.timeToMinutes(shift.from)) /
            total) *
          100;
        const title = `${shift.from}–${shift.to}${shift.note ? ` · ${shift.note}` : ""}`;
        return `<span class="gantt-bar" style="left:${Math.max(0, left)}%;width:${Math.max(2, width)}%" title="${escapeAttr(title)}">${escapeHtml(shift.from)}–${escapeHtml(shift.to)}</span>`;
      })
      .join("");

    const showEdit = editable && this.volunteerEditOpen;

    if (!showEdit) {
      return `
        <div class="gantt__row">
          <div class="gantt__label-col">${escapeHtml(row.label || "—")}</div>
          <div class="gantt__track">${bars}</div>
        </div>
      `;
    }

    return `
      <div class="gantt__row gantt__row--edit" data-row-id="${escapeAttr(row.id)}">
        <input type="text" class="gantt-row-label" value="${escapeAttr(row.label)}" placeholder="Роль или имя" maxlength="120">
        <div class="gantt__track gantt__track--edit">${bars}</div>
        <div class="gantt-shifts-edit">
          ${row.shifts
            .map((shift) => this.renderShiftEditor(row.id, shift))
            .join("")}
          <button type="button" class="gantt-add-shift" data-action="add-shift" data-row-id="${escapeAttr(row.id)}">+ Смена</button>
        </div>
        <button type="button" class="schedule-remove-btn" data-action="remove-volunteer-row" data-row-id="${escapeAttr(row.id)}" aria-label="Удалить строку">&times;</button>
      </div>
    `;
  },

  renderShiftEditor(rowId, shift) {
    return `
      <div class="gantt-shift-edit" data-row-id="${escapeAttr(rowId)}" data-shift-id="${escapeAttr(shift.id)}">
        <input type="time" class="shift-from" value="${escapeAttr(shift.from)}" required>
        <span>—</span>
        <input type="time" class="shift-to" value="${escapeAttr(shift.to)}" required>
        <input type="text" class="shift-note" value="${escapeAttr(shift.note)}" placeholder="Зона / задача" maxlength="120">
        <button type="button" class="schedule-remove-btn schedule-remove-btn--sm" data-action="remove-shift" data-row-id="${escapeAttr(rowId)}" data-shift-id="${escapeAttr(shift.id)}">&times;</button>
      </div>
    `;
  },

  bindPanelActions(event) {
    const panel = document.getElementById("schedulePanel");
    if (!panel) return;

    this.bindScheduleExportActions(event);

    panel.querySelectorAll("[data-action=select-regulation-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextDate = btn.dataset.date;
        if (nextDate === this.regulationDayDate) return;

        if (isAdmin && this.tab === "regulations") {
          this.syncRegulationsFromDom();
        }

        this.regulationDayDate = nextDate;
        this.regulationShowPast = false;
        this.render();
      });
    });

    panel.querySelectorAll("[data-action=select-volunteer-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextDate = btn.dataset.date;
        if (nextDate === this.volunteerDayDate) return;

        if (isAdmin && this.tab === "volunteer") {
          this.syncVolunteerFromDom();
        }

        this.volunteerDayDate = nextDate;
        this.volunteerEditOpen = false;
        this.render();
      });
    });

    panel
      .querySelector("[data-action=toggle-regulation-past]")
      ?.addEventListener("click", () => {
        this.regulationShowPast = !this.regulationShowPast;
        this.render();
      });

    if (!isAdmin) {
      return;
    }

    panel.querySelector("[data-action=toggle-volunteer-edit]")?.addEventListener("click", () => {
      this.syncVolunteerFromDom();
      this.volunteerEditOpen = !this.volunteerEditOpen;
      this.render();
    });

    panel.querySelector("[data-action=add-regulation]")?.addEventListener("click", () => {
      this.syncRegulationsFromDom();
      const day = this.getSelectedRegulationDay(event);
      if (!day) return;
      const eventDay =
        getEventSchedules(event).find((item) => item.date === day.date) ||
        getEventSchedules(event)[0];
      const range = this.getDayRange(event, day.date);
      day.items.push(
        this.normalizeRegulation({
          time: eventDay?.time || range.from,
          timeEnd: eventDay?.timeEnd || "",
          title: "",
        })
      );
      this.render();
    });

    panel.querySelectorAll("[data-action=remove-regulation]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest("[data-reg-id]");
        const id = row?.getAttribute("data-reg-id");
        this.syncRegulationsFromDom();
        const day = this.getSelectedRegulationDay(event);
        if (!day) return;
        day.items = day.items.filter((item) => item.id !== id);
        this.render();
      });
    });

    panel.querySelectorAll("[data-action=remove-volunteer-row]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rowId = btn.dataset.rowId;
        this.syncVolunteerFromDom();
        const day = this.getSelectedVolunteerDay(event);
        if (!day) return;
        day.rows = day.rows.filter((row) => row.id !== rowId);
        this.render();
      });
    });

    panel.querySelectorAll("[data-action=add-shift]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.syncVolunteerFromDom();
        const day = this.getSelectedVolunteerDay(event);
        const row = day?.rows.find((item) => item.id === btn.dataset.rowId);
        if (!row) return;
        const range = this.getDayRange(event, day.date);
        row.shifts.push(
          this.normalizeShift({ from: range.from, to: range.to })
        );
        this.render();
      });
    });

    panel.querySelectorAll("[data-action=remove-shift]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.syncVolunteerFromDom();
        const day = this.getSelectedVolunteerDay(event);
        const row = day?.rows.find((item) => item.id === btn.dataset.rowId);
        if (!row) return;
        row.shifts = row.shifts.filter((shift) => shift.id !== btn.dataset.shiftId);
        this.render();
      });
    });

    panel.querySelectorAll("[data-action=participant-decision]").forEach((input) => {
      input.addEventListener("change", () => {
        const enrollmentId = input.dataset.enrollmentId;
        if (!enrollmentId) return;
        this.participantDecisions.set(enrollmentId, input.value || "none");
      });
    });

    panel
      .querySelector("[data-action=apply-participant-decisions]")
      ?.addEventListener("click", async (clickEvent) => {
        const btn = clickEvent.currentTarget;
        const decisions = [...this.participantDecisions.entries()]
          .filter(([, action]) => action && action !== "none")
          .map(([enrollmentId, action]) => ({ enrollmentId, action }));

        if (!decisions.length) {
          alert("Выберите действия для заявок и затем примените изменения.");
          return;
        }

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Сохраняем...";
        try {
          const changed = await applyEnrollmentDecisions(
            decisions,
            currentUserId || null
          );
          this.participantDecisions = new Map();
          this.render();
          if (changed > 0) {
            renderCurrentView();
          }
        } catch (error) {
          alert(error.message || "Не удалось применить изменения");
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
  },

  bindScheduleExportActions(event) {
    const panel = document.getElementById("schedulePanel");
    if (!panel) return;

    panel
      .querySelector("[data-action=export-regulation-png]")
      ?.addEventListener("click", (clickEvent) => {
        this.runExportButton(clickEvent.currentTarget, () =>
          this.exportRegulationPng(event)
        );
      });

    panel
      .querySelector("[data-action=export-volunteer-png]")
      ?.addEventListener("click", (clickEvent) => {
        this.runExportButton(clickEvent.currentTarget, () =>
          this.exportVolunteerPng(event)
        );
      });
  },

  async runExportButton(btn, exportFn) {
    if (!btn || btn.disabled) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Создаём PNG…";

    try {
      await exportFn();
    } catch (error) {
      alert(error.message || "Не удалось создать PNG");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  },

  async exportRegulationPng(event) {
    if (typeof SchedulePngExport === "undefined") {
      throw new Error("Модуль экспорта расписания не загружен");
    }

    const day = this.getSelectedRegulationDay(event);
    const items = [...(day?.items || [])].sort(
      (a, b) => this.timeToMinutes(a.time) - this.timeToMinutes(b.time)
    );

    if (!items.length) {
      alert("Нет пунктов регламента для экспорта на выбранный день");
      return;
    }

    await SchedulePngExport.exportRegulation(event, day.date, items);
  },

  async exportVolunteerPng(event) {
    if (typeof SchedulePngExport === "undefined") {
      throw new Error("Модуль экспорта расписания не загружен");
    }

    const day = this.getSelectedVolunteerDay(event);
    if (!day?.rows?.length) {
      alert("Нет данных волонтерской смены для экспорта");
      return;
    }

    const range = this.getDayRange(event, day.date);
    await SchedulePngExport.exportVolunteer(event, day, range);
  },

  syncRegulationsFromDom() {
    if (!isAdmin || !this.draft || this.tab !== "regulations") return;

    const panel = document.getElementById("schedulePanel");
    const section = panel?.querySelector("[data-regulation-date]");
    if (!section) return;

    const dayDate =
      this.regulationDayDate ||
      section.getAttribute("data-regulation-date");
    const day = this.draft.regulationDays.find((item) => item.date === dayDate);
    if (!day) return;

    const items = [];
    section.querySelectorAll(".regulation-item--edit").forEach((row) => {
      items.push(
        this.normalizeRegulation({
          id: row.getAttribute("data-reg-id"),
          time: row.querySelector(".regulation-time")?.value,
          timeEnd: row.querySelector(".regulation-time-end")?.value,
          title: row.querySelector(".regulation-title")?.value,
          note: row.querySelector(".regulation-note")?.value,
        })
      );
    });

    day.items = items.filter(
      (item) => item.title || item.time || item.note
    );
  },

  syncVolunteerFromDom() {
    if (!isAdmin || !this.draft || this.tab !== "volunteer") return;

    const panel = document.getElementById("schedulePanel");
    const section = panel?.querySelector("[data-volunteer-date]");
    if (!section?.querySelector(".gantt__row--edit")) return;

    const dayDate =
      this.volunteerDayDate || section.getAttribute("data-volunteer-date");
    const day = this.draft.volunteerDays.find((item) => item.date === dayDate);
    if (!day) return;

    section.querySelectorAll(".gantt__row--edit").forEach((rowEl) => {
      const rowId = rowEl.getAttribute("data-row-id");
      const target = day.rows.find((item) => item.id === rowId);
      if (!target) return;
      target.label = rowEl.querySelector(".gantt-row-label")?.value?.trim() || "";

      const shifts = [];
      rowEl.querySelectorAll(".gantt-shift-edit").forEach((shiftEl) => {
        shifts.push(
          this.normalizeShift({
            id: shiftEl.getAttribute("data-shift-id"),
            from: shiftEl.querySelector(".shift-from")?.value,
            to: shiftEl.querySelector(".shift-to")?.value,
            note: shiftEl.querySelector(".shift-note")?.value,
          })
        );
      });
      target.shifts = shifts;
    });
  },

  syncDraftFromDom() {
    this.syncRegulationsFromDom();
    this.syncVolunteerFromDom();
  },

  /**
   * publish === true: переключить plan.published (кнопка «Опубликовать»).
   * Иначе только сохранить черновик в JsonBox через saveEvents().
   */
  async save(publish) {
    if (!isAdmin || !this.eventId || !this.draft) return;

    this.syncDraftFromDom();
    const eventRef = this.getEvent();
    if (eventRef) {
      this.ensureRegulationDays(this.draft, eventRef);
      this.ensureVolunteerDays(this.draft, eventRef);
    }
    this.draft = this.normalizePlan(this.draft);

    if (publish) {
      if (!this.draft.published && !this.hasContent(this.draft)) {
        alert(
          "Добавьте содержимое расписания перед публикацией (регламент необязателен)."
        );
        return;
      }
      this.draft.published = !this.draft.published;
    }

    try {
      events = events.map((item) =>
        String(item.id) === String(this.eventId)
          ? { ...item, plan: structuredClone(this.draft) }
          : item
      );
      await saveEvents();
      await reloadEventsFromStorage();
      const updated = this.getEvent();
      this.draft = structuredClone(updated?.plan || this.emptyPlan());
      if (updated) {
        this.ensureRegulationDays(this.draft, updated);
        this.ensureVolunteerDays(this.draft, updated);
        if (
          this.regulationDayDate &&
          !this.draft.regulationDays.some(
            (day) => day.date === this.regulationDayDate
          )
        ) {
          this.regulationDayDate = this.getDefaultRegulationDate(
            updated,
            this.draft.regulationDays
          );
        }
        if (
          this.volunteerDayDate &&
          !this.draft.volunteerDays.some(
            (day) => day.date === this.volunteerDayDate
          )
        ) {
          this.volunteerDayDate = this.getDefaultScheduleDayDate(
            updated,
            this.draft.volunteerDays
          );
        }
      }
      this.render();
      if (document.getElementById("eventsContainer")) {
        renderCurrentView();
      }

      const msg = publish
        ? this.draft.published
          ? "Расписание опубликовано"
          : "Расписание скрыто от участников"
        : "Расписание сохранено";
      alert(msg);
    } catch (error) {
      alert(error.message || "Не удалось сохранить расписание");
    }
  },

  getDayRange(event, date) {
    const eventDay = getEventSchedules(event).find((item) => item.date === date);
    if (!eventDay) {
      return { from: "08:00", to: "20:00" };
    }

    const from = eventDay.time || "08:00";
    let to = eventDay.timeEnd || "";

    if (!to) {
      to = eventDay.time ? "23:59" : "20:00";
    }

    if (this.timeToMinutes(from) >= this.timeToMinutes(to)) {
      to = this.minutesToTime(this.timeToMinutes(from) + 60);
    }

    return { from, to };
  },

  buildHourMarks(from, to) {
    const start = Math.floor(this.timeToMinutes(from) / 60);
    const end = Math.ceil(this.timeToMinutes(to) / 60);
    const marks = [];
    for (let h = start; h <= end; h += 1) {
      marks.push(`${String(h).padStart(2, "0")}:00`);
    }
    return marks.length ? marks : ["08:00", "12:00", "16:00", "20:00"];
  },

  timeToMinutes(value) {
    if (!value) return 0;
    const [h, m] = value.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  },

  minutesToTime(total) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  },
};
