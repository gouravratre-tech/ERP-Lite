const { ensureSchema, getSetting, setSetting } = require('./db');
const { FIRMS, getFirm, DIRECTORS, SHEETS, STATE_KEY_MAP } = require('./config');
const store = require('./store');

let schemaReadyPromise = null;
function whenSchemaReady() {
  if (!schemaReadyPromise) schemaReadyPromise = ensureSchema();
  return schemaReadyPromise;
}

/* ===================== ACTIVE FIRM ===================== */
async function getActiveFirmId() {
  return getSetting('ACTIVE_FIRM', FIRMS[0].id);
}
async function setActiveFirm(firmId) {
  const id = firmId || FIRMS[0].id;
  await setSetting('ACTIVE_FIRM', id);
  return { ok: true, firmId: id };
}

/* ===================== DIRECTOR NAME MATCHING ===================== */
function matchDirector(text) {
  const hay = String(text || '').toUpperCase();
  if (!hay.trim()) return '';
  for (const d of DIRECTORS) {
    for (const alias of d.aliases) {
      if (alias && hay.indexOf(alias.toUpperCase()) > -1) return d.name;
    }
  }
  return '';
}
function resolveDirectorName(v) {
  const hit = matchDirector(v);
  if (hit) return hit;
  const clean = String(v || '').trim();
  const found = DIRECTORS.filter(d => d.name.toUpperCase() === clean.toUpperCase());
  return found.length ? found[0].name : clean;
}
async function resolveRefId(masterKey, idField, v, firmId) {
  const clean = String(v || '').trim();
  if (!clean) return '';
  const rows = await store.rowsToObjects(masterKey, firmId);
  for (const r of rows) if (String(r[idField]) === clean) return clean;
  const upper = clean.toUpperCase();
  for (const r of rows) {
    if (String(r.Name || '').trim().toUpperCase() === upper) return r[idField];
  }
  return clean;
}
async function findRefIdByNameInText(masterKey, idField, text, firmId) {
  const hay = String(text || '').toUpperCase();
  const rows = await store.rowsToObjects(masterKey, firmId);
  for (const r of rows) {
    const name = String(r.Name || '').trim().toUpperCase();
    if (name.length >= 3 && hay.indexOf(name) > -1) return r[idField];
  }
  for (const r of rows) {
    const name = String(r.Name || '').trim().toUpperCase();
    const words = name.split(/\s+/).filter(w => w.length >= 4);
    if (words.length > 0 && words.some(w => hay.indexOf(w) > -1)) return r[idField];
  }
  return '';
}

/* ===================== GENERIC ADD WITH DIRECTOR AUTO-DETECTION ===================== */
async function addRecordWithSideEffects(key, payload, firmId) {
  const { obj } = await store.addRecord(key, payload, firmId);
  if (key === 'CashBook') {
    const hay = [payload.category, payload.referenceNo, payload.notes].join(' ');
    const director = matchDirector(hay);
    if (director) {
      await store.addRecord('DirectorsBook', {
        date: payload.date || store.today(),
        director: director,
        type: String(payload.type).toUpperCase() === 'OUT' ? 'OUT' : 'IN',
        amount: store.num(payload.amount),
        source: 'Cash Book',
        referenceNo: payload.referenceNo || '',
        notes: 'Auto from Cash Book: ' + (payload.category || '') + (payload.notes ? ' — ' + payload.notes : '')
      }, firmId);
    }
  }
  return obj;
}

