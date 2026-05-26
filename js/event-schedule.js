/** Страница «Расписание»: регламент + волонтерская смена (Гант) */
const EventSchedule = {
  eventId: null,
  tab: "regulations",
  draft: null,
  volunteerEditOpen: false,
  _ready: false,

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
    const url = new URL("schedule.html", window.location.href);
    url.searchParams.set("event", eventId);
    this.appendVkParams(url);
    return url.pathname + url.search;
  },

  getIndexUrl() {
    const url = new URL("index.html", window.location.href);
    this.appendVkParams(url);
    return url.pathname + url.search;
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
        this.syncRegulationsFromDom();
        this.syncVolunteerFromDom();
        this.tab = btn.dataset.tab;
        this.render();
      });
    });
  },

  emptyPlan() {
    return {
      published: false,
      regulations: [],
      volunteerDays: [],
    };
  },

  normalizePlan(input) {
    const plan =
      input?.plan && typeof input.plan === "object"
        ? input.plan
        : input?.regulations !== undefined ||
            input?.volunteerDays !== undefined ||
            input?.published !== undefined
          ? input
          : this.emptyPlan();

    const regulations = Array.isArray(plan.regulations)
      ? plan.regulations.map((item) => this.normalizeRegulation(item))
      : [];
    const volunteerDays = Array.isArray(plan.volunteerDays)
      ? plan.volunteerDays.map((day) => this.normalizeVolunteerDay(day))
      : [];

    return {
      published: Boolean(plan.published),
      regulations: regulations.filter(
        (item) => item.title || item.time || item.note
      ),
      volunteerDays: volunteerDays.filter((day) => day.date),
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
    if (plan.regulations?.some((item) => item.title || item.time || item.note)) {
      return true;
    }
    return plan.volunteerDays?.some((day) =>
      day.rows?.some((row) => row.label || row.shifts?.length)
    );
  },

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
    this.draft = structuredClone(event.plan || this.emptyPlan());
    this.ensureVolunteerDays(this.draft, event);
    this.render();
    return true;
  },

  ensureVolunteerDays(plan, event) {
    const dates = getEventSchedules(event).map((item) => item.date);
    if (!dates.length) {
      if (!plan.volunteerDays.length) {
        plan.volunteerDays = [{ date: getTodayDateString(), rows: [] }];
      }
      return;
    }

    const byDate = new Map(plan.volunteerDays.map((day) => [day.date, day]));
    plan.volunteerDays = dates.map((date) => {
      if (byDate.has(date)) return byDate.get(date);
      return { date, rows: [] };
    });
  },

  getSelectedVolunteerDay() {
    const days = this.draft?.volunteerDays || [];
    if (!days.length) return null;
    const select = document.getElementById("volunteerDaySelect");
    const date = select?.value || days[0].date;
    return days.find((day) => day.date === date) || days[0];
  },

  render() {
    const event = this.getEvent();
    if (!event || !this.draft) return;

    document.getElementById("schedulePageTitle").textContent = event.title;
    document.getElementById("schedulePageSubtitle").textContent =
      getEventSchedules(event)
        .map((item) => formatScheduleLine(item))
        .join(" · ") || "Даты не указаны";

    document.querySelectorAll(".schedule-tab").forEach((btn) => {
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
        : this.renderVolunteerPanel(event);

    this.bindPanelActions(event);
  },

  renderRegulationsPanel(event) {
    const editable = isAdmin;
    const items = [...(this.draft.regulations || [])].sort(
      (a, b) => this.timeToMinutes(a.time) - this.timeToMinutes(b.time)
    );

    if (!items.length && !editable) {
      return `<p class="schedule-empty">Регламент пока не добавлен.</p>`;
    }

    return `
      <section class="schedule-section">
        ${
          editable
            ? `<button type="button" class="schedules-add-btn" data-action="add-regulation">+ Пункт регламента</button>`
            : ""
        }
        <ol class="regulation-list">
          ${items
            .map((item) => this.renderRegulationItem(item, editable))
            .join("")}
        </ol>
        ${
          !items.length && editable
            ? `<p class="schedule-hint">Пункты регламента необязательны. Можно указать только время, только название или оба поля.</p>`
            : ""
        }
      </section>
    `;
  },

  renderRegulationItem(item, editable) {
    const timeLabel = item.timeEnd
      ? `${item.time}–${item.timeEnd}`
      : item.time || "—";

    if (!editable) {
      return `
        <li class="regulation-item">
          <span class="regulation-item__time">${escapeHtml(timeLabel)}</span>
          <div class="regulation-item__body">
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
    const day = this.getSelectedVolunteerDay() || { date: "", rows: [] };
    const range = this.getDayRange(event, day.date);
    const hours = this.buildHourMarks(range.from, range.to);

    if (!day.rows.length && !editable) {
      return `
        ${this.renderDaySelector(days, day.date, editable)}
        <p class="schedule-empty">Волонтерская смена пока не составлена.</p>
      `;
    }

    return `
      ${this.renderDaySelector(days, day.date, editable)}
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
          ? `<button type="button" class="schedules-add-btn" data-action="add-volunteer-row">+ Участник / роль</button>`
          : ""
      }
    `;
  },

  renderDaySelector(days, selectedDate, editable) {
    if (days.length <= 1) {
      const label = selectedDate ? formatDate(selectedDate) : "День не выбран";
      return `<p class="schedule-day-label">${escapeHtml(label)}</p>`;
    }

    return `
      <label class="field-label">День мероприятия</label>
      <select id="volunteerDaySelect" class="schedule-day-select" ${editable ? "" : "disabled"}>
        ${days
          .map(
            (day) =>
              `<option value="${escapeAttr(day.date)}" ${day.date === selectedDate ? "selected" : ""}>${escapeHtml(formatDate(day.date))}</option>`
          )
          .join("")}
      </select>
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
    if (!panel || !isAdmin) {
      panel?.querySelector("#volunteerDaySelect")?.addEventListener("change", () => {
        this.render();
      });
      return;
    }

    panel.querySelector("#volunteerDaySelect")?.addEventListener("change", () => {
      this.syncRegulationsFromDom();
      this.syncVolunteerFromDom();
      this.render();
    });

    panel.querySelector("[data-action=toggle-volunteer-edit]")?.addEventListener("click", () => {
      this.syncVolunteerFromDom();
      this.volunteerEditOpen = !this.volunteerEditOpen;
      this.render();
    });

    panel.querySelector("[data-action=add-regulation]")?.addEventListener("click", () => {
      this.syncRegulationsFromDom();
      this.syncVolunteerFromDom();
      const first = getEventSchedules(event)[0];
      this.draft.regulations.push(
        this.normalizeRegulation({
          time: first?.time || "",
          timeEnd: first?.timeEnd || "",
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
        this.syncVolunteerFromDom();
        this.draft.regulations = this.draft.regulations.filter(
          (item) => item.id !== id
        );
        this.render();
      });
    });

    panel.querySelector("[data-action=add-volunteer-row]")?.addEventListener("click", () => {
      this.syncRegulationsFromDom();
      this.syncVolunteerFromDom();
      this.volunteerEditOpen = true;
      const day = this.getSelectedVolunteerDay();
      if (!day) return;
      const range = this.getDayRange(event, day.date);
      day.rows.push(
        this.normalizeVolunteerRow({
          label: "",
          shifts: [{ from: range.from, to: range.to }],
        })
      );
      this.render();
    });

    panel.querySelectorAll("[data-action=remove-volunteer-row]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rowId = btn.dataset.rowId;
        this.syncRegulationsFromDom();
        this.syncVolunteerFromDom();
        const day = this.getSelectedVolunteerDay();
        if (!day) return;
        day.rows = day.rows.filter((row) => row.id !== rowId);
        this.render();
      });
    });

    panel.querySelectorAll("[data-action=add-shift]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.syncRegulationsFromDom();
        this.syncVolunteerFromDom();
        const day = this.getSelectedVolunteerDay();
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
        this.syncRegulationsFromDom();
        this.syncVolunteerFromDom();
        const day = this.getSelectedVolunteerDay();
        const row = day?.rows.find((item) => item.id === btn.dataset.rowId);
        if (!row) return;
        row.shifts = row.shifts.filter((shift) => shift.id !== btn.dataset.shiftId);
        this.render();
      });
    });
  },

  syncRegulationsFromDom() {
    if (!isAdmin || !this.draft) return;

    const panel = document.getElementById("schedulePanel");
    if (!panel?.querySelector(".regulation-item--edit")) return;

    const regulations = [];
    panel.querySelectorAll(".regulation-item--edit").forEach((row) => {
      regulations.push(
        this.normalizeRegulation({
          id: row.getAttribute("data-reg-id"),
          time: row.querySelector(".regulation-time")?.value,
          timeEnd: row.querySelector(".regulation-time-end")?.value,
          title: row.querySelector(".regulation-title")?.value,
          note: row.querySelector(".regulation-note")?.value,
        })
      );
    });
    this.draft.regulations = regulations;
  },

  syncVolunteerFromDom() {
    if (!isAdmin || !this.draft) return;

    const panel = document.getElementById("schedulePanel");
    if (!panel?.querySelector(".gantt__row--edit")) return;

    const day = this.getSelectedVolunteerDay();
    if (!day) return;

    panel.querySelectorAll(".gantt__row--edit").forEach((rowEl) => {
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

  async save(publish) {
    if (!isAdmin || !this.eventId || !this.draft) return;

    this.syncDraftFromDom();
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
