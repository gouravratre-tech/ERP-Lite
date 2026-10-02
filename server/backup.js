/**
 * Attachment backup — builds ONE zip of every file that has been uploaded
 * (Work Orders, Purchase Orders, Quotations, Sales Invoices, Purchase Bills),
 * for all firms, plus an index.csv that says which record each file belongs to.
 *
 * Files are read from the database ONE AT A TIME and streamed into the zip,
 * so memory stays small even when the Attachments table is large.
 * Files that no record points to any more (replaced or deleted records) are
 * still included, in an "_Unlinked" folder, so nothing is ever left out.
 */
const archiver = require('archiver');
const { query } = require('./db');
const { SHEETS, FIRMS } = require('./config');

const SHEET_LABELS = {
  WorkOrders: 'Work Orders', PurchaseOrders: 'Purchase Orders', Quotations: 'Quotations',
  Bills: 'Sales Invoices', PurchaseBills: 'Purchase Bills'
};

function safeName(s) {
  const clean = String(s || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'file';
  return clean.length > 150 ? clean.slice(-150) : clean;   // keep the end so the extension survives
}
function csvCell(v) {
  v = v == null ? '' : String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function attachmentIdFromUrl(url) {
  const m = String(url || '').match(/^\/attachments\/([A-Za-z0-9]+)$/);
  return m ? m[1] : '';
}

// Lists every stored file with the record it belongs to (no file contents loaded).
async function buildManifest() {
  const files = await query(`SELECT "Id","FileName","MimeType","CreatedAt", octet_length("Data") AS size FROM "Attachments" ORDER BY "CreatedAt" ASC`);
  const byId = {};
  files.forEach(f => { byId[f.Id] = { id: f.Id, fileName: f.FileName, size: Number(f.size) || 0, uploadedAt: f.CreatedAt, link: null }; });

  const parties = {};
  (await query(`SELECT "CustomerId" AS id, "Name" FROM "Customers"`)).forEach(r => { parties[r.id] = r.Name; });
  (await query(`SELECT "SupplierId" AS id, "Name" FROM "Suppliers"`)).forEach(r => { parties[r.id] = r.Name; });
  const firmName = id => (FIRMS.filter(f => f.id === id)[0] || {}).name || id || '';

  for (const key of Object.keys(SHEETS)) {
    const cfg = SHEETS[key];
    if (!cfg.attachment) continue;
    const refCol = cfg.columns.find(c => /No$/.test(c));
    const partyCol = cfg.columns.indexOf('CustomerId') > -1 ? 'CustomerId' : (cfg.columns.indexOf('SupplierId') > -1 ? 'SupplierId' : null);
    const cols = ['"FirmId"', `"${cfg.idField}" AS rid`, '"Date"', '"AttachmentUrl"']
      .concat(refCol ? [`"${refCol}" AS ref`] : []).concat(partyCol ? [`"${partyCol}" AS party`] : []);
    const rows = await query(`SELECT ${cols.join(', ')} FROM "${cfg.name}" WHERE "AttachmentUrl" LIKE '/attachments/%'`);
    rows.forEach(r => {
      const f = byId[attachmentIdFromUrl(r.AttachmentUrl)];
      if (!f) return;   // record points at a file that no longer exists
      f.link = { firm: firmName(r.FirmId), type: SHEET_LABELS[key] || cfg.name, recordId: r.rid, ref: r.ref || '', party: parties[r.party] || r.party || '', date: r.Date || '' };
    });
  }

  const used = {};
  const items = Object.keys(byId).map(id => byId[id]).map(f => {
    const folder = f.link ? (f.link.firm || 'Firm') + '/' + f.link.type : '_Unlinked (replaced or deleted records)';
    let name = safeName(f.fileName);
    let path = folder.split('/').map(safeName).join('/') + '/' + name;
    if (used[path.toLowerCase()]) { name = f.id.slice(0, 6) + '_' + name; path = path.slice(0, path.length - safeName(f.fileName).length) + name; }
    used[path.toLowerCase()] = true;
    f.path = path;
    return f;
  });
  const totalBytes = items.reduce((a, f) => a + f.size, 0);
  const unlinked = items.filter(f => !f.link).length;
  return { items, count: items.length, unlinked, totalBytes, totalMB: +(totalBytes / 1048576).toFixed(1) };
}

function indexCsv(items) {
  const head = ['File in zip', 'Firm', 'Type', 'Record ID', 'Reference No', 'Party', 'Date', 'Size (KB)', 'Uploaded at'];
  const lines = [head.join(',')];
  items.forEach(f => {
    const l = f.link || {};
    lines.push([f.path, l.firm || '', l.type || 'Unlinked', l.recordId || '', l.ref || '', l.party || '', l.date || '',
      (f.size / 1024).toFixed(1), f.uploadedAt ? new Date(f.uploadedAt).toISOString() : ''].map(csvCell).join(','));
  });
  return '\ufeff' + lines.join('\r\n');   // BOM so Excel reads ₹ / Hindi names correctly
}

async function streamBackup(res, getFile) {
  const manifest = await buildManifest();
  const stamp = new Date().toISOString().slice(0, 10);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="KGS-ERP-attachments-backup-${stamp}.zip"`, 'Cache-Control': 'no-store' });

  const archive = archiver('zip', { zlib: { level: 1 } });   // PDFs/images are already compressed
  let aborted = false;
  res.on('close', () => { if (!res.writableFinished) { aborted = true; archive.abort(); } });
  archive.on('error', err => { console.error('Backup zip error:', err.message); res.destroy(err); });
  archive.pipe(res);

  archive.append(indexCsv(manifest.items), { name: 'index.csv' });
  for (const f of manifest.items) {
    if (aborted) return;
    const file = await getFile(f.id);
    if (!file || !file.Data) continue;
    await new Promise(resolve => { archive.once('entry', resolve); archive.append(file.Data, { name: f.path }); });   // wait = back-pressure
  }
  if (!aborted) await archive.finalize();
}

module.exports = { buildManifest, streamBackup, indexCsv, safeName };
