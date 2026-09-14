const { pool, query } = require('./db');
const { SHEETS, SHARED_SHEETS } = require('./config');

function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function num(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[₹$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function normKey(k) {
  return String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isShared(cfg) {
  return SHARED_SHEETS.indexOf(cfg.name) > -1;
}

function coerceValue(cfg, col, v) {
  if (cfg.numeric && cfg.numeric.indexOf(col) > -1) return num(v);
  return v === null || v === undefined ? '' : v;
}

function computeBillTotal(base, gstPercent) {
  const b = num(base), g = num(gstPercent);
  return +(b + (b * g / 100)).toFixed(2);
}

function defaultStatus(sheetName) {
  switch (sheetName) {
    case 'Customers': case 'Suppliers': return 'Active';
    case 'WorkOrders': case 'PurchaseOrders': return 'Open';
    case 'Quotations': return 'Draft';
    case 'Bills': return 'Unpaid';
    default: return '';
  }
}

function buildRowFromPayload(cfg, payload, id, existing) {
  const camelByCol = {};
  Object.keys(cfg.fieldMap).forEach(cam => { camelByCol[cfg.fieldMap[cam]] = cam; });
  return cfg.columns.map(col => {
    if (col === cfg.idField) return id;
    if (col === 'CreatedDate') return existing ? (existing.CreatedDate || today()) : today();
    if (col === 'TotalAmount' && (cfg.name === 'Bills' || cfg.name === 'WorkOrders' || cfg.name === 'PurchaseBills')) {
      const base = payload.baseAmount !== undefined ? payload.baseAmount : (existing ? existing.BaseAmount : 0);
      const gst  = payload.gstPercent !== undefined ? payload.gstPercent : (existing ? existing.GSTPercent : 0);
      return computeBillTotal(base, gst);
    }
    if (col === 'AttachmentUrl' && cfg.attachment) {
      return existing ? (existing.AttachmentUrl || '') : '';
    }
    const camel = camelByCol[col];
    let v;
    if (camel && payload[camel] !== undefined) v = payload[camel];
    else if (payload[col] !== undefined) v = payload[col];
    else v = existing ? (existing[col] !== undefined ? existing[col] : '') : '';
    if (v === '' || v === null || v === undefined) {
      if (col === 'Status') v = defaultStatus(cfg.name);
      if (col === 'GSTR1Filed') v = 'No';
      if (col === 'ITCStatus') v = 'Pending';
      if (col === 'Source') v = 'Manual';
    }
    return coerceValue(cfg, col, String(v));
  });
}

function payloadToObject(cfg, row) {
  const obj = {};
  cfg.columns.forEach((c, i) => { obj[c] = row[i]; });
  return obj;
}

async function nextIdNum(key, firmId) {
  const cfg = SHEETS[key];
  const where = isShared(cfg) ? '' : 'WHERE "FirmId" = $1';
  const params = isShared(cfg) ? [] : [firmId];
  const rows = await query(`SELECT "${cfg.idField}" as id FROM "${cfg.name}" ${where}`, params);
  let max = 0;
  rows.forEach(r => {
    const m = String(r.id || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max + 1;
}

function makeId(cfg, n) {
  return cfg.prefix + '-' + ('0000' + n).slice(-4);
}

// Reads all rows of a table as plain objects, insertion order preserved.
async function rowsToObjects(key, firmId) {
  const cfg = SHEETS[key];
  const cols = cfg.columns.map(c => `"${c}"`).join(', ');
  const where = isShared(cfg) ? '' : 'WHERE "FirmId" = $1';
  const params = isShared(cfg) ? [] : [firmId];
  return query(`SELECT ${cols} FROM "${cfg.name}" ${where} ORDER BY ctid ASC`, params);
}

async function findExisting(key, id, firmId) {
  const cfg = SHEETS[key];
  const cols = cfg.columns.map(c => `"${c}"`).join(', ');
  const where = isShared(cfg) ? `"${cfg.idField}" = $1` : `"${cfg.idField}" = $1 AND "FirmId" = $2`;
  const params = isShared(cfg) ? [id] : [id, firmId];
  const rows = await query(`SELECT ${cols} FROM "${cfg.name}" WHERE ${where}`, params);
  return rows[0] || null;
}

async function addRecord(key, payload, firmId, opts) {
  payload = payload || {};
  const cfg = SHEETS[key];
  const id = (opts && opts.id) ? opts.id : cfg.prefix + '-' + ('0000' + await nextIdNum(key, firmId)).slice(-4);
  const row = buildRowFromPayload(cfg, payload, id, null);

  if (cfg.attachment && payload.attachmentData && payload.attachmentData.base64) {
    const refNo = payload.workOrderNo || payload.purchaseOrderNo || id;
    row[cfg.columns.indexOf('AttachmentUrl')] = await saveAttachment(payload.attachmentData, cfg.name + '_' + id + '_' + refNo);
  }

  const insertCols = isShared(cfg) ? cfg.columns : ['FirmId'].concat(cfg.columns);
  const insertVals = isShared(cfg) ? row : [firmId].concat(row);
  const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
  const colList = insertCols.map(c => `"${c}"`).join(', ');
  await pool.query(`INSERT INTO "${cfg.name}" (${colList}) VALUES (${placeholders})`, insertVals);

  return { obj: payloadToObject(cfg, row), payload };
}

async function updateRecord(key, payload, firmId) {
  payload = payload || {};
  const cfg = SHEETS[key];
  const camelId = cfg.idField.charAt(0).toLowerCase() + cfg.idField.slice(1);
  const id = payload[camelId] !== undefined ? payload[camelId] : payload[cfg.idField];
  if (!id) throw new Error('Missing ' + cfg.idField + ' for update.');
  const existing = await findExisting(key, id, firmId);
  if (!existing) throw new Error('Record ' + id + ' not found in ' + cfg.name + '.');

  const row = buildRowFromPayload(cfg, payload, id, existing);

  if (cfg.attachment && payload.attachmentData && payload.attachmentData.base64) {
    const refNo = payload.workOrderNo || payload.purchaseOrderNo || id;
    row[cfg.columns.indexOf('AttachmentUrl')] = await saveAttachment(payload.attachmentData, cfg.name + '_' + id + '_' + refNo);
  }

  const setClause = cfg.columns.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
  const where = isShared(cfg)
    ? `"${cfg.idField}" = $${row.length + 1}`
    : `"${cfg.idField}" = $${row.length + 1} AND "FirmId" = $${row.length + 2}`;
  const whereParams = isShared(cfg) ? [id] : [id, firmId];
  await pool.query(`UPDATE "${cfg.name}" SET ${setClause} WHERE ${where}`, [...row, ...whereParams]);

  return payloadToObject(cfg, row);
}

async function deleteRecord(key, id, firmId) {
  const cfg = SHEETS[key];
  const where = isShared(cfg) ? `"${cfg.idField}" = $1` : `"${cfg.idField}" = $1 AND "FirmId" = $2`;
  const params = isShared(cfg) ? [id] : [id, firmId];
  const res = await pool.query(`DELETE FROM "${cfg.name}" WHERE ${where}`, params);
  if (res.rowCount === 0) throw new Error('Record ' + id + ' not found in ' + cfg.name + '.');
  return { ok: true, deleted: id };
}

async function setSingleField(key, id, column, value, firmId) {
  const cfg = SHEETS[key];
  if (cfg.columns.indexOf(column) === -1) throw new Error('Column ' + column + ' missing in ' + cfg.name + '.');
  const where = isShared(cfg) ? `"${cfg.idField}" = $2` : `"${cfg.idField}" = $2 AND "FirmId" = $3`;
  const params = isShared(cfg) ? [value, id] : [value, id, firmId];
  const res = await pool.query(`UPDATE "${cfg.name}" SET "${column}" = $1 WHERE ${where}`, params);
  if (res.rowCount === 0) throw new Error('Record ' + id + ' not found in ' + cfg.name + '.');
  return { ok: true };
}

/* ===================== ATTACHMENTS (stored as DB rows — Render's disk isn't persistent) ===================== */
const { MAX_ATTACHMENT_MB } = require('./config');
const crypto = require('crypto');

async function saveAttachment(fileData, label) {
  const sizeMB = (fileData.base64.length * 0.75) / (1024 * 1024);
  if (sizeMB > MAX_ATTACHMENT_MB) {
    throw new Error('Attachment is ' + sizeMB.toFixed(1) + ' MB — max allowed is ' + MAX_ATTACHMENT_MB + ' MB.');
  }
  const id = crypto.randomBytes(12).toString('hex');
  const buf = Buffer.from(fileData.base64, 'base64');
  await pool.query(
    `INSERT INTO "Attachments" ("Id","FileName","MimeType","Data") VALUES ($1,$2,$3,$4)`,
    [id, String(label + '_' + (fileData.fileName || 'file')), fileData.mimeType || 'application/octet-stream', buf]
  );
  return '/attachments/' + id;
}

async function getAttachment(id) {
  const rows = await query(`SELECT "FileName","MimeType","Data" FROM "Attachments" WHERE "Id" = $1`, [id]);
  return rows[0] || null;
}

module.exports = {
  today, num, normKey, isShared, coerceValue, computeBillTotal, defaultStatus,
  buildRowFromPayload, payloadToObject, nextIdNum, makeId, rowsToObjects,
  findExisting, addRecord, updateRecord, deleteRecord, setSingleField,
  saveAttachment, getAttachment
};
