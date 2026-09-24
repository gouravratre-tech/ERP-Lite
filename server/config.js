/**********************************************************************
 * KGS ENGINEERING WORKS — ERP LITE — Local Edition
 * config.js — ported directly from the original Code.gs SETTINGS block.
 * Edit FIRMS / DIRECTORS here exactly like you used to edit Code.gs.
 **********************************************************************/

const FIRMS = [
  {
    id: 'kgs',
    name: 'KGS ENGINEERING WORKS',
    tagline: 'Electrical • Mechanical • Civil Contracts',
    addressLines: ['123, Industrial Area, Scheme No. 78', 'Indore, Madhya Pradesh – 452010'],
    gstin: '23ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    stateName: 'Madhya Pradesh',
    stateCode: '23',
    phone: '+91 90000 00000',
    email: 'kgsengineeringworks@gmail.com',
    bank: { name: 'STATE BANK OF INDIA', branch: 'Indore Main Branch', account: '00000000000000', ifsc: 'SBIN0000000' },
    invoiceTerms: [
      'Payment due within 15 days of invoice date.',
      'Goods once sold will not be taken back or exchanged.',
      'Interest @18% p.a. will be charged on delayed payments.',
      'Subject to Indore jurisdiction only.'
    ],
    quotationTerms: [
      'Prices are valid for 30 days from the quotation date.',
      'GST extra as applicable at the time of billing.',
      'Delivery / execution as per mutually agreed schedule.',
      'Payment terms: 50% advance with order, balance on completion.'
    ]
  },
  {
    id: 'hew',
    name: 'Hindustaan Engineering Works LLP',
    tagline: '',
    addressLines: ['Address Line 1', 'City, State – Pincode'],
    gstin: '',
    pan: '',
    stateName: '',
    stateCode: '',
    phone: '',
    email: '',
    bank: { name: '', branch: '', account: '', ifsc: '' },
    invoiceTerms: [
      'Payment due within 15 days of invoice date.',
      'Subject to jurisdiction only.'
    ],
    quotationTerms: [
      'Prices are valid for 30 days from the quotation date.',
      'GST extra as applicable at the time of billing.'
    ]
  }
];

function getFirm(firmId) {
  return FIRMS.filter(f => f.id === firmId)[0] || FIRMS[0];
}

const DIRECTORS = [
  { name: 'Narayan Prasad Ratre', aliases: ['NARAYAN PRASAD RATRE', 'NARAYAN P RATRE', 'N P RATRE', 'NARAYAN RATRE', 'NARAYAN PRASAD'] },
  { name: 'Kamal Prasad Ratre',   aliases: ['KAMAL PRASAD RATRE', 'KAMAL P RATRE', 'K P RATRE', 'KAMAL RATRE', 'KAMAL PRASAD'] },
  { name: 'Gourav Prasad Ratre',  aliases: ['GOURAV PRASAD RATRE', 'GOURAV P RATRE', 'G P RATRE', 'GAURAV PRASAD RATRE', 'GAURAV P RATRE', 'GAURAV RATRE', 'GOURAV RATRE', 'GOURAV PRASAD', 'GAURAV PRASAD'] }
];

// Sheets that are SHARED across all firms (Customers & Suppliers) — one copy, no FirmId filter
const SHARED_SHEETS = ['Customers', 'Suppliers'];

const MAX_ATTACHMENT_MB = 10;

