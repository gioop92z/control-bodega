import type { Cell, Worksheet } from "exceljs";
import { actualBoxesForCode, summarizeProducts, type Audit, type ManifestIndex } from "./audit.ts";
import { HEADERS, incidentCount, originalCells, type Detail, type OperationInput, type TeamActivity } from "./model.ts";
import { progressFromScans } from "./projection.ts";
import { parseDelimited } from "./importer.ts";

function cellText(cell: Cell) {
  const value = cell.type === 6 ? cell.result : cell.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && /^0+$/.test(cell.numFmt ?? "")) {
    return String(value).padStart(cell.numFmt.length, "0");
  }
  if (cell.type === 6) return String(value ?? "");
  return cell.text;
}

export async function readImportFile(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("El archivo debe pesar menos de 10 MB.");
  if (/\.xlsx$/i.test(file.name)) {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await file.arrayBuffer());
    return book.worksheets.filter(sheet => sheet.state === "visible").map(sheet => {
      if (sheet.rowCount > 15000) return { name: sheet.name, rows: [], error: "Esta hoja contiene más de 15,000 filas físicas." };
      const rows: string[][] = [];
      sheet.eachRow({ includeEmpty: true }, row => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => {
          if (column <= 120) cells[column - 1] = cellText(cell);
        });
        rows.push(cells);
      });
      return { name: sheet.name, rows, error: "" };
    });
  }
  if (!/\.(csv|tsv|txt)$/i.test(file.name)) throw new Error("Selecciona un archivo .xlsx, .csv o .tsv.");
  const bytes = await file.arrayBuffer();
  let text = new TextDecoder().decode(bytes);
  if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(bytes);
  return [{ name: file.name, rows: parseDelimited(text), error: "" }];
}

function download(buffer: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function downloadPending(ops: OperationInput[], title: string) {
  download(JSON.stringify(ops, null, 2), "application/json;charset=utf-8", "lecturas-locales-" + filename(title) + ".json");
}

function filename(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "jornada";
}

function style(sheet: Worksheet, widths: number[]) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns = widths.map(width => ({ width }));
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell(cell => {
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF562087" } };
    cell.alignment = { vertical: "middle" };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
}

function colorRow(sheet: Worksheet, n: number) {
  sheet.getRow(n).eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE4E8" } };
  });
}

