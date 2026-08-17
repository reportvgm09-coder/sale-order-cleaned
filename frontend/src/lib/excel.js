import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002FA7" } };
const ZEBRA_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6FB" } };
const thin = { style: "thin", color: { argb: "FFB6C0D0" } };
const ALL_BORDERS = { top: thin, left: thin, bottom: thin, right: thin };

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
      if (i % 2 === 1) c.fill = ZEBRA_FILL;
    });
  });

  ws.columns.forEach((col) => {
    let max = String(col.header || "").length;
    col.eachCell({ includeEmpty: false }, (c) => {
      const v = c.value == null ? "" : String(c.value);
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
        const wb = XLSX.read(e.target.result, { type: "array" });
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
