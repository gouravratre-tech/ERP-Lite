const store = require('./store');
const logic = require('./logic');

async function firm(explicit) {
  return explicit || await logic.getActiveFirmId();
}

const registry = {};

registry.setActiveFirm = (firmId) => logic.setActiveFirm(firmId);
registry.getInitialData = (firmId, forceRefresh) => logic.getInitialData(firmId, forceRefresh);
registry.setupKgsWorkbook = (firmId) => logic.setupKgsWorkbook(firmId);
registry.getBackingSpreadsheetInfo = (firmId) => logic.getBackingSpreadsheetInfo(firmId);
registry.getAttachmentsFolderInfo = () => logic.getAttachmentsFolderInfo();
registry.getDiagnostics = (firmId) => logic.getDiagnostics(firmId);
registry.getCustomerLedger = async (customerId) => logic.getCustomerLedger(customerId, await firm());

function crud(entityKey) {
  return {
    add: async (p) => logic.addRecordWithSideEffects(entityKey, p, await firm()),
    update: async (p) => store.updateRecord(entityKey, p, await firm()),
    del: async (id) => store.deleteRecord(entityKey, id, await firm())
  };
}

const c = {
  Customers: crud('Customers'), Suppliers: crud('Suppliers'),
  WorkOrders: crud('WorkOrders'), PurchaseOrders: crud('PurchaseOrders'),
  Inventory: crud('Inventory'), PaymentsIn: crud('PaymentsIn'),
  ExpensesOut: crud('ExpensesOut'), CashBook: crud('CashBook'),
  Quotations: crud('Quotations'), Bills: crud('Bills'),
  PurchaseBills: crud('PurchaseBills'), GstReturns: crud('GstReturns')
};

registry.addCustomer = c.Customers.add;       registry.updateCustomer = c.Customers.update;       registry.deleteCustomer = c.Customers.del;
registry.addSupplier = c.Suppliers.add;       registry.updateSupplier = c.Suppliers.update;       registry.deleteSupplier = c.Suppliers.del;
registry.addWorkOrder = c.WorkOrders.add;     registry.updateWorkOrder = c.WorkOrders.update;     registry.deleteWorkOrder = c.WorkOrders.del;
registry.addPurchaseOrder = c.PurchaseOrders.add; registry.updatePurchaseOrder = c.PurchaseOrders.update; registry.deletePurchaseOrder = c.PurchaseOrders.del;
registry.addInventoryItem = c.Inventory.add;  registry.updateInventoryItem = c.Inventory.update;  registry.deleteInventoryItem = c.Inventory.del;
registry.addPaymentIn = c.PaymentsIn.add;     registry.updatePaymentIn = c.PaymentsIn.update;     registry.deletePaymentIn = c.PaymentsIn.del;
registry.addExpenseOut = c.ExpensesOut.add;   registry.updateExpenseOut = c.ExpensesOut.update;   registry.deleteExpenseOut = c.ExpensesOut.del;
registry.addCashEntry = c.CashBook.add;       registry.updateCashEntry = c.CashBook.update;       registry.deleteCashEntry = c.CashBook.del;
registry.addQuotation = c.Quotations.add;     registry.updateQuotation = c.Quotations.update;     registry.deleteQuotation = c.Quotations.del;
registry.addBill = c.Bills.add;               registry.updateBill = c.Bills.update;               registry.deleteBill = c.Bills.del;
registry.addPurchaseBill = c.PurchaseBills.add; registry.updatePurchaseBill = c.PurchaseBills.update; registry.deletePurchaseBill = c.PurchaseBills.del;
registry.addGstReturn = c.GstReturns.add;     registry.updateGstReturn = c.GstReturns.update;     registry.deleteGstReturn = c.GstReturns.del;

registry.addDirectorEntry = async (p) => {
  p = p || {};
  if (p.director) p.director = logic.resolveDirectorName(p.director);
  return logic.addRecordWithSideEffects('DirectorsBook', p, await firm());
};
registry.updateDirectorEntry = async (p) => {
  if (p && p.director) p.director = logic.resolveDirectorName(p.director);
  return store.updateRecord('DirectorsBook', p, await firm());
};
registry.deleteDirectorEntry = async (id) => store.deleteRecord('DirectorsBook', id, await firm());

registry.updateBillGstr1Status = async (p) => store.setSingleField('Bills', p.billId, 'GSTR1Filed', p.gstr1Filed === 'Yes' ? 'Yes' : 'No', await firm());
registry.updateExpenseItcStatus = async (p) => {
  const allowed = ['Pending', 'Received', 'Not Received'];
  const v = allowed.indexOf(p.itcStatus) > -1 ? p.itcStatus : 'Pending';
  return store.setSingleField('ExpensesOut', p.expenseId, 'ITCStatus', v, await firm());
};
registry.updatePurchaseBillItcStatus = async (p) => {
  const allowed = ['Pending', 'Received', 'Not Received'];
  const v = allowed.indexOf(p.itcStatus) > -1 ? p.itcStatus : 'Pending';
  return store.setSingleField('PurchaseBills', p.purchaseBillId, 'ITCStatus', v, await firm());
};

registry.processBankStatement = async (transactions) => logic.processBankStatement(transactions, await firm());
registry.bulkUploadRecords = async (entityMap) => logic.bulkUploadRecords(entityMap, await firm());
registry.bulkUploadEntityRecords = async (entityName, records) => logic.bulkUploadEntityRecords(entityName, records, await firm());

async function callRpc(fnName, args) {
  const fn = registry[fnName];
  if (typeof fn !== 'function') {
    throw new Error('Unknown server function: ' + fnName);
  }
  return fn.apply(null, args || []);
}

module.exports = { callRpc };
