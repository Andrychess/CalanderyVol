/** Вертикальный формат для сторис / клипов VK (9:16) */
const PNG_EXPORT_WIDTH = 1080;
const PNG_EXPORT_HEIGHT = 1920;

const CardPngExport = {
  sanitizeFilename(title) {
    const safe = String(title || "meropriyatie")
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\s+/g, "_")
      .trim()
      .slice(0, 48);
    return safe || "meropriyatie";
  },

  async exportCard(event) {
    if (typeof html2canvas === "undefined") {
      throw new Error("Библиотека html2canvas не загружена");
    }
    if (typeof buildEventExportStoryElement !== "function") {
      throw new Error("Модуль экспорта не загружен");
    }
    if (!event) {
      throw new Error("Мероприятие не найдено");
    }

    const frame = buildEventExportStoryElement(event);
    frame.classList.add("png-export-story--capture");
    document.body.appendChild(frame);

    try {
      const canvas = await html2canvas(frame, {
        backgroundColor: "#ffffff",
        width: PNG_EXPORT_WIDTH,
        height: PNG_EXPORT_HEIGHT,
        scale: 1,
        logging: false,
        useCORS: true,
      });

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("Не удалось создать PNG"));
          },
          "image/png",
          1
        );
      });

      const filename = `${this.sanitizeFilename(event.title)}.png`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      frame.remove();
    }
  },
};