/* ===================== DASHBOARD ===================== */
function computeDashboard(d) {
  const sum = (arr, f) => (arr || []).reduce((a, r) => a + store.num(r[f]), 0);
  const cashIn  = (d.cashBook || []).filter(r => String(r.Type).toUpperCase() === 'IN').reduce((a, r) => a + store.num(r.Amount), 0);
  const cashOut = (d.cashBook || []).filter(r => String(r.Type).toUpperCase() === 'OUT').reduce((a, r) => a + store.num(r.Amount), 0);
  const totalBilled = sum(d.bills, 'TotalAmount');
  const totalIn  = sum(d.paymentsIn, 'Amount');
  const totalOut = sum(d.expensesOut, 'Amount');
  const gstCollected = (d.bills || []).reduce((a, r) => a + (store.num(r.TotalAmount) - store.num(r.BaseAmount)), 0);
  const dir = computeDirectorsSummary(d.directorsBook);
  return {
    totalWorkOrders: sum(d.workOrders, 'TotalAmount'),
    totalPurchaseOrders: sum(d.purchaseOrders, 'Amount'),
    totalBilled: totalBilled,
    totalPurchaseBills: sum(d.purchaseBills, 'TotalAmount'),
    purchaseBillGstInput: (d.purchaseBills || []).reduce((a, r) => a + (store.num(r.TotalAmount) - store.num(r.BaseAmount)), 0),
    itcPendingPurchaseBills: (d.purchaseBills || []).filter(r => String(r.ITCStatus) !== 'Received').length,
    totalPaymentsIn: totalIn,
    totalExpensesOut: totalOut,
    netPayments: totalIn - totalOut,
    cashIn: cashIn,
    cashOut: cashOut,
    cashBalance: cashIn - cashOut,
    receivable: totalBilled - totalIn,
    payable: sum(d.purchaseOrders, 'Amount') - totalOut,
    gstOutputCollected: gstCollected,
    gstr1PendingBills: (d.bills || []).filter(r => String(r.GSTR1Filed) !== 'Yes').length,
    itcPendingExpenses: (d.expensesOut || []).filter(r => String(r.ITCStatus) !== 'Received').length,
    openWorkOrders: (d.workOrders || []).filter(r => ['Open', 'In Progress'].indexOf(String(r.Status)) > -1).length,
    pendingQuotations: (d.quotations || []).filter(r => ['Draft', 'Sent'].indexOf(String(r.Status)) > -1).length,
    inventoryItems: (d.inventory || []).length,
    lowStockItems: (d.inventory || []).filter(r => store.num(r.MinStock) > 0 && store.num(r.StockQty) <= store.num(r.MinStock)).length,
    directorsNet: dir.totalIn - dir.totalOut
  };
}
function computeDirectorsSummary(entries) {
  const summary = {};
  let totalIn = 0, totalOut = 0;
  (entries || []).forEach(e => {
    const name = e.Director || 'Unknown';
    if (!summary[name]) summary[name] = { name: name, in: 0, out: 0, balance: 0 };
    if (String(e.Type).toUpperCase() === 'IN') summary[name].in += store.num(e.Amount);
    else summary[name].out += store.num(e.Amount);
    summary[name].balance = summary[name].in - summary[name].out;
  });
  Object.keys(summary).forEach(k => { totalIn += summary[k].in; totalOut += summary[k].out; });
  return { byDirector: Object.keys(summary).map(k => summary[k]), totalIn: totalIn, totalOut: totalOut };
}

/* ===================== INITIAL DATA ===================== */
async function getInitialData(firmId, forceRefresh) {
  await whenSchemaReady();
  const activeFirmId = firmId || await getActiveFirmId();
  await setActiveFirm(activeFirmId);

  const keys = Object.keys(STATE_KEY_MAP);
  const results = await Promise.all(keys.map(key => store.rowsToObjects(key, activeFirmId)));
  const data = {};
  keys.forEach((key, i) => { data[STATE_KEY_MAP[key]] = results[i]; });

  data.dashboard = computeDashboard(data);
  data.company = getFirm(activeFirmId);
  data.firms = FIRMS.map(f => ({ id: f.id, name: f.name }));
  data.activeFirmId = activeFirmId;
  data.directors = DIRECTORS.map(d => d.name);
  data.directorsSummary = computeDirectorsSummary(data.directorsBook);
  data.attachmentsFolder = { name: 'Database-backed attachments', url: '/attachments/' };
  data.spreadsheetUrl = '';
  data.spreadsheetName = 'Cloud Postgres database (Neon)';
  data._fromCache = false;
  return data;
}

