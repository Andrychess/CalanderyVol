/**
 * Черновик формы мероприятия в localStorage (только новая карточка).
 */
const EventFormDraft = {
  STORAGE_KEY: "cal_event_form_draft_v1",

  read() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  write(payload) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota */
    }
  },

  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  collectFromDom() {
    const schedules = typeof readSchedulesFromForm === "function"
      ? readSchedulesFromForm()
      : [];
    return {
      title: document.getElementById("eventTitle")?.value || "",
      schedules,
      location: document.getElementById("eventLocation")?.value || "",
      level: document.getElementById("eventLevel")?.value || "региональный",
      enrollment: document.getElementById("eventEnrollment")?.value || "open",
      functionality: document.getElementById("eventFunctionality")?.value || "",
      conditions: document.getElementById("eventConditions")?.value || "",
      description: document.getElementById("eventDescription")?.value || "",
      buttonLabel: document.getElementById("eventButtonLabel")?.value || "",
      buttonUrl: document.getElementById("eventButtonUrl")?.value || "",
      savedAt: new Date().toISOString(),
    };
  },

  applyToDom(draft) {
    if (!draft) return;
    document.getElementById("eventTitle").value = draft.title || "";
    if (typeof renderScheduleForm === "function") {
      renderScheduleForm(
        draft.schedules?.length
          ? draft.schedules
          : [{ date: getTodayDateString(), time: "", timeEnd: "" }]
      );
    }
    document.getElementById("eventLocation").value = draft.location || "";
    document.getElementById("eventLevel").value = draft.level || "региональный";
    document.getElementById("eventEnrollment").value = draft.enrollment || "open";
    document.getElementById("eventFunctionality").value = draft.functionality || "";
    document.getElementById("eventConditions").value = draft.conditions || "";
    document.getElementById("eventDescription").value = draft.description || "";
    document.getElementById("eventButtonLabel").value = draft.buttonLabel || "";
    document.getElementById("eventButtonUrl").value = draft.buttonUrl || "";
  },
};
