/** Вертикальный формат для сторис / клипов VK (9:16) */
const PNG_EXPORT_WIDTH = 1080;
const PNG_EXPORT_HEIGHT = 1920;

const PngExport = {
  _modalUrl: null,

  sanitizeFilename(title) {
    const safe = String(title || "meropriyatie")
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\s+/g, "_")
      .trim()
      .slice(0, 48);
    return safe || "meropriyatie";
  },

  isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  },

  ensureSaveModal() {
    let modal = document.getElementById("pngSaveModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "pngSaveModal";
    modal.className = "modal png-save-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="modal-content png-save-modal__content">
        <button type="button" class="close png-save-modal__close" data-close aria-label="Закрыть">&times;</button>
        <h2 class="png-save-modal__title">Сохранить PNG</h2>
        <p class="png-save-modal__hint">На телефоне: нажмите и удерживайте изображение → «Сохранить».<br>Или воспользуйтесь кнопкой «Скачать».</p>
        <div class="png-save-modal__preview-wrap">
          <img id="pngSavePreview" class="png-save-modal__preview" alt="PNG для сохранения">
        </div>
        <a id="pngSaveDownloadLink" class="submit-btn png-save-modal__download" download>Скачать PNG</a>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (
        event.target === modal ||
        event.target.closest("[data-close]") ||
        event.target.classList.contains("png-save-modal__close")
      ) {
        PngExport.hideSaveModal();
      }
    });

    return modal;
  },

  showSaveModal(blobUrl, filename) {
    const modal = this.ensureSaveModal();
    const img = modal.querySelector("#pngSavePreview");
    const link = modal.querySelector("#pngSaveDownloadLink");

    if (this._modalUrl && this._modalUrl !== blobUrl) {
      URL.revokeObjectURL(this._modalUrl);
    }

    img.src = blobUrl;
    link.href = blobUrl;
    link.download = filename;
    link.setAttribute("download", filename);

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    this._modalUrl = blobUrl;
  },

  hideSaveModal() {
    const modal = document.getElementById("pngSaveModal");
    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");

    if (
      !document.getElementById("eventModal")?.classList.contains("open") &&
      !document.getElementById("eventViewModal")?.classList.contains("open")
    ) {
      document.body.style.overflow = "";
    }

    const img = modal.querySelector("#pngSavePreview");
    if (img) img.removeAttribute("src");

    if (this._modalUrl) {
      setTimeout(() => {
        URL.revokeObjectURL(this._modalUrl);
        this._modalUrl = null;
      }, 300);
    }
  },

  async saveBlob(blob, filename) {
    const file = new File([blob], filename, { type: "image/png" });

    if (typeof navigator.share === "function") {
      try {
        const canShareFiles =
          !navigator.canShare || navigator.canShare({ files: [file] });
        if (canShareFiles) {
          await navigator.share({
            files: [file],
            title: filename.replace(/\.png$/i, ""),
          });
          return;
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.setAttribute("download", filename);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();

    if (this.isMobileDevice()) {
      this.showSaveModal(url, filename);
      return;
    }

    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  async captureElement(frame, width = PNG_EXPORT_WIDTH, height = PNG_EXPORT_HEIGHT) {
    if (typeof html2canvas === "undefined") {
      throw new Error("Библиотека html2canvas не загружена");
    }

    frame.classList.add("png-export-story--capture");
    document.body.appendChild(frame);

    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const captureHeight = Math.min(
        4000,
        Math.max(
          height,
          frame.scrollHeight || frame.offsetHeight || height
        )
      );

      const canvas = await html2canvas(frame, {
        backgroundColor: "#ffffff",
        width,
        height: captureHeight,
        scale: 1,
        logging: false,
        useCORS: true,
        allowTaint: true,
        scrollX: 0,
        scrollY: 0,
        windowWidth: width,
        windowHeight: captureHeight,
      });

      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("Не удалось создать PNG"));
          },
          "image/png",
          1
        );
      });
    } finally {
      frame.remove();
    }
  },
};

const CardPngExport = {
  sanitizeFilename(title) {
    return PngExport.sanitizeFilename(title);
  },

  async exportCard(event) {
    if (typeof buildEventExportStoryElement !== "function") {
      throw new Error("Модуль экспорта не загружен");
    }
    if (!event) {
      throw new Error("Мероприятие не найдено");
    }

    const frame = buildEventExportStoryElement(event);
    const blob = await PngExport.captureElement(frame);
    const filename = `${PngExport.sanitizeFilename(event.title)}.png`;
    await PngExport.saveBlob(blob, filename);
  },
};
