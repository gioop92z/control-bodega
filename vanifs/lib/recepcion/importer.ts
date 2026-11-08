import { HEADERS, MAX_LINES, type ManifestRow } from "./model.ts";

const aliases: Record<keyof ManifestRow, string[]> = {
  floor: ["PISO"],
  date: ["FECHA", "FECHA RECEPCION"],
  section: ["SECC", "SECCION"],
  manifest: ["MANIFIESTO", "NUMERO MANIFIESTO", "N MANIFIESTO", "NO MANIFIESTO"],
  box: ["CONTENEDOR", "CAJA", "ID CONTENEDOR", "CONTENEDOR ORIGEN"],
  description: ["DESCRIPCION", "PRODUCTO", "ARTICULO"],
  sku: ["SKU", "CODIGO SKU", "CODIGO ARTICULO"],
  qty: ["CANT", "CANTIDAD", "CANT ESPERADA", "PIEZAS", "CANTIDAD ESPERADA"],
  price: ["PRECIO", "PRECIO UNITARIO"],
  supplier: ["PROVEEDOR", "PROV"],
  upc: ["UPC", "EAN", "CODIGO DE BARRAS"],
  brand: ["MARCA"],
};
const keys = Object.keys(aliases) as (keyof ManifestRow)[];
const labelFor = (field: keyof ManifestRow) => HEADERS[keys.indexOf(field)];
const clean = (value: unknown) => String(value ?? "").trim();
const headerKey = (value: unknown) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[.#_]/g, " ").replace(/\s+/g, " ");

function split(text: string, separator: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || !value)) {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === separator) {
      row.push(value);
      value = "";
    } else if (!quoted && (c === "\r" || c === "\n")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("El archivo tiene comillas sin cerrar.");
  if (row.length || value) rows.push([...row, value]);
  return rows;
}

export function parseDelimited(input: string) {
  let text = input.replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("Pega las filas del manifiesto, incluyendo los encabezados.");
  if (text.length > 7 * 1024 * 1024) throw new Error("El manifiesto supera el tamaño permitido.");
  const declared = /^sep=([;,\t])\r?\n/i.exec(text);
  if (declared) {
    text = text.slice(declared[0].length);
    return split(text, declared[1]);
  }
  let best: string[][] = [];
  let score = -1;
  for (const separator of ["\t", ",", ";"]) {
    try {
      const rows = split(text, separator);
      const headers = rows.slice(0, 30).map(row => row.map(headerKey));
      const candidate = Math.max(0, ...headers.map(row => row.filter(cell => keys.some(key => aliases[key].includes(cell))).length));
      if (candidate > score) {
        best = rows;
        score = candidate;
      }
    } catch {
      // Another delimiter may be the one that delimits the quoted cells.
    }
  }
  if (!best.length) throw new Error("No se pudo leer el texto. Revisa los separadores y las comillas.");
  return best;
}

export function parseManifest(table: string[][]) {
  let header = -1;
  let mapping = {} as Record<keyof ManifestRow, number>;
  for (let row = 0; row < Math.min(table.length, 35); row++) {
    const cells = table[row].map(headerKey);
    const found = Object.fromEntries(keys.map(key => [key, cells.findIndex(cell => aliases[key].includes(cell))])) as typeof mapping;
    if (found.qty >= 0 && (found.sku >= 0 || found.upc >= 0)) {
      header = row;
      mapping = found;
      for (const key of keys) {
        if (cells.filter(cell => aliases[key].includes(cell)).length > 1) {
          throw new Error("Hay dos columnas para " + labelFor(key) + ". Deja solo una y vuelve a importar.");
        }
      }
      break;
    }
  }
  if (header < 0) throw new Error("Incluye las columnas CANT y SKU o UPC en los encabezados.");
  const rows: ManifestRow[] = [];
  const errors: string[] = [];
  let missingBoxes = 0;
  let missingManifests = 0;
  let invalid = 0;
  for (let i = header + 1; i < table.length; i++) {
    const source = table[i];
    if (!source.some(cell => clean(cell))) continue;
    const take = (key: keyof ManifestRow) => clean(source[mapping[key]]);
    const sku = take("sku");
    const upc = take("upc");
    const quantity = take("qty");
    const qty = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(quantity) ? Number(quantity.replace(/,/g, "")) : NaN;
    if (!sku && !upc && source.some(cell => /^(?:gran )?total(?: general)?$/i.test(clean(cell)))) continue;
    if (headerKey(sku) === "SKU" && aliases.qty.includes(headerKey(quantity))) continue;
    const parsed = Object.fromEntries(keys.map(key => [key, key === "qty" ? qty : take(key)])) as ManifestRow;
    const codes = [parsed.sku, parsed.upc, parsed.box, parsed.manifest];
    const invalidCode = codes.some(value => value.length > 90 || /\d(?:\.\d+)?e\+\d+$/i.test(value) || /[\u0000-\u001f\u007f]/.test(value));
    const invalidText = keys.some(key => key !== "qty" && parsed[key].length > (key === "description" ? 500 : 140));
    const error = !sku && !upc ? "falta SKU o UPC"
      : invalidCode ? "revisa el código; debe estar en texto y sin notación científica"
      : !Number.isInteger(qty) || qty < 1 || qty > 100000 ? "la cantidad debe ser un entero positivo"
      : invalidText ? "un campo excede su longitud permitida"
      : "";
    if (error) {
      if (errors.length < 12) errors.push("Fila " + (i + 1) + " · " + error);
      invalid++;
      continue;
    }
    if (!parsed.box) missingBoxes++;
    if (!parsed.manifest) missingManifests++;
    rows.push(parsed);
    if (rows.length > MAX_LINES) throw new Error("Divide el archivo en jornadas de hasta " + MAX_LINES.toLocaleString("es-MX") + " renglones.");
  }
  if (!rows.length && !invalid) throw new Error("No hay piezas debajo de los encabezados.");
  const warnings = [];
  if (missingBoxes) warnings.push(missingBoxes + " renglón(es) sin contenedor se escanean en «Sin caja».");
  if (missingManifests) warnings.push(missingManifests + " renglón(es) sin número de manifiesto.");
  if (Object.keys(mapping).filter(key => mapping[key as keyof ManifestRow] >= 0).length < HEADERS.length) {
    warnings.push("Las columnas de origen que no venían en el archivo quedarán vacías en el reporte.");
  }
  return { rows, invalid, errors, warnings };
}

export type ImportPreview = ReturnType<typeof parseManifest>;