/* ===================== CUSTOMER LEDGER ===================== */
async function getCustomerLedger(customerId, firmId) {
  const activeFirmId = firmId || await getActiveFirmId();
  const customers = await store.rowsToObjects('Customers', activeFirmId);
  const customer = customers.filter(c => String(c.CustomerId) === String(customerId))[0] || null;
  const bills = (await store.rowsToObjects('Bills', activeFirmId)).filter(b => String(b.CustomerId) === String(customerId));
  const payments = (await store.rowsToObjects('PaymentsIn', activeFirmId)).filter(p => String(p.CustomerId) === String(customerId));
  let entries = [];
  bills.forEach(b => entries.push({
    Date: b.Date, Type: 'Bill', RefNo: b.BillNo,
    Description: b.Description || ('Bill ' + b.BillNo),
    Debit: store.num(b.TotalAmount), Credit: 0
  }));
  payments.forEach(p => entries.push({
    Date: p.Date, Type: 'Payment', RefNo: p.ReferenceNo || p.PaymentInId,
    Description: (p.Mode || 'Payment') + (p.Notes ? ' — ' + p.Notes : ''),
    Debit: 0, Credit: store.num(p.Amount)
  }));
  entries.sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
  let bal = 0;
  entries.forEach(e => { bal += e.Debit - e.Credit; e.Balance = bal; });
  const totalDebit  = entries.reduce((a, e) => a + e.Debit, 0);
  const totalCredit = entries.reduce((a, e) => a + e.Credit, 0);
  return {
    customer: customer,
    entries: entries,
    summary: { totalDebit: totalDebit, totalCredit: totalCredit, closingBalance: totalDebit - totalCredit }
  };
}

/* ===================== BANK STATEMENT PROCESSING ===================== */
async function processBankStatement(transactions, firmId) {
  const activeFirmId = firmId || await getActiveFirmId();
  let paymentsIn = 0, expensesOut = 0, directorEntries = 0;
  const errors = [];
  let rowNo = 0;
  for (const t of (transactions || [])) {
    rowNo++;
    try {
      const amount = store.num(t.amount);
      if (!(amount > 0)) throw new Error('amount missing/zero');
      const date = String(t.date || store.today());
      const desc = String(t.description || '');
      const ref  = String(t.referenceNo || '');
      const hay  = desc + ' ' + ref;
      const mode     = String(t.mode || 'Online');
      const category = String(t.category || 'Bank Debit');

      const director = t.detectedDirector ? String(t.detectedDirector) : matchDirector(hay);
      if (director) {
        await store.addRecord('DirectorsBook', {
          date: date, director: director,
          type: String(t.direction) === 'Credit' ? 'IN' : 'OUT',
          amount: amount, source: 'Bank Statement',
          referenceNo: ref, notes: desc
        }, activeFirmId);
        directorEntries++;
        continue;
      }
      if (String(t.direction) === 'Credit') {
        let cid = String(t.customerId || '');
        if (!cid) cid = await findRefIdByNameInText('Customers', 'CustomerId', hay, activeFirmId);
        if (!cid && t.customerName) cid = await resolveRefId('Customers', 'CustomerId', String(t.customerName), activeFirmId);
        await store.addRecord('PaymentsIn', { date: date, customerId: cid, mode: mode, referenceNo: ref, amount: amount, notes: desc }, activeFirmId);
        paymentsIn++;
        continue;
      }
      if (String(t.direction) === 'Debit') {
        let sid = String(t.supplierId || '');
        if (!sid) sid = await findRefIdByNameInText('Suppliers', 'SupplierId', hay, activeFirmId);
        if (!sid && t.supplierName) sid = await resolveRefId('Suppliers', 'SupplierId', String(t.supplierName), activeFirmId);
        await store.addRecord('ExpensesOut', { date: date, supplierId: sid, category: category, mode: mode, referenceNo: ref, amount: amount, notes: desc }, activeFirmId);
        expensesOut++;
        continue;
      }
      throw new Error('direction unknown');
    } catch (e) {
      errors.push('Row ' + rowNo + ': ' + e.message);
    }
  }
  return { paymentsIn, expensesOut, directorEntries, errors };
}

