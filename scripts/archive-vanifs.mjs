// Administrative cutover helper. It only reads the supplied backup and writes SQL to stdout.
// Keep the export and generated SQL outside the repository.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [, , path] = process.argv;
if (!path) throw new Error('Uso: node scripts/archive-vanifs.mjs /ruta/privada/VANIFS-respaldo.json');
const bytes = await readFile(path);
const exportText = (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
const data = JSON.parse(exportText);
if (!['vanifs-d1-v1','vanifs-d1-v2'].includes(data.format) ||
    ![data.receipts, data.manifest_blocks, data.operation_batches].every(Array.isArray) ||
    data.receipts.some(receipt => !receipt.closed_at)) {
  throw new Error('Respaldo incompleto o con jornadas abiertas. Termina y sincroniza la recepción de origen primero.');
}
const json = JSON.stringify(data);
const tag = '$vanifs_' + createHash('sha256').update(json).digest('hex').slice(0, 16) + '$';
if (json.includes(tag)) throw new Error('El delimitador del respaldo requiere revisión.');
process.stdout.write('BEGIN;\nSELECT vanifs_private.import_d1_archive(' + tag + json + tag + '::jsonb);\nCOMMIT;\n');
