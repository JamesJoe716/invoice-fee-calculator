// The same parser handles pasted text and text read from an image.
const aliases = {
  name: ["购买方名称", "购方名称", "公司全称", "公司名称", "企业名称", "单位名称", "单位全称", "客户名称", "发票抬头", "开票抬头", "购方抬头", "抬头名称", "名称", "抬头"],
  tax: ["统一社会信用代码", "社会统一信用代码", "社会信用代码", "统一信用代码", "纳税人识别号", "纳税识别号", "纳税人税号", "企业税号", "公司税号", "税号"],
  item: ["商品或服务名称", "商品名称", "服务名称", "费用名称", "项目名称", "开票项目", "开票品名", "开票内容", "品名"],
  quantity: ["开票数量", "数量"],
  invoiceAmount: ["指定含税开票金额", "含税开票金额", "开票总金额", "开票金额", "票面金额", "含税金额", "价税合计", "总金额"],
  orderAmount: ["订单实付金额", "订单金额", "实付金额", "付款金额", "支付金额"],
  amount: ["金额"],
  note: ["发票的备注", "发票备注", "开票备注", "备注"],
  seal: ["是否需要明细盖章", "需要明细盖章", "明细盖章"],
  special: ["是否需要专票", "需要专票", "专票"],
  bank: ["银行信息", "开户信息", "开户银行名称", "开户行名称", "银行名称", "银行账户名称", "账户名称", "银行户名", "开户户名", "收款户名", "开户名称", "户名", "开户银行", "开户行及账号", "开户行行号", "开户行", "银行行号", "银行联行号", "联行号", "行号", "对公账户", "对公账号", "银行账户", "银行账号", "收款账户", "收款账号", "开户账号", "账号", "帐号", "账户"],
  ignore: ["注册地址及电话", "注册地址", "单位地址", "公司地址", "办公地址", "联系地址", "地址", "联系电话", "电话号码", "手机号", "电话", "传真", "邮政编码", "邮编", "电子邮箱", "邮箱", "联系人", "订单编号", "订单号", "发票号码", "合计补费比例", "补费比例", "应补费用", "补费金额", "补费", "税率", "税额", "单价"],
  header: ["开票信息", "开票资料", "发票信息", "购买方信息", "购方信息", "购买方"]
};

const fieldForLabel = new Map();
for (const [field, labels] of Object.entries(aliases)) {
  for (const label of labels) fieldForLabel.set(label, field);
}
// Match complete, longer labels first, e.g. 银行账户名称 before 名称.
const labels = Array.from(fieldForLabel.keys()).sort((a, b) => b.length - a.length).join("|");
const units = "(?:[ \\t]*[（(](?:元|人民币|小写|税号|统一社会信用代码|纳税人识别号)[)）])?";
const inlineLabel = new RegExp("(" + labels + ")" + units + "[ \\t]*[:：]", "g");
const startLabel = new RegExp("^(" + labels + ")" + units + "(?:[ \\t]*[:：=][ \\t]*|[ \\t]+|$)(.*)$");
const organization = /(?:公司|大学|学院|学校|医院|研究院|研究所|中心|事务所|工作室|合作社|基金会|协会|委员会|经营部|商行)[)）]?$/;
const product = /(?:服务费|咨询费|技术费|使用费|会员费|资料费|培训费|材料费|软件费|费|服务|软件|设备|材料|耗材|会员)$/;
const instruction = /(?:请问|请帮|麻烦|不需要|是否|不要|粘贴|复制|发票|补费|开户|银行|账号|帐号|地址|电话)/;

function cleanLine(text) {
  return text.trim().replace(/^[,，;；|、\s]+|[,，;；|\s]+$/g, "");
}

function taxNumber(value) {
  const code = value.normalize("NFKC").toUpperCase().replace(/[ \t]/g, "");
  return /^[A-Z0-9][A-Z0-9-]{7,23}$/.test(code) && /\d/.test(code) ? code : "";
}

function yesOrNo(value) {
  if (/^(是|需要|要|有)$/.test(value)) return "是";
  if (/^(否|不需要|不要|无)$/.test(value)) return "否";
  return "";
}

function readMoney(value, formatAmount, unlabelled = false) {
  const raw = value.normalize("NFKC").trim();
  const hasCurrency = /¥|元|圆|人民币|RMB|CNY/i.test(raw);
  const number = raw.replace(/^(?:人民币|RMB|CNY)\s*/i, "").replace(/^¥\s*/, "").replace(/\s*(?:元|圆|RMB|CNY)$/i, "").trim();
  // Bare long digit strings are commonly phone numbers, account numbers or other IDs.
  if (unlabelled && !hasCurrency && /^\d{7,}$/.test(number)) return "";
  return formatAmount(number) || "";
}