export async function buildWorkbook(detail: Detail, index: ManifestIndex, result: Audit, seproOnly = false, activities: TeamActivity[] = []) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "VANIFS";
  const { receipt, rows } = detail;
  const { totals, scans, verification } = result;
  const resultLabel = receipt.canceled ? "CANCELADA" : !receipt.closedAt ? "EN CURSO" : incidentCount(totals) ? "CON INCIDENCIAS" : "COMPLETO 100%";
  if (!seproOnly) {
    const summary = book.addWorksheet("JORNADA");
    summary.addRows([
      ["CAMPO", "VALOR"], ["Jornada", receipt.title], ["Archivo", receipt.file], ["Estado", resultLabel],
      ["Apertura", receipt.createdAt], ["Creada por", receipt.createdBy], [receipt.canceled ? "Cancelación" : "Cierre", receipt.closedAt ?? ""],
      [receipt.canceled ? "Cancelada por" : "Cerrada por", receipt.closedBy ?? ""], ["Esperadas", totals.expected], ["Escaneadas", totals.scanned],
      ["Conciliadas", totals.matched], ["Faltantes", totals.missing], ["Sobrantes", totals.extra],
      ["No manifestadas", totals.unknown], ["Otra caja", totals.wrongBox], ["Incidencias manuales", totals.manual],
      ["Observaciones", receipt.note], ["Porcentaje conciliado", totals.expected ? totals.matched / totals.expected : 0], ["ID de jornada", receipt.id],
    ]);
    summary.getCell("B18").numFmt = "0.0%";
    style(summary, [28, 70]);

    const validated = book.addWorksheet("MANIFIESTO VALIDADO");
    validated.addRow([...HEADERS, "RECIBIDAS", "DIFERENCIA", "RESULTADO"]);
    rows.forEach((row, line) => {
      const received = result.received[line] + result.extras[line];
      const label = received === row.qty ? "Conciliado" : received < row.qty ? receipt.closedAt ? "Faltante" : "Pendiente" : "Sobrante";
      const entry = validated.addRow([...originalCells(row), received, received - row.qty, label]);
      if (received !== row.qty) colorRow(validated, entry.number);
    });
    style(validated, [12, 14, 10, 19, 18, 55, 19, 12, 14, 24, 22, 20, 14, 14, 18]);

    const issues = book.addWorksheet("INCIDENCIAS");
    issues.addRow(["TIPO", "SKU / CÓDIGO", "UPC", "DESCRIPCIÓN", "MANIFIESTO", "CAJA REAL", "CAJA ESPERADA", "CANTIDAD", "OBSERVACIÓN", "OPERADOR", "FECHA"]);
    rows.forEach((row, line) => {
      const missing = row.qty - result.received[line];
      if (missing) issues.addRow([receipt.closedAt ? "Faltante al cierre" : "Pendiente", row.sku, row.upc, row.description, row.manifest, "", row.box, missing, verification.get(line)?.status ?? "Pendiente de verificación"]);
    });
    for (const scan of scans) {
      if (!["Sobrante", "Otra caja", "Fuera de manifiesto"].includes(scan.result)) continue;
      const row = scan.line === undefined ? undefined : rows[scan.line];
      issues.addRow([scan.result, row?.sku || scan.op.code, row?.upc ?? "", scan.description ?? "", row?.manifest ?? "", scan.op.box,
        actualBoxesForCode(index, scan.op.code), 1, "", scan.op.actor.name, scan.op.at]);
    }
    for (const issue of result.issues) {
      issues.addRow([issue.type, issue.code, "", "", "", issue.box, "", issue.qty, issue.note, issue.actor.name, issue.at]);
    }
    style(issues, [23, 23, 21, 55, 18, 18, 24, 12, 44, 26, 29]);

    const productivity = book.addWorksheet("PRODUCTIVIDAD");
    productivity.addRow(["COLABORADOR", "PIEZAS REGISTRADAS", "CONTENEDORES", "PRIMER MOVIMIENTO", "ÚLTIMO MOVIMIENTO", "ID DE USUARIO"]);
    for (const person of progressFromScans(scans)) productivity.addRow([person.name, person.pieces, person.boxes.length, person.first, person.last, person.id]);
    style(productivity, [26, 23, 18, 29, 29, 43]);

    const auditSheet = book.addWorksheet("AUDITORÍA");
    auditSheet.addRow(["ID EVENTO", "OPERADOR", "ID DE USUARIO", "FECHA", "HORA UTC", "DISPOSITIVO", "ID DEL DISPOSITIVO", "ACCIÓN", "DETALLE"]);
    const logRow = (id: string, name: string, user: string, at: string, device: string, deviceId: string, action: string, detail: string) =>
      [id, name, user, at.slice(0, 10), at.slice(11, 19), device, deviceId, action, detail];
    const entries = activities.map(item => ({ at: item.at, row: logRow(item.id, item.name, item.userId, item.at, item.device, "", item.action, item.detail) }));
    const results = new Map(scans.map(item => [item.op.id, item.result]));
    for (const batch of detail.batches) for (const op of batch.ops) {
      const at = op.recordedAt ?? op.at;
      const action = op.kind === "box" ? "Selección de contenedor" : op.kind === "piece" ? "Lectura de pieza"
        : op.kind === "undo" ? "Anulación" : op.kind === "issue" ? "Incidencia" : "Verificación SEPRO";
      const info = "code" in op ? [op.code, op.box, op.kind === "issue" ? op.type + " · " + op.note : results.get(op.id)].filter(Boolean).join(" · ")
        : op.kind === "undo" ? op.target : op.status + (op.note ? " · " + op.note : "");
      entries.push({ at, row: logRow(op.id, op.actor.name, op.actor.id, at, op.device ?? "", op.deviceId ?? "", action, info) });
    }
    auditSheet.addRows(entries.sort((a, b) => a.at.localeCompare(b.at)).map(entry => entry.row));
    style(auditSheet, [39, 27, 43, 15, 16, 23, 39, 27, 58]);

    const products = book.addWorksheet("RESUMEN SKU");
    products.addRow(["SKU", "UPC", "DESCRIPCIÓN", "ESPERADAS", "CONCILIADAS", "FALTANTES", "SOBRANTES"]);
    for (const item of summarizeProducts(rows, result)) {
      products.addRow([item.sku, item.upc, item.description, item.expected, item.received, item.missing, item.extra]);
    }
    style(products, [20, 23, 55, 15, 15, 15, 15]);

    const log = book.addWorksheet("ESCANEOS");
    log.addRow(["ID LECTURA", "FECHA HORA", "CÓDIGO", "SKU", "UPC", "MANIFIESTO", "CONTENEDOR", "RESULTADO", "ORIGEN", "OPERADOR"]);
    for (const scan of scans) {
      const row = scan.line === undefined ? undefined : rows[scan.line];
      log.addRow([scan.op.id, scan.op.at, scan.op.code, row?.sku ?? "", row?.upc ?? "", row?.manifest ?? "", scan.op.box, scan.result, scan.op.source, scan.op.actor.name]);
    }
    const seproHistory = book.addWorksheet("HISTORIAL SEPRO");
    seproHistory.addRow(["FECHA", "SKU", "UPC", "CONTENEDOR", "ESTADO", "OBSERVACIÓN", "OPERADOR", "ID LÍNEA"]);
    for (const batch of detail.batches) {
      for (const op of batch.ops) {
        if (op.kind === "verify") {
          const row = rows[op.line];
          seproHistory.addRow([op.at, row?.sku, row?.upc, row?.box, op.status, op.note, op.actor.name, receipt.id + "-" + (op.line + 1)]);
        }
        if (op.kind === "undo") log.addRow([op.id, op.at, op.target, "", "", "", "", "Anulación de lectura", "", op.actor.name]);
      }
    }
    style(log, [39, 29, 39, 21, 23, 18, 18, 24, 16, 25]);
    style(seproHistory, [29, 20, 22, 18, 27, 50, 25, 44]);
  }
  const sepro = book.addWorksheet("PENDIENTES SEPRO");
  sepro.addRow(["SKU", "UPC", "DESCRIPCIÓN", "ESPERADAS", "RECIBIDAS", "FALTANTES", "SECC", "MANIFIESTO", "CONTENEDOR", "PROVEEDOR", "MARCA", "PRECIO", "ID LÍNEA", "ESTADO SEPRO", "OBSERVACIONES", "FECHA ESTADO", "OPERADOR"]);
  rows.forEach((row, line) => {
    const received = result.received[line];
    const verified = verification.get(line);
    if (received === row.qty || (seproOnly && verified?.status !== "Confirmado")) return;
    sepro.addRow([row.sku, row.upc, row.description, row.qty, received, row.qty - received, row.section, row.manifest, row.box,
      row.supplier, row.brand, row.price, receipt.id + "-" + (line + 1), verified?.status ?? "Pendiente de verificación",
      verified?.note ?? "", verified?.at ?? "", verified?.by ?? ""]);
  });
  style(sepro, [19, 22, 55, 14, 14, 14, 11, 19, 18, 24, 20, 14, 43, 30, 50, 29, 26]);
  return {
    buffer: await book.xlsx.writeBuffer(),
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    name: (seproOnly ? "SEPRO_" : "VANIFS_") + filename(receipt.title) + ".xlsx",
  };
}
