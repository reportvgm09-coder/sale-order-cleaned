import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002FA7" } };
const ZEBRA_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6FB" } };
const thin = { style: "thin", color: { argb: "FFB6C0D0" } };
const ALL_BORDERS = { top: thin, left: thin, bottom: thin, right: thin };

// Matches what the app shows on screen, e.g. 19-Aug-2026. Avoids dd/mm vs mm/dd
// being read the wrong way round by whoever opens the file.
const DATE_FMT = "dd-mmm-yyyy";

const pad = (n) => String(n).padStart(2, "0");

/**
 * Normalise a date out of a spreadsheet cell to "YYYY-MM-DD", or "" if it is not
 * a date at all.
 *
 * The same column can arrive three ways: a real Date once a cell is formatted as
 * a date, a bare serial number when it is not, or text. Reading only the text
 * case is what used to store "46252.7708" as an order date.
 *
 * A typed "03/04/2026" is read as 3 April - day first, as written in India.
 */
export function sheetDate(v) {
  if (v == null || v === "") return "";
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // The reader rebuilds a serial as a local-time Date and can land a few
    // seconds short of midnight, which would otherwise truncate to the day
    // before. Nudge past it before taking the day; five minutes is far more
    // than the slip and far less than any real time-of-day on these columns.
    const local = new Date(v.getTime() - v.getTimezoneOffset() * 60000 + 5 * 60000);
    return iso(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate());
  }
  if (typeof v === "number") {
    // Excel counts days from 1899-12-30; 25569 is that epoch expressed in Unix days.
    const d = new Date(Math.round((v - 25569) * 86400000));
    return Number.isNaN(d.getTime()) ? "" : iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return iso(dmy[3], Number(dmy[2]), Number(dmy[1]));
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? "" : iso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

function addSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  if (!rows || rows.length === 0) {
    ws.addRow(["No data"]);
    return ws;
  }
  const headers = Object.keys(rows[0]);
  ws.columns = headers.map((h) => ({ header: h, key: h }));

  const hr = ws.getRow(1);
  hr.height = 22;
  hr.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    c.alignment = { vertical: "middle", horizontal: "left" };
    c.border = ALL_BORDERS;
  });

  rows.forEach((r, i) => {
    const row = ws.addRow(headers.map((h) => r[h]));
    row.eachCell((c) => {
      c.border = ALL_BORDERS;
      c.alignment = { vertical: "middle" };
      c.font = { size: 10 };
      // Shown the same way the app shows it, and still a real date underneath,
      // so Excel can sort, filter and group by month on it.
      if (c.value instanceof Date) c.numFmt = DATE_FMT;
      if (i % 2 === 1) c.fill = ZEBRA_FILL;
    });
  });

  ws.columns.forEach((col) => {
    let max = String(col.header || "").length;
    col.eachCell({ includeEmpty: false }, (c) => {
      // A Date stringifies to "Wed Aug 19 2026 05:30:00 GMT+0530…", which would
      // set the column far wider than the eleven characters actually shown.
      const v = c.value instanceof Date ? "dd-mmm-yyyy" : c.value == null ? "" : String(c.value);
      if (v.length > max) max = v.length;
    });
    col.width = Math.max(12, Math.min(46, max + 4));
  });

  return ws;
}

async function saveWorkbook(wb, fileName) {
  const buf = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fileName
  );
}

export async function downloadSheet(rows, sheetName, fileName) {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, sheetName, rows);
  await saveWorkbook(wb, fileName);
}

export async function downloadMultiSheet(sheets, fileName) {
  const wb = new ExcelJS.Workbook();
  sheets.forEach((s) => addSheet(wb, s.name, s.rows));
  await saveWorkbook(wb, fileName);
}

export async function downloadTemplateWithLists(columns, sampleRow, lists, fileName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Template", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 4) }));
  ws.getRow(1).eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.border = ALL_BORDERS;
  });
  ws.addRow(sampleRow);

  const ls = wb.addWorksheet("Lists");
  const meta = {};
  Object.entries(lists).forEach(([colName, values], idx) => {
    const letter = String.fromCharCode(65 + idx);
    values.forEach((v, i) => (ls.getCell(`${letter}${i + 1}`).value = v));
    meta[colName] = { letter, count: values.length };
  });
  ls.state = "hidden";

  columns.forEach((colName, ci) => {
    const m = meta[colName];
    if (!m || m.count === 0) return;
    const tCol = String.fromCharCode(65 + ci);
    const ref = `Lists!$${m.letter}$1:$${m.letter}$${m.count}`;
    for (let r = 2; r <= 500; r++) {
      ws.getCell(`${tCol}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [ref] };
    }
  });
  await saveWorkbook(wb, fileName);
}

export function readWorkbookRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // cellDates keeps date cells as Dates instead of raw serial numbers.
        // sheetDate() still handles the other shapes a date can arrive in.
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval: "" }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
