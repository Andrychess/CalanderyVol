/**
 * Ненавязчивые уведомления вместо alert() для информационных сообщений.
 */
const AppToast = {
  _timer: null,

  init() {
    if (document.getElementById("appToast")) return;
    const el = document.createElement("div");
    el.id = "appToast";
    el.className = "app-toast hidden";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  },

  show(message, type = "info", durationMs = 4200) {
    this.init();
    const el = document.getElementById("appToast");
    if (!el) return;

    el.textContent = message;
    el.className = `app-toast app-toast--${type}`;
    el.classList.remove("hidden");

    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      el.classList.add("hidden");
    }, durationMs);
  },

  success(message, durationMs) {
    this.show(message, "success", durationMs);
  },

  error(message, durationMs) {
    this.show(message, "error", durationMs ?? 5200);
  },

  info(message, durationMs) {
    this.show(message, "info", durationMs);
  },
};

function notifySuccess(message) {
  AppToast.success(message);
}

function notifyError(message) {
  AppToast.error(message);
}

function notifyInfo(message) {
  AppToast.info(message);
}
