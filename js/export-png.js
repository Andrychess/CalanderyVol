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
      const canvas = await html2canvas(card, {
        backgroundColor: "#ffffff",
        scale: 2,
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

      const filename = `${this.sanitizeFilename(title)}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return;
        } catch (shareError) {
          if (shareError?.name === "AbortError") return;
        }
      }

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
