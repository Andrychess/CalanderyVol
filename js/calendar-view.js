const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const CalendarView = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: null,

  init() {
    const root = document.getElementById("calendarView");
    if (!root || this._ready) return;
    this._ready = true;

    root.addEventListener("click", (e) => {
      if (e.target.closest("#calendarPrev")) {
        this.changeMonth(-1);
      } else if (e.target.closest("#calendarNext")) {
        this.changeMonth(1);
      } else if (e.target.closest("#calendarToday")) {
        this.goToday();
      }
    });
  },

  changeMonth(delta) {
    this.month += delta;
    if (this.month > 11) {
      this.month = 0;
      this.year += 1;
    }
    if (this.month < 0) {
      this.month = 11;
      this.year -= 1;
    }
    this.render();
  },

  goToday() {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.selectedDate = getTodayDateString();
    this.render();
  },

  buildEntriesMap(eventList) {
    const map = new Map();

    eventList.forEach((event) => {
      getEventSchedules(event).forEach((schedule) => {
        if (!schedule.date) return;
        if (!map.has(schedule.date)) {
          map.set(schedule.date, []);
        }
        map.get(schedule.date).push({ event, schedule });
      });
    });

    map.forEach((items, dateKey) => {
      items.sort(
        (a, b) => getScheduleStart(a.schedule) - getScheduleStart(b.schedule)
      );
      map.set(dateKey, items);
    });

    return map;
  },

  pickSelectedDate(map) {
    const today = getTodayDateString();

    if (this.selectedDate && map.has(this.selectedDate)) {
      return this.selectedDate;
    }

    if (this.selectedDate && !map.has(this.selectedDate)) {
      return this.selectedDate;
    }
    if (map.has(today)) return today;

    const keys = [...map.keys()].sort();
    const upcoming = keys.find((key) => key >= today);
    if (upcoming) return upcoming;

    return keys[keys.length - 1] || today;
  },

  getMonthCells(year, month) {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let startWeekday = first.getDay();
    startWeekday = startWeekday === 0 ? 6 : startWeekday - 1;

    const cells = [];
    const prevMonthDays = new Date(year, month, 0).getDate();

    for (let i = startWeekday - 1; i >= 0; i -= 1) {
      cells.push({
        dateKey: null,
        day: prevMonthDays - i,
        otherMonth: true,
      });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({ dateKey, day, otherMonth: false });
    }

    while (cells.length % 7 !== 0) {
      cells.push({
        dateKey: null,
        day: cells.length,
        otherMonth: true,
      });
    }

    return cells;
  },

  renderCellMarkers(dayEntries) {
    if (!dayEntries.length) return "";

    const levels = LevelColors.uniqueLevelsFromEntries(dayEntries);
    const visible = levels.slice(0, 3);
    const extra = levels.length - visible.length;

    return `
      <span class="calendar-cell__markers" aria-hidden="true">
        ${visible
          .map(
            (level) =>
              `<span class="calendar-marker ${LevelColors.className(level)}"></span>`
          )
          .join("")}
        ${
          extra > 0
            ? `<span class="calendar-marker calendar-marker--more">+${extra}</span>`
            : ""
        }
      </span>
    `;
  },

  renderLegend() {
    return EVENT_LEVEL_ORDER.map((level) => {
      return `
        <span class="calendar-legend__item">
          <span class="calendar-legend__dot ${LevelColors.className(level)}"></span>
          <span class="calendar-legend__label">${escapeHtml(formatLevelLabel(level))}</span>
        </span>
      `;
    }).join("");
  },

  renderDayEvents(entries, dateKey) {
    const listEl = document.getElementById("calendarDayEvents");
    if (!listEl) return;

    if (!dateKey || !entries.length) {
      listEl.innerHTML = `
        <p class="calendar-day-events__empty">На выбранный день мероприятий нет.</p>
      `;
      return;
    }

    listEl.innerHTML = `
      <h3 class="calendar-day-events__title">${escapeHtml(formatDate(dateKey))}</h3>
      <div class="calendar-day-events__list">
        ${entries
          .map(({ event, schedule }) => {
            const past = isSchedulePast(schedule);
            const time = schedule.time
              ? schedule.timeEnd
                ? `${schedule.time}–${schedule.timeEnd}`
                : schedule.time
              : "";
            return `
              <button type="button" class="calendar-event-chip ${LevelColors.className(event.level)} ${past ? "calendar-event-chip--past" : ""}" data-event-id="${escapeAttr(event.id)}">
                <span class="calendar-event-chip__dot ${LevelColors.className(event.level)}"></span>
                <span class="calendar-event-chip__body">
                  <span class="calendar-event-chip__time">${escapeHtml(time || "весь день")}</span>
                  <span class="calendar-event-chip__title">${escapeHtml(event.title)}</span>
                  <span class="calendar-event-chip__level">${escapeHtml(formatLevelLabel(event.level))}</span>
                </span>
              </button>
            `;
          })
          .join("")}
      </div>
    `;

    listEl.querySelectorAll("[data-event-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openEventViewModal(btn.getAttribute("data-event-id"));
      });
    });
  },

  render() {
    const root = document.getElementById("calendarContainer");
    if (!root) return;

    const filtered = getFilteredEvents();

    if (!filtered.length) {
      root.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📅</div>
          <h2>Нет мероприятий для календаря</h2>
          <p>Измените фильтры или добавьте мероприятия со датами.</p>
        </div>
      `;
      return;
    }

    const entriesMap = this.buildEntriesMap(filtered);
    this.selectedDate = this.pickSelectedDate(entriesMap);

    const cells = this.getMonthCells(this.year, this.month);
    const today = getTodayDateString();

    root.innerHTML = `
      <article class="calendar-glass" aria-label="Календарь мероприятий">
        <header class="calendar-glass__year">${this.year}</header>

        <div class="calendar-glass__month">
          <button type="button" class="calendar-glass__arrow" id="calendarPrev" aria-label="Предыдущий месяц">‹</button>
          <div class="calendar-glass__month-label">
            <span class="calendar-glass__month-name">${MONTH_NAMES[this.month]}</span>
            <button type="button" class="calendar-glass__today" id="calendarToday">Сегодня</button>
          </div>
          <button type="button" class="calendar-glass__arrow" id="calendarNext" aria-label="Следующий месяц">›</button>
        </div>

        <div class="calendar-glass__body">
          <div class="calendar-weekdays">
            ${WEEKDAY_NAMES.map((name) => `<span>${name}</span>`).join("")}
          </div>
          <div class="calendar-grid">
            ${cells
              .map((cell) => {
                if (!cell.dateKey) {
                  return `<div class="calendar-cell calendar-cell--muted"><span class="calendar-cell__day">${cell.day}</span></div>`;
                }

                const dayEntries = entriesMap.get(cell.dateKey) || [];
                const isToday = cell.dateKey === today;
                const isSelected = cell.dateKey === this.selectedDate;
                const past =
                  dayEntries.length > 0 &&
                  dayEntries.every(({ schedule }) =>
                    isSchedulePast(schedule)
                  );
                const primaryLevel =
                  dayEntries.length === 1
                    ? dayEntries[0].event.level
                    : null;

                return `
                  <button type="button"
                    class="calendar-cell ${isToday ? "calendar-cell--today" : ""} ${isSelected ? "calendar-cell--selected" : ""} ${past ? "calendar-cell--past" : ""} ${dayEntries.length ? "calendar-cell--has-events" : ""} ${primaryLevel ? LevelColors.className(primaryLevel) : ""}"
                    data-date="${escapeAttr(cell.dateKey)}">
                    <span class="calendar-cell__day">${cell.day}</span>
                    ${this.renderCellMarkers(dayEntries)}
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>

        <footer class="calendar-glass__legend">
          <span class="calendar-legend__item calendar-legend__item--today">
            <span class="calendar-legend__ring"></span>
            <span class="calendar-legend__label">Сегодня</span>
          </span>
          ${this.renderLegend()}
        </footer>

        <div id="calendarDayEvents" class="calendar-glass__day-list"></div>
      </article>
    `;

    root.querySelectorAll(".calendar-cell[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        this.selectedDate = cell.getAttribute("data-date");
        this.render();
      });
    });

    this.renderDayEvents(
      entriesMap.get(this.selectedDate) || [],
      this.selectedDate
    );
  },
};
