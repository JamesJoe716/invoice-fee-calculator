// Decode locally before OCR so clipboard images and phone screenshots use the same path.
async function prepareImage(file) {
  if (file.type === "image/svg+xml") throw new Error("Use a raster screenshot");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const { naturalWidth: width, naturalHeight: height } = image;
    const scale = Math.min(1, 8192 / Math.max(width, height), Math.sqrt(8000000 / (width * height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readBillingImage(file, active, onProgress) {
  const canvas = await prepareImage(file);
  let worker;
  try {
    if (!active()) return "";
    const { default: Tesseract } = await import("./ocr-v7/tesseract.esm.min.js");
    const assets = new URL("./ocr-v7/", import.meta.url);
    if (!active()) return "";
    // Language downloads can fail before createWorker resolves; its error callback reports that stage.
    worker = await new Promise((resolve, reject) => {
      Tesseract.createWorker("chi_sim+eng", Tesseract.OEM.LSTM_ONLY, {
        workerPath: new URL("worker.min.js", assets).href,
        corePath: assets.href,
        langPath: new URL("models/", assets).href,
        cachePath: "invoice-ocr-v7-fast",
        workerBlobURL: false,
        errorHandler: reject,
        logger(event) {
          if (event.status === "recognizing text") onProgress(Math.round(event.progress * 100));
        }
      }).then(resolve, reject);
    });
    if (!active()) return "";
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    const result = await worker.recognize(canvas);
    return result.data.text;
  } finally {
    canvas.width = canvas.height = 1;
    if (worker) await worker.terminate();
  }
}
