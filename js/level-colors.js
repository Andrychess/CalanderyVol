/** Градация цветов по уровню мероприятия (палитра бренда) */
const EVENT_LEVEL_ORDER = [
  "вузовский",
  "городской",
  "региональный",
  "межрегиональный",
  "всероссийский",
  "международный",
];

const LevelColors = {
  order: EVENT_LEVEL_ORDER,

  palette: {
    вузовский: {
      slug: "vuz",
      color: "#bbe7f4",
      accent: "#7ec8e8",
      text: "#1a4f7a",
      glow: "rgba(187, 231, 244, 0.75)",
    },
    городской: {
      slug: "gorod",
      color: "#8ecae6",
      accent: "#5ba3d9",
      text: "#1e5596",
      glow: "rgba(91, 163, 217, 0.65)",
    },
    региональный: {
      slug: "regional",
      color: "#2669b8",
      accent: "#2669b8",
      text: "#ffffff",
      glow: "rgba(38, 105, 184, 0.55)",
    },
    межрегиональный: {
      slug: "mezhreg",
      color: "#1e5596",
      accent: "#1a4f8f",
      text: "#ffffff",
      glow: "rgba(30, 85, 150, 0.6)",
    },
    всероссийский: {
      slug: "vs",
      color: "#71c17a",
      accent: "#5aa862",
      text: "#1f4d28",
      glow: "rgba(113, 193, 122, 0.65)",
    },
    международный: {
      slug: "intl",
      color: "#4a9e7a",
      accent: "#3d8f6e",
      text: "#ffffff",
      glow: "rgba(74, 158, 122, 0.6)",
    },
  },

  get(level) {
    return this.palette[level] || this.palette["региональный"];
  },

  className(level) {
    return `level-${this.get(level).slug}`;
  },

  sortLevels(levels) {
    return [...levels].sort(
      (a, b) => this.order.indexOf(a) - this.order.indexOf(b)
    );
  },

  uniqueLevelsFromEntries(dayEntries) {
    const levels = [
      ...new Set(dayEntries.map(({ event }) => event.level).filter(Boolean)),
    ];
    return this.sortLevels(levels);
  },
};
