
const ExcelJS = require("exceljs");

const RISKY_START = /^[=+\-@\t\r]/;

function safeCell(value) {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;

  let text = String(value).replace(/[\r\n\t]+/g, " ").trim();
  if (RISKY_START.test(text)) text = "'" + text;
  return text;
}

function disposition(name) {
  const base = String(name || "export").replace(/\.xlsx$/i, "");

  let ascii = base.replace(/[^\x20-\x7e]/g, "").replace(/["\\;,\r\n]/g, "");
  ascii = ascii.trim().replace(/\s+/g, "-");
  if (!ascii) ascii = "export";

  return (
    'attachment; filename="' +
    ascii +
    '.xlsx"; filename*=UTF-8\'\'' +
    encodeURIComponent(base + ".xlsx")
  );
}

function stamp(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function safeSheetName(name) {
  const clean = String(name || "بيانات").replace(/[:\\/?*[\]]/g, " ").trim();
  return (clean || "بيانات").slice(0, 31);
}

async function sendSheet(res, opts) {
  const o = opts || {};
  const columns = Array.isArray(o.columns) ? o.columns : [];
  const rows = Array.isArray(o.rows) ? o.rows : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = "منصة أ/ مرڤت عبدالرحمن";
  wb.created = new Date();

  const ws = wb.addWorksheet(safeSheetName(o.sheetName));

  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 18,
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }));

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  head.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F6FEB" },
  };
  head.alignment = { vertical: "middle", horizontal: "right" };
  head.height = 24;

  for (const row of rows) {
    const out = {};
    for (const c of columns) out[c.key] = safeCell(row ? row[c.key] : "");
    ws.addRow(out);
  }

  if (!rows.length) {
    const note = ws.addRow({});
    note.getCell(1).value = "لا توجد بيانات مطابقة للتصفية المحددة.";
    note.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
    if (columns.length > 1) {
      ws.mergeCells(note.number, 1, note.number, columns.length);
    }
  }

  if (rows.length && columns.length) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const name = (o.filename || "export") + "-" + stamp();

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", disposition(name));
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");

  return res.end(Buffer.from(buffer));
}

module.exports = {
  sendSheet,
  safeCell,
  safeSheetName,
  disposition,
  stamp,
};
