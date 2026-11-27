import { parseBillingText } from "./billing-text.js?v=2";

function valuesForMethod(fields, method) {
  const { orderAmount, invoiceAmount, ...values } = fields;
  if (invoiceAmount && (method === "specified" || !orderAmount)) {
    values.amount = invoiceAmount;
    values.method = "specified";
  } else if (orderAmount) {
    values.amount = orderAmount;
    if (method === "specified") values.method = "order";
  }
  return values;
}

export function enableBillingImport({ calculator, billingForm, formatAmount, render }) {
  const find = id => document.getElementById(id);
  const source = find("billing-source");
  const status = find("import-status");
  const clear = find("clear-billing-source");
  const fileInput = find("billing-image");
  const targets = {
    name: find("billing-name"), tax: find("billing-tax"), item: find("billing-item"),
    quantity: find("billing-quantity"), note: find("billing-note"), amount: find("amount"),
    method: calculator.elements.method,
    seal: calculator.querySelector('[value="明细盖章"]'),
    special: calculator.querySelector('[value="专票"]')
  };
  const names = { name: "名称", tax: "税号", item: "品名", quantity: "数量", note: "备注", seal: "明细盖章", special: "专票" };
  const imported = new Map();
  let buyer = {};
  let version = 0;
  let timer;
  let imageQueue = Promise.resolve();

  function read(key) {
    const field = targets[key];
    if (field.type === "checkbox") return field.checked ? "是" : "否";
    return field.value;
  }

  function write(key, value) {
    const field = targets[key];
    if (field.type === "checkbox") field.checked = value === "是";
    else field.value = value;
    field.removeAttribute?.("aria-invalid");
  }

  function forgetManualEdit(event) {
    for (const [key, field] of Object.entries(targets)) {
      if (field === event.target || (key === "method" && event.target.name === "method")) imported.delete(key);
    }
  }
  calculator.addEventListener("input", forgetManualEdit);
  billingForm.addEventListener("input", forgetManualEdit);

  function apply(text, beforeImage) {
    const { fields, message } = parseBillingText(text, formatAmount, Boolean(beforeImage));
    if (!Object.keys(fields).length) {
      status.textContent = message || "未识别到开票资料，可以给名称、税号或金额加上标签再试。";
      return;
    }
    // Protect edits made while the image worker was running.
    const changed = new Set(Object.keys(targets).filter(key => beforeImage && read(key) !== beforeImage[key]));
    if (changed.has("amount") || changed.has("method")) {
      changed.add("amount");
      changed.add("method");
    }
    if (changed.has("name") || changed.has("tax")) {
      status.textContent = "识别期间抬头或税号已被修改。已保留你的填写，可以重新粘贴。";
      return;
    }

    const newBuyer = ["name", "tax"].some(key => fields[key] && buyer[key] && fields[key] !== buyer[key]);
    if (newBuyer) {
      // A new buyer must not inherit the previous buyer's imported amount, note or tax ID.
      for (const [key, original] of imported) {
        if (!changed.has(key)) write(key, original);
      }
      imported.clear();
      buyer = {};
    }
    const values = valuesForMethod(fields, read("method"));
    const filled = [];
    for (const [key, value] of Object.entries(values)) {
      if (changed.has(key)) continue;
      if (!imported.has(key) && read(key) !== value) imported.set(key, read(key));
      write(key, value);
      if (names[key]) filled.push(names[key]);
    }
    if (fields.name) buyer.name = fields.name;
    if (fields.tax) buyer.tax = fields.tax;
    render();
    if (values.amount && !changed.has("amount")) {
      const kind = read("method") === "specified" ? "指定开票金额" : "订单金额";
      filled.push(kind + "（" + values.amount + " 元）");
    }
    const summary = filled.length ? "已填入" + filled.join("、") + "。" : "";
    const review = beforeImage ? "请核对截图识别结果。" : "";
    status.textContent = summary + message + (changed.size ? "已保留识别期间的手动修改。" : "") + review;
  }

  function invalidate() {
    clearTimeout(timer);
    return ++version;
  }

  function useText(text) {
    invalidate();
    source.value = text;
    clear.hidden = !text;
    if (text.trim()) apply(text);
    else status.textContent = "文字和截图都在你的设备上识别。";
  }

  function useImage(file) {
    const current = invalidate();
    const before = Object.fromEntries(Object.keys(targets).map(key => [key, read(key)]));
    const active = () => current === version;
    source.value = "";
    clear.hidden = false;
    status.textContent = "正在载入本机截图识别工具…";
    // Run one image worker at a time. A later paste always takes precedence.
    imageQueue = imageQueue.then(async () => {
      if (!active()) return;
      const { readBillingImage } = await import("./billing-ocr.js");
      if (!active()) return;
      const text = await readBillingImage(file, active, progress => {
        if (active()) status.textContent = "正在本机识别截图 " + progress + "%…";
      });
      if (!active()) return;
      source.value = text.trim();
      if (source.value) apply(source.value, before);
      else status.textContent = "没有读到清晰文字。可以换一张截图，或直接粘贴文字。";
    }).catch(() => {
      if (active()) status.textContent = "截图未能识别，请重试、换用 PNG 或 JPG 截图，或直接粘贴文字。";
    });
  }

  function handlePaste(event) {
    const directField = [targets.name, targets.tax, targets.item, targets.quantity, targets.amount].includes(event.target);
    if (event.target !== source && !directField) return;
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const text = clipboard.getData("text/plain");
    const imageItem = Array.from(clipboard.items || []).find(item => item.type.startsWith("image/"));
    const file = imageItem?.getAsFile() || Array.from(clipboard.files || []).find(item => item.type.startsWith("image/"));
    if (file && (!text.trim() || !Object.keys(parseBillingText(text, formatAmount).fields).length)) {
      event.preventDefault();
      useImage(file);
    } else if (text.trim()) {
      if (directField) {
        const result = parseBillingText(text, formatAmount);
        if (Object.keys(result.fields).length < 2 && !result.message) return;
      }
      event.preventDefault();
      useText(text);
    }
  }
  billingForm.addEventListener("paste", handlePaste);
  targets.amount.addEventListener("paste", handlePaste);
  function scheduleTyping() {
    invalidate();
    clear.hidden = !source.value;
    timer = setTimeout(() => useText(source.value), 300);
  }
  source.addEventListener("input", event => { if (!event.isComposing) scheduleTyping(); });
  source.addEventListener("compositionend", scheduleTyping);
  clear.addEventListener("click", () => {
    useText("");
    source.focus();
  });
  find("pick-billing-image").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) useImage(file);
  });
}
