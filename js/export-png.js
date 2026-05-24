/** Квадрат для постов/сторис VK (1:1) */
const PNG_EXPORT_SIZE = 1080;

const CardPngExport = {
  sanitizeFilename(title) {
    const safe = String(title || "meropriyatie")
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\s+/g, "_")
      .trim()
      .slice(0, 48);
    return safe || "meropriyatie";
  },

  hideForExport(card) {
    const hidden = [];
    card.querySelectorAll(".no-export").forEach((el) => {
      hidden.push({ el, display: el.style.display });
      el.style.display = "none";
    });
    return hidden;
  },

  restoreAfterExport(hidden) {
    hidden.forEach(({ el, display }) => {
      el.style.display = display;
    });
  },

  /** Рендер карточки в квадратное PNG 1:1 с полями по краям */
  toSquareCanvas(sourceCanvas) {
    const square = document.createElement("canvas");
    square.width = PNG_EXPORT_SIZE;
    square.height = PNG_EXPORT_SIZE;
    const ctx = square.getContext("2d");
    if (!ctx) {
      throw new Error("Не удалось подготовить изображение");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PNG_EXPORT_SIZE, PNG_EXPORT_SIZE);

    const scale = Math.min(
      PNG_EXPORT_SIZE / sourceCanvas.width,
      PNG_EXPORT_SIZE / sourceCanvas.height
    );
    const width = sourceCanvas.width * scale;
    const height = sourceCanvas.height * scale;
    const x = (PNG_EXPORT_SIZE - width) / 2;
    const y = (PNG_EXPORT_SIZE - height) / 2;
    ctx.drawImage(sourceCanvas, x, y, width, height);

    return square;
  },

  async exportCard(eventId, title) {
    if (typeof html2canvas === "undefined") {
      throw new Error("Библиотека html2canvas не загружена");
    }

    const card = document.querySelector(
      `.event-card[data-id="${CSS.escape(String(eventId))}"]`
    );
    if (!card) {
      throw new Error("Карточка не найдена");
    }

    const hidden = this.hideForExport(card);

    try {
      const sourceCanvas = await html2canvas(card, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
        useCORS: true,
      });

      const canvas = this.toSquareCanvas(sourceCanvas);

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

      const filename = `${this.sanitizeFilename(title)}.png`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      this.restoreAfterExport(hidden);
    }
  },
};
