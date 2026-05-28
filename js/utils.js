/**
 * Общие утилиты для безопасной вставки HTML и работы с DOM.
 * Подключается до calendar-view, event-schedule и script.js.
 */

/** Экранирование текста внутри HTML-элементов */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Экранирование значений атрибутов (href, data-*, value) */
function escapeAttr(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * Поле «Функционал» / «Условия»: в JsonBox может быть строка с переносами
 * или массив — приводим к списку непустых строк.
 */
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

function findEventById(list, id) {
  return list.find((item) => String(item.id) === String(id));
}

/** Краткая подпись кнопки после успешного действия */
function flashButtonLabel(button, label, durationMs = 1600) {
  const previous = button.textContent;
  button.textContent = label;
  setTimeout(() => {
    button.textContent = previous;
  }, durationMs);
}