/* ===================== "SHEET" SCHEMAS (now SQLite tables) ===================== */
const SHEETS = {
  Customers:      { name:'Customers',      idField:'CustomerId',      prefix:'CUST',
    columns:['CustomerId','Name','ContactPerson','Phone','GSTNumber','Email','Address','Status','Notes','CreatedDate'],
    fieldMap:{ name:'Name', contactPerson:'ContactPerson', phone:'Phone', gstNumber:'GSTNumber', email:'Email', address:'Address', status:'Status', notes:'Notes' } },
  Suppliers:      { name:'Suppliers',      idField:'SupplierId',      prefix:'SUPP',
    columns:['SupplierId','Name','ContactPerson','Phone','GSTNumber','Email','Address','Status','Notes','CreatedDate'],
    fieldMap:{ name:'Name', contactPerson:'ContactPerson', phone:'Phone', gstNumber:'GSTNumber', email:'Email', address:'Address', status:'Status', notes:'Notes' } },
  WorkOrders:     { name:'WorkOrders',     idField:'WorkOrderId',     prefix:'WO',  numeric:['BaseAmount','GSTPercent','TotalAmount'], attachment:true,
    columns:['WorkOrderId','Date','CustomerId','WorkOrderNo','Description','BaseAmount','GSTPercent','TotalAmount','DueDate','Status','AttachmentUrl','Notes','CreatedDate'],
    fieldMap:{ date:'Date', customerId:'CustomerId', workOrderNo:'WorkOrderNo', description:'Description', baseAmount:'BaseAmount', gstPercent:'GSTPercent', dueDate:'DueDate', status:'Status', notes:'Notes' } },
  PurchaseOrders: { name:'PurchaseOrders', idField:'PurchaseOrderId', prefix:'PO',  numeric:['Amount'], attachment:true,
    columns:['PurchaseOrderId','Date','SupplierId','PurchaseOrderNo','Description','Amount','DueDate','Status','AttachmentUrl','Notes','CreatedDate'],
    fieldMap:{ date:'Date', supplierId:'SupplierId', purchaseOrderNo:'PurchaseOrderNo', description:'Description', amount:'Amount', dueDate:'DueDate', status:'Status', notes:'Notes' } },
  Inventory:      { name:'Inventory',      idField:'ItemId',          prefix:'INV', numeric:['Rate','StockQty','MinStock','GSTPercent'],
    columns:['ItemId','ItemName','Category','Unit','Rate','StockQty','MinStock','GSTPercent','Description','Notes','CreatedDate'],
    fieldMap:{ itemName:'ItemName', category:'Category', unit:'Unit', rate:'Rate', stockQty:'StockQty', minStock:'MinStock', gstPercent:'GSTPercent', description:'Description', notes:'Notes' } },
  PaymentsIn:     { name:'PaymentsIn',     idField:'PaymentInId',     prefix:'PIN', numeric:['Amount'],
    columns:['PaymentInId','Date','CustomerId','BillId','Mode','ReferenceNo','Amount','Notes','CreatedDate'],
    fieldMap:{ date:'Date', customerId:'CustomerId', billId:'BillId', mode:'Mode', referenceNo:'ReferenceNo', amount:'Amount', notes:'Notes' } },
  ExpensesOut:    { name:'ExpensesOut',    idField:'ExpenseId',       prefix:'EXP', numeric:['Amount'],
    columns:['ExpenseId','Date','SupplierId','Category','Mode','ReferenceNo','Amount','ITCStatus','Notes','CreatedDate'],
    fieldMap:{ date:'Date', supplierId:'SupplierId', category:'Category', mode:'Mode', referenceNo:'ReferenceNo', amount:'Amount', itcStatus:'ITCStatus', notes:'Notes' } },
  CashBook:       { name:'CashBook',       idField:'CashEntryId',     prefix:'CASH', numeric:['Amount'],
    columns:['CashEntryId','Date','Type','Category','ReferenceNo','Amount','Notes','CreatedDate'],
    fieldMap:{ date:'Date', type:'Type', category:'Category', referenceNo:'ReferenceNo', amount:'Amount', notes:'Notes' } },
  Quotations:     { name:'Quotations',     idField:'QuotationId',     prefix:'QT',  numeric:['Amount'], attachment:true,
    columns:['QuotationId','Date','CustomerId','QuotationNo','Description','Items','Amount','Status','AttachmentUrl','Notes','CreatedDate'],
    fieldMap:{ date:'Date', customerId:'CustomerId', quotationNo:'QuotationNo', description:'Description', items:'Items', amount:'Amount', status:'Status', notes:'Notes' } },
  Bills:          { name:'Bills',          idField:'BillId',          prefix:'BILL', numeric:['BaseAmount','GSTPercent','TotalAmount'], attachment:true,
    columns:['BillId','Date','CustomerId','BillNo','Description','Items','BaseAmount','GSTPercent','TotalAmount','Status','GSTR1Filed','AttachmentUrl','Notes','CreatedDate'],
    fieldMap:{ date:'Date', customerId:'CustomerId', billNo:'BillNo', description:'Description', items:'Items', baseAmount:'BaseAmount', gstPercent:'GSTPercent', status:'Status', notes:'Notes' } },
  PurchaseBills:  { name:'PurchaseBills', idField:'PurchaseBillId', prefix:'PBILL', numeric:['BaseAmount','GSTPercent','TotalAmount'], attachment:true,
    columns:['PurchaseBillId','Date','SupplierId','BillNo','Description','BaseAmount','GSTPercent','TotalAmount','Status','ITCStatus','AttachmentUrl','Notes','CreatedDate'],
    fieldMap:{ date:'Date', supplierId:'SupplierId', billNo:'BillNo', description:'Description', baseAmount:'BaseAmount', gstPercent:'GSTPercent', status:'Status', itcStatus:'ITCStatus', notes:'Notes' } },
  GstReturns:     { name:'GstReturns',     idField:'GstReturnId',     prefix:'GSTR',
    columns:['GstReturnId','Period','GSTR1Status','GSTR1FiledDate','GSTR3BStatus','GSTR3BFiledDate','Notes','CreatedDate'],
    fieldMap:{ period:'Period', gstr1Status:'GSTR1Status', gstr1FiledDate:'GSTR1FiledDate', gstr3bStatus:'GSTR3BStatus', gstr3bFiledDate:'GSTR3BFiledDate', notes:'Notes' } },
  DirectorsBook:  { name:'DirectorsBook',  idField:'DirectorEntryId', prefix:'DIR', numeric:['Amount'],
    columns:['DirectorEntryId','Date','Director','Type','Amount','Source','ReferenceNo','Notes','CreatedDate'],
    fieldMap:{ date:'Date', director:'Director', type:'Type', amount:'Amount', source:'Source', referenceNo:'ReferenceNo', notes:'Notes' } }
};

const STATE_KEY_MAP = {
  Customers:'customers', Suppliers:'suppliers', WorkOrders:'workOrders', PurchaseOrders:'purchaseOrders',
  Inventory:'inventory',
  PaymentsIn:'paymentsIn', ExpensesOut:'expensesOut', CashBook:'cashBook', Quotations:'quotations',
  Bills:'bills', PurchaseBills:'purchaseBills', GstReturns:'gstReturns', DirectorsBook:'directorsBook'
};

module.exports = { FIRMS, getFirm, DIRECTORS, SHARED_SHEETS, MAX_ATTACHMENT_MB, SHEETS, STATE_KEY_MAP };