/* ===================== BULK UPLOAD ===================== */
// Common alternate header spellings people use in their own spreadsheets,
// beyond the exact template column names (which already match via normKey).
const HEADER_ALIASES = {
  Name: ['companyname', 'customername', 'suppliername', 'fullname', 'partyname', 'firmname'],
  ContactPerson: ['contact', 'contactname', 'personname', 'contactpersonname'],
  Phone: ['mobile', 'mobileno', 'mobilenumber', 'phoneno', 'phonenumber', 'contactno', 'contactnumber', 'whatsapp'],
  GSTNumber: ['gst', 'gstno', 'gstin'],
  Email: ['emailid', 'emailaddress', 'mail', 'mailid'],
  Address: ['add', 'fulladdress', 'location'],
  Description: ['particulars', 'details', 'scope', 'scopeofwork', 'item', 'workdescription'],
  BaseAmount: ['amount', 'taxableamount', 'baseamt', 'value'],
  GSTPercent: ['gst', 'gstrate', 'taxrate', 'gstpercentage'],
  Amount: ['amt', 'value', 'total', 'totalamount'],
  BillNo: ['invoiceno', 'invoicenumber', 'billnumber', 'billno'],
  QuotationNo: ['quoteno', 'quotationnumber', 'refno', 'referenceno'],
  WorkOrderNo: ['workorderno', 'wono', 'orderno'],
  PurchaseOrderNo: ['purchaseorderno', 'pono', 'orderno'],
  CustomerId: ['customer', 'customername', 'client', 'clientname'],
  SupplierId: ['supplier', 'suppliername', 'vendor', 'vendorname'],
  DueDate: ['due', 'duedate', 'dueon'],
  Date: ['billdate', 'invoicedate', 'entrydate', 'transactiondate', 'txndate'],
  Status: ['stage'],
  Notes: ['note', 'remark', 'remarks', 'comments', 'comment'],
  ItemName: ['item', 'itemdescription', 'productname', 'product'],
  Rate: ['price', 'unitprice', 'unitrate']
};
async function bulkInsert(key, records, firmId) {
  const cfg = SHEETS[key];
  if (!records.length) return { count: 0, missingColumns: [] };
  let next = await store.nextIdNum(key, firmId);
  let count = 0;
  const directorAuto = [];
  const matchedCols = new Set();
  for (const rec of records) {
    const norm = {};
    Object.keys(rec || {}).forEach(k => { norm[store.normKey(k)] = rec[k]; });
    const payload = {};
    Object.keys(cfg.fieldMap).forEach(camel => {
      const col = cfg.fieldMap[camel];
      let matched;
      if (norm[store.normKey(col)] !== undefined) matched = norm[store.normKey(col)];
      else if (norm[store.normKey(camel)] !== undefined) matched = norm[store.normKey(camel)];
      else {
        const aliases = HEADER_ALIASES[col] || [];
        for (const a of aliases) { if (norm[a] !== undefined) { matched = norm[a]; break; } }
      }
      if (matched !== undefined) { payload[camel] = matched; matchedCols.add(col); }
    });
    if (payload.customerId !== undefined) payload.customerId = await resolveRefId('Customers', 'CustomerId', payload.customerId, firmId);
    if (payload.supplierId !== undefined) payload.supplierId = await resolveRefId('Suppliers', 'SupplierId', payload.supplierId, firmId);
    if (payload.director  !== undefined) payload.director  = resolveDirectorName(payload.director);

    const meaningful = Object.keys(payload).some(k => String(payload[k]).trim() !== '');
    if (!meaningful) continue;

    const id = store.makeId(cfg, next++);
    await store.addRecord(key, payload, firmId, { id });
    count++;

    if (key === 'CashBook') {
      const d = matchDirector([payload.category, payload.referenceNo, payload.notes].join(' '));
      if (d) directorAuto.push({
        date: payload.date || store.today(), director: d,
        type: String(payload.type).toUpperCase() === 'OUT' ? 'OUT' : 'IN',
        amount: store.num(payload.amount), source: 'Cash Book (Bulk)',
        referenceNo: payload.referenceNo || '',
        notes: 'Auto from Cash Book bulk: ' + (payload.category || '')
      });
    }
  }
  if (directorAuto.length) await bulkInsert('DirectorsBook', directorAuto, firmId);
  const missingColumns = (cfg.bulkColumns || []).filter(c => c !== 'Notes' && !matchedCols.has(c));
  return { count, missingColumns };
}
async function bulkUploadRecords(entityMap, firmId) {
  const activeFirmId = firmId || await getActiveFirmId();
  const inserted = {};
  const errors = [];
  for (const entityName of Object.keys(entityMap || {})) {
    if (!SHEETS[entityName]) { errors.push('Unknown sheet "' + entityName + '" — skipped.'); continue; }
    try {
      const res = await bulkInsert(entityName, entityMap[entityName] || [], activeFirmId);
      inserted[entityName] = res.count;
      if (res.missingColumns.length) errors.push(entityName + ': could not match column(s) ' + res.missingColumns.join(', ') + ' — those fields were left blank.');
    } catch (e) {
      errors.push(entityName + ': ' + e.message);
      inserted[entityName] = 0;
    }
  }
  return { inserted, errors };
}
async function bulkUploadEntityRecords(entityName, records, firmId) {
  const activeFirmId = firmId || await getActiveFirmId();
  if (!SHEETS[entityName]) throw new Error('Unknown segment "' + entityName + '".');
  const res = await bulkInsert(entityName, records || [], activeFirmId);
  return { inserted: res.count, missingColumns: res.missingColumns };
}

