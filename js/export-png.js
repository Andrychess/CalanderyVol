/**
 * Снимок DOM → PNG (html2canvas). На мобильном/VK: ShowImages → share → модалка,
 * т.к. programmatic download в webview часто недоступен.
 */
const PNG_EXPORT_WIDTH = 1080;
const PNG_EXPORT_HEIGHT = 1920;

const PngExport = {
  _modalUrl: null,
  _saveBlob: null,
  _saveFilename: "",

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

  isVkMiniApp() {
    return Boolean(
      typeof VkAuth !== "undefined" &&
        VkAuth.isVkEnvironment &&
        VkAuth.isVkEnvironment &&
        VkAuth.bridge
    );
  },

  /** В VK и на телефоне не полагаемся на <a download> */
  needsMobileSaveFlow() {
    return this.isMobileDevice() || this.isVkMiniApp();
  },

  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Не удалось подготовить изображение"));
      reader.readAsDataURL(blob);
    });
  },

  async tryNativeShare(blob, filename) {
    if (typeof navigator.share !== "function") return false;

    const file = new File([blob], filename, { type: "image/png" });

    try {
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        return false;
      }

      await navigator.share({
        files: [file],
        title: filename.replace(/\.png$/i, ""),
      });
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return true;
      return false;
    }
  },

  async tryVkShowImage(dataUrl) {
    if (!this.isVkMiniApp() || !dataUrl) return false;

    try {
      await VkAuth.bridge.send("VKWebAppShowImages", {
        images: [dataUrl],
      });
      return true;
    } catch (error) {
      console.warn("VKWebAppShowImages:", error);
      return false;
    }
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
        <p class="png-save-modal__hint">Нажмите и удерживайте изображение ниже, затем выберите «Сохранить» или «Загрузить».</p>
        <div class="png-save-modal__preview-wrap">
          <img id="pngSavePreview" class="png-save-modal__preview" alt="PNG для сохранения">
        </div>
        <div class="png-save-modal__actions">
          <button type="button" class="submit-btn" id="pngSaveVkBtn">Открыть в VK</button>
          <button type="button" class="secondary-btn" id="pngSaveShareBtn">Поделиться</button>
        </div>
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

    modal.querySelector("#pngSaveShareBtn")?.addEventListener("click", async () => {
      if (!PngExport._saveBlob) return;
      const shared = await PngExport.tryNativeShare(
        PngExport._saveBlob,
        PngExport._saveFilename
      );
      if (!shared) {
        alert("Поделиться не удалось. Удерживайте изображение для сохранения.");
      }
    });

    modal.querySelector("#pngSaveVkBtn")?.addEventListener("click", async () => {
      const img = modal.querySelector("#pngSavePreview");
      const dataUrl = img?.src || "";
      if (!dataUrl) return;
      const ok = await PngExport.tryVkShowImage(dataUrl);
      if (!ok) {
        alert("Не удалось открыть просмотр в VK. Удерживайте изображение для сохранения.");
      }
    });

    return modal;
  },

  showSaveModal(previewUrl, filename, blob) {
    const modal = this.ensureSaveModal();
    const img = modal.querySelector("#pngSavePreview");
    const vkBtn = modal.querySelector("#pngSaveVkBtn");
    const shareBtn = modal.querySelector("#pngSaveShareBtn");

    if (this._modalUrl && this._modalUrl.startsWith("blob:")) {
      URL.revokeObjectURL(this._modalUrl);
    }

    this._modalUrl = previewUrl;
    this._saveBlob = blob;
    this._saveFilename = filename;

    if (img) {
      img.src = previewUrl;
    }

    vkBtn?.classList.toggle("hidden", !this.isVkMiniApp());
    shareBtn?.classList.toggle(
      "hidden",
      typeof navigator.share !== "function"
    );

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
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

    if (this._modalUrl && this._modalUrl.startsWith("blob:")) {
      URL.revokeObjectURL(this._modalUrl);
    }

    this._modalUrl = null;
    this._saveBlob = null;
    this._saveFilename = "";
  },

  async saveBlob(blob, filename) {
    if (this.needsMobileSaveFlow()) {
      const dataUrl = await this.blobToDataUrl(blob);

      if (await this.tryVkShowImage(dataUrl)) {
        return;
      }

      if (await this.tryNativeShare(blob, filename)) {
        return;
      }

      this.showSaveModal(dataUrl, filename, blob);
      return;
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
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  async captureElement(frame, width = PNG_EXPORT_WIDTH, height = PNG_EXPORT_HEIGHT) {
    if (typeof html2canvas === "undefined") {
      throw new Error("Библиотека html2canvas не загружена");
    }

    const isMobile = this.needsMobileSaveFlow();
    const scale = isMobile ? 0.75 : 1; // меньше scale — меньше риск OOM на телефоне

    frame.classList.add("png-export-story--capture");
    document.body.appendChild(frame);

    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const captureHeight = Math.min(
        isMobile ? 2800 : 4000,
        Math.max(height, frame.scrollHeight || frame.offsetHeight || height)
      );

      const canvas = await html2canvas(frame, {
        backgroundColor: "#ffffff",
        width,
        height: captureHeight,
        scale,
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

/** Экспорт карточки мероприятия (buildEventExportStoryElement в script.js) */
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
