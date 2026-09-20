const cafeStateStorageKey = 'cafeAppState';

window.cafeState = {
  selectedTable: null,
  orderItems: [],
  selectedPaymentMethod: null,
  transferConfirmed: false,
  pendingBills: [],
  billHistory: [],
  isLoggedIn: false,
  totalRevenue: 0,
  tableOrders: {},
  customQrImage: 'image/qr.jpg',
  defaultQrImage: 'image/qr.jpg'
};

const savedState = (() => {
  try {
    const raw = sessionStorage.getItem(cafeStateStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
})();

if (savedState) {
  window.cafeState = {
    ...window.cafeState,
    ...savedState,
    pendingBills: Array.isArray(savedState.pendingBills) ? savedState.pendingBills : [],
    billHistory: Array.isArray(savedState.billHistory) ? savedState.billHistory : [],
    orderItems: Array.isArray(savedState.orderItems) ? savedState.orderItems : [],
    tableOrders: savedState.tableOrders && typeof savedState.tableOrders === 'object' ? savedState.tableOrders : {},
    totalRevenue: Number(savedState.totalRevenue) || 0,
    isLoggedIn: Boolean(savedState.isLoggedIn)
  };
}

window.cafeState.persist = function persistState() {
  const snapshot = {
    ...window.cafeState,
    selectedTable: window.cafeState.selectedTable
      ? { id: window.cafeState.selectedTable.id, name: window.cafeState.selectedTable.name }
      : null
  };

  sessionStorage.setItem(cafeStateStorageKey, JSON.stringify(snapshot));
};

window.cafeUtils = {
  formatMoney(amount) {
    const safeAmount = Number(amount) || 0;
    return safeAmount.toLocaleString('vi-VN') + 'đ';
  },

  getTotal(orderItems) {
    return Array.isArray(orderItems)
      ? orderItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0)
      : 0;
  }
};
