/**
 * PNG регламента и волонтёрской смены на выбранный день.
 * Лимиты строк — чтобы влезло в кадр 1080×1920 без микрошрифта.
 */
const SCHEDULE_EXPORT_REG_LIMIT = 14;
const SCHEDULE_EXPORT_VOL_ROWS_LIMIT = 10;

const SchedulePngExport = {
  formatRegulationTime(item) {
    if (item.timeEnd) return `${item.time}–${item.timeEnd}`;
    return item.time || "—";
  },

  buildRegulationFrame(event, dayDate, items) {
    const visible = items.slice(0, SCHEDULE_EXPORT_REG_LIMIT);
    const rest = items.length - visible.length;
    const dayLabel = dayDate ? formatDate(dayDate) : "День не указан";

    const root = document.createElement("div");
    root.className = "png-export-story png-export-schedule";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <header class="png-export-story__header">
        <p class="png-export-story__eyebrow">Регламент мероприятия</p>
        <h1 class="png-export-story__title">${escapeHtml(event.title)}</h1>
        <p class="png-export-story__schedule">${escapeHtml(dayLabel)}</p>
        <p class="png-export-story__location">📍 ${escapeHtml(event.location || DEFAULT_LOCATION)}</p>
      </header>
      <main class="png-export-story__main">
        <section class="png-export-schedule__section">
          <h2 class="png-export-schedule__section-title">Программа дня</h2>
          <ol class="png-export-schedule__reg-list">
            ${visible
              .map(
                (item) => `
              <li class="png-export-schedule__reg-item">
                <span class="png-export-schedule__reg-time">${escapeHtml(this.formatRegulationTime(item))}</span>
                <div class="png-export-schedule__reg-body">
                  <strong>${escapeHtml(item.title || "Без названия")}</strong>
                  ${
                    item.note
                      ? `<p class="png-export-schedule__reg-note">${escapeHtml(item.note)}</p>`
                      : ""
                  }
                </div>
              </li>
            `
              )
              .join("")}
          </ol>
          ${
            rest > 0
              ? `<p class="png-export-schedule__more">и ещё ${rest} ${rest === 1 ? "пункт" : rest < 5 ? "пункта" : "пунктов"}</p>`
              : ""
          }
        </section>
      </main>
      <footer class="png-export-story__footer">Календарь волонтёров</footer>
    `;

    return root;
  },

  buildVolunteerGanttRow(row, range) {
    const total =
      EventSchedule.timeToMinutes(range.to) -
      EventSchedule.timeToMinutes(range.from);
    const safeTotal = total > 0 ? total : 1;

    const bars = (row.shifts || [])
      .map((shift) => {
        const left =
          ((EventSchedule.timeToMinutes(shift.from) -
            EventSchedule.timeToMinutes(range.from)) /
            safeTotal) *
          100;
        const width =
          ((EventSchedule.timeToMinutes(shift.to) -
            EventSchedule.timeToMinutes(shift.from)) /
            safeTotal) *
          100;
        const label = `${shift.from}–${shift.to}`;
        const note = shift.note ? ` · ${shift.note}` : "";
        return `<span class="png-export-schedule__bar" style="left:${Math.max(0, left)}%;width:${Math.max(3, width)}%">${escapeHtml(label)}${escapeHtml(note)}</span>`;
      })
      .join("");

    const shiftList = (row.shifts || [])
      .map((shift) => {
        const note = shift.note ? ` · ${shift.note}` : "";
        return `<li>${escapeHtml(shift.from)}–${escapeHtml(shift.to)}${escapeHtml(note)}</li>`;
      })
      .join("");

    return `
      <div class="png-export-schedule__gantt-row">
        <div class="png-export-schedule__gantt-label">${escapeHtml(row.label || "—")}</div>
        <div class="png-export-schedule__gantt-track">${bars}</div>
        ${
          shiftList
            ? `<ul class="png-export-schedule__shift-list">${shiftList}</ul>`
            : ""
        }
      </div>
    `;
  },

  buildVolunteerFrame(event, day, range) {
    const rows = (day.rows || []).slice(0, SCHEDULE_EXPORT_VOL_ROWS_LIMIT);
    const rest = (day.rows || []).length - rows.length;
    const dayLabel = day.date ? formatDate(day.date) : "День не указан";
    const hours = EventSchedule.buildHourMarks(range.from, range.to);
    const scale = hours
      .map((hour) => `<span>${escapeHtml(hour)}</span>`)
      .join("");

    const root = document.createElement("div");
    root.className = "png-export-story png-export-schedule";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <header class="png-export-story__header">
        <p class="png-export-story__eyebrow">Волонтерская смена</p>
        <h1 class="png-export-story__title">${escapeHtml(event.title)}</h1>
        <p class="png-export-story__schedule">${escapeHtml(dayLabel)} · ${escapeHtml(range.from)}–${escapeHtml(range.to)}</p>
        <p class="png-export-story__location">📍 ${escapeHtml(event.location || DEFAULT_LOCATION)}</p>
      </header>
      <main class="png-export-story__main">
        <section class="png-export-schedule__section">
          <h2 class="png-export-schedule__section-title">Расписание смен</h2>
          <div class="png-export-schedule__gantt">
            <div class="png-export-schedule__gantt-head">
              <span class="png-export-schedule__gantt-head-label">Участник</span>
              <div class="png-export-schedule__gantt-scale">${scale}</div>
            </div>
            ${rows.map((row) => this.buildVolunteerGanttRow(row, range)).join("")}
          </div>
          ${
            rest > 0
              ? `<p class="png-export-schedule__more">и ещё ${rest} ${rest === 1 ? "участник" : rest < 5 ? "участника" : "участников"}</p>`
              : ""
          }
        </section>
      </main>
      <footer class="png-export-story__footer">Календарь волонтёров</footer>
    `;

    return root;
  },

  async exportRegulation(event, dayDate, items) {
    if (!event || !items?.length) {
      throw new Error("Нет пунктов регламента для экспорта");
    }

    const frame = this.buildRegulationFrame(event, dayDate, items);
    const blob = await PngExport.captureElement(frame);
    const datePart = dayDate
      ? PngExport.sanitizeFilename(formatDate(dayDate))
      : "den";
    const filename = `${PngExport.sanitizeFilename(event.title)}_reglament_${datePart}.png`;
    await PngExport.saveBlob(blob, filename);
  },

  async exportVolunteer(event, day, range) {
    if (!event || !day?.rows?.length) {
      throw new Error("Нет данных волонтерской смены для экспорта");
    }

    const frame = this.buildVolunteerFrame(event, day, range);
    const blob = await PngExport.captureElement(frame);
    const datePart = day.date
      ? PngExport.sanitizeFilename(formatDate(day.date))
      : "den";
    const filename = `${PngExport.sanitizeFilename(event.title)}_smena_${datePart}.png`;
    await PngExport.saveBlob(blob, filename);
  },
};