/* ===================== SETUP / INFO / DIAGNOSTICS ===================== */
async function setupKgsWorkbook(firmId) {
  const activeFirmId = firmId || FIRMS[0].id;
  await setActiveFirm(activeFirmId);
  await ensureSchema(); // idempotent — safe to call anytime
  const firm = getFirm(activeFirmId);
  return { ok: true, message: 'Setup complete for ' + firm.name + '. Cloud database is ready.' };
}
async function getBackingSpreadsheetInfo(firmId) {
  return {
    name: 'Cloud Postgres database (Neon)',
    url: '',
    sharedName: 'Shared tables (Customers & Suppliers)',
    sharedUrl: '',
    attachmentsFolder: { name: 'Database-backed attachments', url: '/attachments/' }
  };
}
async function getAttachmentsFolderInfo() {
  return { name: 'Database-backed attachments', url: '/attachments/' };
}
async function getDiagnostics(firmId) {
  const activeFirmId = firmId || await getActiveFirmId();
  const sheets = [];
  for (const key of Object.keys(SHEETS)) {
    const cfg = SHEETS[key];
    const rows = await store.rowsToObjects(key, activeFirmId);
    let amountCheck = null;
    if (cfg.columns.indexOf('Amount') > -1 && rows.length > 0) {
      const raw = rows.slice(0, 3).map(r => r.Amount);
      amountCheck = { rawSampleValues: raw, parsedSum: rows.reduce((a, r) => a + store.num(r.Amount), 0) };
    }
    sheets.push({ expectedName: cfg.name, exists: true, rowCount: rows.length, header: cfg.columns, amountCheck });
  }
  return {
    spreadsheetName: 'Cloud Postgres database (Neon)',
    spreadsheetUrl: '',
    allTabsInFile: Object.keys(SHEETS).map(k => SHEETS[k].name),
    sheets
  };
}

module.exports = {
  whenSchemaReady,
  getActiveFirmId, setActiveFirm,
  addRecordWithSideEffects,
  getInitialData, getCustomerLedger,
  processBankStatement, bulkUploadRecords, bulkUploadEntityRecords,
  setupKgsWorkbook, getBackingSpreadsheetInfo, getAttachmentsFolderInfo, getDiagnostics,
  resolveDirectorName
};
