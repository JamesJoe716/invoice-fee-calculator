import assert from "node:assert/strict";
import test from "node:test";
import { parseBillingText } from "../docs/billing-text.js";

// Amount normalization is supplied by the calculator. These cases exercise field recognition.
const parse = text => parseBillingText(text, value => /^\d+(?:\.\d{2})?$/.test(value) ? value : "");

test("keeps bank and contact details out of the invoice fields", () => {
  const source = [
    "名称：示例学院", "统一社会信用代码：TEST000000000001",
    "地址：示例路8号", "电话：00000000", "银行信息：", "户名：示例学院",
    "账号：000000000000000000", "银行行号：000000000000", "开户行：示例银行",
    "联系电话：", "00000000", "名称：银行账户示例", "12"
  ].join("\n");
  assert.deepEqual(parse(source).fields, { name: "示例学院", tax: "TEST000000000001" });
});

test("reads spaced institutional labels and ignores mandatory-field notices", () => {
  const source = [
    "单 位 名 称：示例大学（南校区）【必填】",
    "纳税人识别号：TEST000000000005【必填】",
    "单位地址、电话：示范街1号 000-00000000 【增值税专用发票必填】",
    "开户银行及账号：某银行 000000000000000000 【增值税专用发票必填】"
  ].join("\n\n");
  assert.deepEqual(parse(source).fields, { name: "示例大学（南校区）", tax: "TEST000000000005" });
});

test("accepts hints before or after a label and preserves meaningful brackets and spaces", () => {
  const source = "单　位\t名 称【必填】：Atlas Lab（广州）【研究中心】 纳 税 人 识 别 号：\n[必填]\nTEST000000000006（必填）";
  assert.deepEqual(parse(source).fields, { name: "Atlas Lab（广州）【研究中心】", tax: "TEST000000000006" });
});

test("keeps an explicit invoice choice and customer note separate from template instructions", () => {
  const source = [
    "开户银行及账号：某银行 000000000000000000 【增值税专用发票必填】",
    "是否需要专票：是", "发票的备注：保留原文【必填】"
  ].join("\n");
  assert.deepEqual(parse(source).fields, { special: "是", note: "保留原文【必填】" });
});

test("recognizes an unlabelled item and amount alongside a labelled buyer", () => {
  const source = "公司名称：演示有限公司\n税号：TEST000000000002\n信息服务费\n624.75";
  assert.deepEqual(parse(source).fields, {
    name: "演示有限公司", tax: "TEST000000000002", item: "信息服务费", amount: "624.75"
  });
});

test("separates the invoice amount, order amount, and previously quoted fee", () => {
  const source = "订单金额：100.00 总金额：110.00 补费：10.00";
  assert.deepEqual(parse(source).fields, { orderAmount: "100.00", invoiceAmount: "110.00" });
});

test("does not merge two customers into one invoice", () => {
  const result = parse("名称：演示甲公司\n税号：TEST000000000003\n名称：演示乙公司\n税号：TEST000000000004");
  assert.deepEqual(result.fields, {});
  assert.match(result.message, /多组/);
});
