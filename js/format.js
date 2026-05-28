/**
 * Локализованное отображение дат и подписей (ru-RU).
 * formatDate использует полдень по UTC-смещению локали, чтобы не «прыгала» дата.
 */

function formatLevelLabel(level) {
  if (!level) return "";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function formatEnrollmentLabel(enrollment) {
  return enrollment === "closed" ? "Набор закрыт" : "Набор открыт";
}

function formatDate(dateString) {
  if (!dateString) return "";
  // T12:00:00 — стабильный календарный день при любом часовом поясе браузера
  const date = new Date(`${dateString}T12:00:00`);
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