function looksLikeItem(value) {
  return value.length <= 64 && /[\u3400-\u9fffA-Za-z]/.test(value) &&
    !instruction.test(value) && !/[:：。！？!?]/.test(value) && !organization.test(value);
}

export function parseBillingText(source, formatAmount, fromImage = false) {
  let text = source.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n")
    .replace(/\\[ \t]*(?=\n|$)/g, "").replace(/[\u200b-\u200f\ufeff]/g, "");
  if (fromImage) text = text.replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, "$1");
  const lines = text.replace(inlineLabel, "\n$1:").split("\n").map(cleanLine).filter(Boolean);
  const found = new Map();
  const loose = [];
  let pending = "";
  let section = "invoice";
  let noteLines = [];

  function add(field, value) {
    if (!value) return;
    if (!found.has(field)) found.set(field, new Set());
    found.get(field).add(value);
  }

  function labelled(field, value) {
    if (field === "tax") {
      const code = taxNumber(value);
      if (code) add(field, code);
      else {
        // Some chats put the item and price on the same line after the tax ID.
        const tail = /^([A-Z0-9-]{8,24})[ \t,，]+(.+)$/i.exec(value.normalize("NFKC"));
        if (tail && taxNumber(tail[1])) {
          add(field, taxNumber(tail[1]));
          loose.push(tail[2]);
        }
      }
    } else if (["orderAmount", "invoiceAmount", "amount"].includes(field)) {
      add(field, readMoney(value, formatAmount));
    } else if (field === "seal" || field === "special") {
      add(field, yesOrNo(value));
    } else {
      add(field, value);
    }
  }

  for (const line of lines) {
    const tag = startLabel.exec(line);
    if (tag) {
      loose.push("");
      if (section === "note") add("note", noteLines.join("\n").trim());
      pending = "";
      const field = fieldForLabel.get(tag[1]);
      const value = cleanLine(tag[2]);
      // Contact details or a generic account name inside a bank block still belong to that bank.
      if (section === "bank" && (field === "ignore" || tag[1] === "名称")) continue;
      section = field === "header" ? "invoice" : field;
      if (field === "bank" || field === "header") continue;
      if (field === "ignore") {
        section = "invoice";
        if (!value) pending = "ignore";
        continue;
      }
      if (field === "note") {
        noteLines = value ? [value] : [];
      } else if (value) {
        labelled(field, value);
      } else {
        pending = field;
      }
    } else if (section === "note") {
      noteLines.push(line);
    } else if (pending) {
      if (pending !== "ignore") labelled(pending, line);
      pending = "";
    } else if (section !== "bank") {
      loose.push(line);
    }
  }
  if (section === "note") add("note", noteLines.join("\n").trim());

  const inferred = { name: new Set(), tax: new Set(), item: new Set(), amount: new Set() };
  let previous = "";
  for (const line of loose) {
    if (!line) {
      previous = "";
      continue;
    }
    const pair = /^(.+?)[，,\s]+((?:[￥¥]|人民币)?\s*[\d０-９][\d０-９.,，．]*\s*(?:元|圆)?)$/.exec(line);
    if (pair && looksLikeItem(pair[1]) && product.test(pair[1])) {
      const price = readMoney(pair[2], formatAmount, true);
      if (price) {
        inferred.item.add(pair[1]);
        inferred.amount.add(price);
        previous = "";
        continue;
      }
    }
    const code = taxNumber(line);
    const amount = readMoney(line, formatAmount, true);
    if (code && /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(code) && /[A-Z]/.test(code)) {
      inferred.tax.add(code);
    } else if (organization.test(line) && line.length <= 100 && !instruction.test(line)) {
      inferred.name.add(line);
    } else if (amount) {
      inferred.amount.add(amount);
      if (looksLikeItem(previous) && !taxNumber(previous)) inferred.item.add(previous);
    } else if (looksLikeItem(line) && product.test(line)) {
      inferred.item.add(line);
    }
    previous = line;
  }
  for (const [field, values] of Object.entries(inferred)) {
    if (!found.has(field) && values.size) found.set(field, values);
  }

  // Never combine fields from two different buyers in a single paste.
  if (found.get("name")?.size > 1 || found.get("tax")?.size > 1) {
    return { fields: {}, message: "识别到多组名称或税号，请每次粘贴一个客户的资料。" };
  }
  const fields = {};
  let ambiguous = false;
  for (const [field, values] of found) {
    if (values.size === 1) fields[field] = values.values().next().value;
    else ambiguous = true;
  }
  return { fields, message: ambiguous ? "有多个候选值的字段请手动填写。" : "" };
}
