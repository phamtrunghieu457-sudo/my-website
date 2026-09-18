window.APP_CONFIG = window.APP_CONFIG || { API_BASE_URL: 'http://localhost:3001' };
const API_BASE_URL = window.APP_CONFIG.API_BASE_URL || 'http://localhost:3001';

const state = window.cafeState;
const { formatMoney, getTotal } = window.cafeUtils;

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'API request failed');
  }

  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

function getTables() {
  return Array.isArray(window.cafeData.tables) ? window.cafeData.tables : [];
}

function getMenuItems() {
  return Array.isArray(window.cafeData.menuItems) ? window.cafeData.menuItems : [];
}

function persistCafeState() {
  if (state && typeof state.persist === 'function') {
    state.persist();
  }
}

function syncTableStatuses() {
  window.cafeData.tables = getTables().map((table) => ({
    ...table,
    status: state.tableOrders[table.id] && state.tableOrders[table.id].length > 0 ? 'occupied' : 'empty'
  }));
  localStorage.setItem('cafeTables', JSON.stringify(window.cafeData.tables));
}

function restorePersistedView() {
  const tables = getTables();
  if (!state.selectedTable || !Array.isArray(tables)) return;

  const selectedTable = tables.find((table) => table.id === Number(state.selectedTable.id));
  if (selectedTable) {
    state.selectedTable = selectedTable;
    state.orderItems = Array.isArray(state.tableOrders[selectedTable.id]) ? [...state.tableOrders[selectedTable.id]] : [];
  } else {
    state.selectedTable = null;
    state.orderItems = [];
  }
}

function saveMenuToStorage() {
  localStorage.setItem('cafeMenu', JSON.stringify(getMenuItems()));
}

function saveTablesToStorage() {
  localStorage.setItem('cafeTables', JSON.stringify(getTables()));
}

async function hydrateStaticData() {
  try {
    const menuData = await apiRequest('/api/menu');
    if (Array.isArray(menuData) && menuData.length) {
      window.cafeData.menuItems = menuData;
    }
  } catch (error) {
    console.warn('API menu không khả dụng, dùng localStorage:', error);
  }

  try {
    const tableData = await apiRequest('/api/tables');
    if (Array.isArray(tableData) && tableData.length) {
      window.cafeData.tables = tableData;
    }
  } catch (error) {
    console.warn('API tables không khả dụng, dùng localStorage:', error);
  }

  try {
    const savedTables = JSON.parse(localStorage.getItem('cafeTables') || 'null');
    if (Array.isArray(savedTables) && savedTables.length) {
      window.cafeData.tables = savedTables;
    } else {
      localStorage.setItem('cafeTables', JSON.stringify(window.cafeData.tables));
    }

    const savedMenu = JSON.parse(localStorage.getItem('cafeMenu') || 'null');
    if (Array.isArray(savedMenu) && savedMenu.length) {
      window.cafeData.menuItems = savedMenu;
    } else {
      localStorage.setItem('cafeMenu', JSON.stringify(window.cafeData.menuItems));
    }
  } catch (error) {
    console.warn('Không thể đọc dữ liệu localStorage:', error);
  }
}

function getTableOrder(tableId) {
  return Array.isArray(state.tableOrders[tableId]) ? [...state.tableOrders[tableId]] : [];
}

function saveTableOrder(tableId, items) {
  state.tableOrders[tableId] = Array.isArray(items) ? [...items] : [];
  if (state.selectedTable && state.selectedTable.id === tableId) {
    state.orderItems = [...state.tableOrders[tableId]];
  }
  syncTableStatuses();
  persistCafeState();
}

function showLoginScreen() {
  const loginScreen = document.getElementById('loginScreen');
  const tableScreen = document.getElementById('tableScreen');
  const mainScreen = document.getElementById('mainScreen');
  if (loginScreen) loginScreen.style.display = 'flex';
  if (tableScreen) tableScreen.style.display = 'none';
  if (mainScreen) mainScreen.style.display = 'none';
  updateUserMenuVisibility();
}

function showTableSelectionScreen() {
  const loginScreen = document.getElementById('loginScreen');
  const tableScreen = document.getElementById('tableScreen');
  const mainScreen = document.getElementById('mainScreen');
  if (loginScreen) loginScreen.style.display = 'none';
  if (tableScreen) tableScreen.style.display = 'block';
  if (mainScreen) mainScreen.style.display = 'none';
  updateUserMenuVisibility();
}

function updateUserMenuVisibility() {
  const userMenu = document.getElementById('userMenu');
  if (!userMenu) return;
  userMenu.style.display = state.isLoggedIn ? 'block' : 'none';

  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.remove('active');

  updateRevenueDisplay();
}

function updateRevenueDisplay() {
  const revenueValue = document.getElementById('revenueValue');
  if (revenueValue) {
    revenueValue.textContent = formatMoney(state.totalRevenue);
  }
}

function toggleUserDropdown() {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) {
    dropdown.classList.toggle('active');
  }
}

function logout() {
  state.isLoggedIn = false;
  state.selectedTable = null;
  state.orderItems = [];
  state.selectedPaymentMethod = null;
  state.transferConfirmed = false;
  state.pendingBills = [];
  state.tableOrders = {};
  syncTableStatuses();
  localStorage.removeItem('cafeLoggedIn');
  persistCafeState();

  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.reset();

  const messageEl = document.getElementById('loginMessage');
  if (messageEl) {
    messageEl.textContent = '';
    messageEl.className = 'auth-message';
  }

  renderTableGrid();
  updateOrderSummary();
  renderPendingBills();
  closePaymentModal();
  showLoginScreen();
}

async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const messageEl = document.getElementById('loginMessage');

  if (!username || !password) {
    messageEl.textContent = 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.';
    messageEl.className = 'auth-message error';
    return;
  }

  try {
    const result = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (!result || !result.success) {
      throw new Error(result?.message || 'Sai tài khoản hoặc mật khẩu!');
    }

    state.isLoggedIn = true;
    localStorage.setItem('cafeLoggedIn', 'true');
    persistCafeState();
    messageEl.textContent = 'Đăng nhập thành công!';
    messageEl.className = 'auth-message success';
    showTableSelectionScreen();
    return;
  } catch (error) {
    console.warn('Login API unavailable, fallback to local login:', error);
  }

  if (username !== 'admin' || password !== '123456') {
    messageEl.textContent = 'Sai tài khoản hoặc mật khẩu!';
    messageEl.className = 'auth-message error';
    return;
  }

  state.isLoggedIn = true;
  localStorage.setItem('cafeLoggedIn', 'true');
  persistCafeState();
  messageEl.textContent = 'Đăng nhập thành công!';
  messageEl.className = 'auth-message success';
  showTableSelectionScreen();
}

function buildDailyRevenuePoints() {
  const map = new Map();

  state.billHistory.forEach((bill) => {
    const dateKey = new Date(bill.createdAt).toISOString().slice(0, 10);
    const current = map.get(dateKey) || 0;
    map.set(dateKey, current + Number(bill.total || 0));
  });

  return Array.from(map.entries()).map(([date, total]) => ({
    date,
    total
  })).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function renderDailyRevenueChart(points = []) {
  const canvas = document.getElementById('dailyRevenueChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const safePoints = Array.isArray(points) && points.length ? points : buildDailyRevenuePoints();
  const ctx = canvas.getContext('2d');
  const labels = safePoints.map((point) => new Date(point.date).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit'
  }));
  const values = safePoints.map((point) => Number(point.total || 0));

  if (window.dailyRevenueChartInstance) {
    window.dailyRevenueChartInstance.destroy();
  }

  window.dailyRevenueChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Doanh thu theo ngày',
        data: values,
        backgroundColor: 'rgba(59, 130, 246, 0.7)',
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => `${Number(value).toLocaleString('vi-VN')}đ`
          }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function loadDailyRevenueChart() {
  renderDailyRevenueChart(buildDailyRevenuePoints());
}

function renderPendingBills() {
  const list = document.getElementById('pendingBillsList');
  if (!list) return;

  if (!state.pendingBills.length) {
    list.innerHTML = '<div class="bill-empty">Chưa có bill nào đang chờ pha chế.</div>';
    return;
  }

  list.innerHTML = state.pendingBills.map((bill) => `
    <div class="bill-card">
      <div class="bill-header">
        <span class="bill-table">${bill.tableName}</span>
        <span class="bill-total">${formatMoney(bill.total)}</span>
      </div>
      <ul class="bill-items">
        ${bill.items.map((item) => `
          <li class="bill-item">
            <span>${item.icon || '☕'} ${item.name} x${item.quantity}</span>
            <span>${formatMoney(Number(item.price || 0) * Number(item.quantity || 0))}</span>
          </li>
          ${item.note ? `<li class="bill-note">Ghi chú: ${item.note}</li>` : ''}
        `).join('')}
      </ul>
      <button class="bill-action" onclick="completePendingBill(${bill.id})">✅ Hoàn thành bill</button>
    </div>
  `).join('');
}

function completePendingBill(billId) {
  const bill = state.pendingBills.find((item) => item.id === billId);
  if (bill && bill.tableId) {
    const table = getTables().find((item) => item.id === bill.tableId);
    if (table) {
      table.status = 'empty';
    }
  }

  state.pendingBills = state.pendingBills.filter((item) => item.id !== billId);
  syncTableStatuses();
  persistCafeState();
  renderTableGrid();
  renderPendingBills();
  showToast('✅ Bill đã hoàn thành!', 'success');
}

function renderTableGrid() {
  const grid = document.getElementById('tableGrid');
  if (!grid) return;

  const tables = getTables();
  grid.innerHTML = '';

  tables.forEach((table) => {
    const tableOrders = getTableOrder(table.id);
    const isOccupied = tableOrders.length > 0 || table.status === 'occupied';
    const card = document.createElement('div');
    card.className = `table-card ${isOccupied ? 'occupied' : ''}`;
    card.innerHTML = `
      <div class="table-number">${table.name.replace('Bàn ', '')}</div>
      <div class="table-status ${isOccupied ? 'status-occupied' : 'status-empty'}">
        ${isOccupied ? '🔴 Đang chọn' : '🟢 Trống'}
      </div>
    `;

    card.addEventListener('click', () => selectTable(table));
    grid.appendChild(card);
  });
}

function selectTable(table) {
  if (state.selectedTable && state.selectedTable.id !== table.id) {
    saveTableOrder(state.selectedTable.id, state.orderItems);
  }

  state.selectedTable = table;
  state.orderItems = getTableOrder(table.id);
  persistCafeState();

  document.querySelectorAll('.table-card').forEach((card) => card.classList.remove('selected'));
  const cards = document.querySelectorAll('.table-card');
  const index = getTables().findIndex((item) => item.id === table.id);
  if (cards[index]) cards[index].classList.add('selected');

  const tableScreen = document.getElementById('tableScreen');
  const mainScreen = document.getElementById('mainScreen');
  if (tableScreen) tableScreen.style.display = 'none';
  if (mainScreen) mainScreen.style.display = 'block';

  const currentTableBadge = document.getElementById('currentTableBadge');
  if (currentTableBadge) currentTableBadge.textContent = `🪑 ${table.name}`;

  updateOrderSummary();
  showToast(`Đã chọn ${table.name}`, 'info');
}

function goBackToTables() {
  if (state.selectedTable) {
    saveTableOrder(state.selectedTable.id, state.orderItems);
  }

  const tableScreen = document.getElementById('tableScreen');
  const mainScreen = document.getElementById('mainScreen');
  if (tableScreen) tableScreen.style.display = 'block';
  if (mainScreen) mainScreen.style.display = 'none';

  state.selectedTable = null;
  state.orderItems = [];
  state.selectedPaymentMethod = null;
  state.transferConfirmed = false;
  persistCafeState();

  renderTableGrid();
  updateOrderSummary();
  closePaymentModal();
}

function renderMenu() {
  const menuGrid = document.getElementById('menuGrid');
  if (!menuGrid) return;

  menuGrid.innerHTML = '';
  getMenuItems().forEach((item) => {
    const div = document.createElement('div');
    div.className = 'menu-item';
    div.innerHTML = `
      <div class="drink-icon">${item.icon}</div>
      <div class="drink-name">${item.name}</div>
      <div class="drink-price">${formatMoney(item.price)}</div>
    `;
    div.addEventListener('click', () => addToOrder(item));
    menuGrid.appendChild(div);
  });
}

function renderMenuManagerList() {
  const list = document.getElementById('menuManagerList');
  if (!list) return;

  const items = getMenuItems();
  if (!items.length) {
    list.innerHTML = '<div class="bill-empty">Chưa có món nào trong menu.</div>';
    return;
  }

  list.innerHTML = items.map((item) => `
    <div class="menu-manager-row">
      <div class="menu-manager-info">
        <span class="menu-manager-icon">${item.icon || '☕'}</span>
        <div>
          <div class="menu-manager-name">${item.name}</div>
          <div class="menu-manager-price">${formatMoney(item.price)}</div>
        </div>
      </div>
      <button class="menu-delete-btn" type="button" data-item-id="${item.id}">Xóa</button>
    </div>
  `).join('');

  list.querySelectorAll('.menu-delete-btn').forEach((button) => {
    button.addEventListener('click', () => deleteMenuItem(Number(button.dataset.itemId)));
  });
}

function openMenuManager() {
  const modal = document.getElementById('menuManagerModal');
  if (!modal) return;
  renderMenuManagerList();
  modal.classList.add('active');
}

function closeMenuManager() {
  const modal = document.getElementById('menuManagerModal');
  if (!modal) return;
  modal.classList.remove('active');
  const messageEl = document.getElementById('menuManagerMessage');
  if (messageEl) {
    messageEl.textContent = '';
    messageEl.className = 'auth-message';
  }
}

async function addMenuItem() {
  const nameInput = document.getElementById('newDrinkName');
  const priceInput = document.getElementById('newDrinkPrice');
  const iconInput = document.getElementById('newDrinkIcon');
  const messageEl = document.getElementById('menuManagerMessage');

  if (!nameInput || !priceInput || !iconInput || !messageEl) return;

  const name = nameInput.value.trim();
  const price = Number(priceInput.value);
  const icon = iconInput.value.trim() || '☕';

  if (!name || !Number.isFinite(price) || price <= 0) {
    messageEl.textContent = 'Vui lòng nhập tên và giá món hợp lệ.';
    messageEl.className = 'auth-message error';
    return;
  }

  try {
    const result = await apiRequest('/api/menu', {
      method: 'POST',
      body: JSON.stringify({ name, price, icon })
    });

    if (result && result.id) {
      window.cafeData.menuItems.push({ id: result.id, name, price, icon });
      saveMenuToStorage();
    }
  } catch (error) {
    console.warn('API menu unavailable, using local fallback:', error);
    const nextId = getMenuItems().reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
    window.cafeData.menuItems.push({ id: nextId, name, price, icon });
    saveMenuToStorage();
  }

  renderMenu();
  renderMenuManagerList();

  nameInput.value = '';
  priceInput.value = '';
  iconInput.value = '';

  messageEl.textContent = 'Đã thêm món mới!';
  messageEl.className = 'auth-message success';
}

async function deleteMenuItem(itemId) {
  const items = getMenuItems();
  if (!items.some((item) => item.id === itemId)) return;

  try {
    await apiRequest(`/api/menu/${itemId}`, { method: 'DELETE' });
  } catch (error) {
    console.warn('API delete menu unavailable, using local fallback:', error);
  }

  window.cafeData.menuItems = items.filter((item) => item.id !== itemId);
  state.orderItems = state.orderItems.filter((item) => item.id !== itemId);
  saveMenuToStorage();

  if (state.selectedTable) {
    saveTableOrder(state.selectedTable.id, state.orderItems);
  }

  renderMenu();
  renderMenuManagerList();
  updateOrderSummary();
}

function addToOrder(item) {
  if (!state.selectedTable) return;

  const currentItems = getTableOrder(state.selectedTable.id);
  const existing = currentItems.find((orderItem) => orderItem.id === item.id);

  if (existing) {
    existing.quantity += 1;
  } else {
    currentItems.push({ ...item, quantity: 1, note: '' });
  }

  saveTableOrder(state.selectedTable.id, currentItems);
  updateOrderSummary();
  showToast(`Đã thêm ${item.name}`, 'success');
}

function changeQuantity(itemId, delta) {
  if (!state.selectedTable) return;

  const currentItems = getTableOrder(state.selectedTable.id);
  const item = currentItems.find((orderItem) => orderItem.id === itemId);
  if (!item) return;

  item.quantity += delta;
  const updatedItems = item.quantity <= 0
    ? currentItems.filter((orderItem) => orderItem.id !== itemId)
    : currentItems;

  saveTableOrder(state.selectedTable.id, updatedItems);
  updateOrderSummary();
}

function updateItemNote(itemId, value) {
  if (!state.selectedTable) return;

  const currentItems = getTableOrder(state.selectedTable.id);
  const item = currentItems.find((orderItem) => orderItem.id === itemId);
  if (!item) return;

  item.note = value.trim().slice(0, 60);
  saveTableOrder(state.selectedTable.id, currentItems);
  persistCafeState();
}

function updateOrderSummary() {
  const orderList = document.getElementById('orderList');
  const totalAmount = document.getElementById('totalAmount');
  const btnPrint = document.getElementById('btnPrint');
  const btnPay = document.getElementById('btnPay');

  if (!orderList || !totalAmount || !btnPrint || !btnPay) return;

  if (!state.orderItems.length) {
    orderList.innerHTML = '<div class="order-empty">Chưa có món nào.<br>Chọn đồ uống từ menu bên trái 👈</div>';
    totalAmount.textContent = '0đ';
    btnPrint.disabled = true;
    btnPay.disabled = true;
    return;
  }

  let html = '';
  let total = 0;

  state.orderItems.forEach((item) => {
    total += Number(item.price || 0) * Number(item.quantity || 0);
    html += `
      <div class="order-item">
        <div class="item-info">
          <span style="font-size:1.3rem;">${item.icon || '☕'}</span>
          <div style="flex:1;">
            <div class="item-name">${item.name}</div>
            <div class="item-price">${formatMoney(item.price)} / món</div>
            <input
              class="item-note"
              type="text"
              value="${(item.note || '').replace(/"/g, '&quot;')}"
              data-item-id="${item.id}"
              placeholder="Ghi chú..."
              maxlength="60"
            >
          </div>
        </div>
        <div class="qty-control">
          <button class="qty-btn minus" onclick="changeQuantity(${item.id}, -1)">−</button>
          <span class="qty-number">${item.quantity}</span>
          <button class="qty-btn plus" onclick="changeQuantity(${item.id}, 1)">+</button>
        </div>
      </div>
    `;
  });

  orderList.innerHTML = html;
  orderList.querySelectorAll('.item-note').forEach((input) => {
    input.addEventListener('input', (event) => {
      updateItemNote(Number(event.target.dataset.itemId), event.target.value);
    });
  });

  totalAmount.textContent = formatMoney(total);
  btnPrint.disabled = false;
  btnPay.disabled = false;
}

function openPaymentModal() {
  if (!state.orderItems.length) return;

  const modalTotal = document.getElementById('modalTotal');
  const paymentModal = document.getElementById('paymentModal');

  if (modalTotal) modalTotal.textContent = formatMoney(getTotal(state.orderItems));
  if (paymentModal) paymentModal.classList.add('active');

  state.selectedPaymentMethod = null;
  state.transferConfirmed = false;

  const cash = document.getElementById('optCash');
  const transfer = document.getElementById('optTransfer');
  const qrContainer = document.getElementById('qrContainer');
  const confirmBtn = document.getElementById('btnConfirmPayment');
  const transferStatus = document.getElementById('transferStatus');
  const qrCode = document.getElementById('qrCode');

  if (cash) cash.classList.remove('selected');
  if (transfer) transfer.classList.remove('selected');
  if (qrContainer) qrContainer.classList.remove('active');
  if (confirmBtn) confirmBtn.disabled = true;
  if (transferStatus) {
    transferStatus.className = 'transfer-status';
    transferStatus.textContent = '';
  }
  if (qrCode) qrCode.innerHTML = '';
}

function closePaymentModal() {
  const paymentModal = document.getElementById('paymentModal');
  if (paymentModal) paymentModal.classList.remove('active');

  state.selectedPaymentMethod = null;
  state.transferConfirmed = false;
  const qrCode = document.getElementById('qrCode');
  if (qrCode) qrCode.innerHTML = '';
}

function selectPayment(method) {
  state.selectedPaymentMethod = method;
  state.transferConfirmed = false;

  document.getElementById('optCash').classList.remove('selected');
  document.getElementById('optTransfer').classList.remove('selected');
  const transferStatus = document.getElementById('transferStatus');
  if (transferStatus) {
    transferStatus.className = 'transfer-status';
    transferStatus.textContent = '';
  }

  if (method === 'cash') {
    document.getElementById('optCash').classList.add('selected');
    document.getElementById('qrContainer').classList.remove('active');
    document.getElementById('btnConfirmPayment').disabled = false;
    document.getElementById('qrCode').innerHTML = '';
  } else if (method === 'transfer') {
    document.getElementById('optTransfer').classList.add('selected');
    document.getElementById('qrContainer').classList.add('active');
    document.getElementById('btnConfirmPayment').disabled = true;
    generateQRCode();
  }
}

function generateQRCode() {
  const total = getTotal(state.orderItems);
  const qrData = `pay:${total}:${state.selectedTable ? state.selectedTable.id : 0}:${state.orderItems.length}:${Date.now()}`;
  const qrCodeElement = document.getElementById('qrCode');
  const qrAmount = document.getElementById('qrAmount');

  if (qrCodeElement) qrCodeElement.innerHTML = '';
  if (qrAmount) qrAmount.textContent = `Số tiền: ${formatMoney(total)}`;

  if (window.QRCode) {
    new window.QRCode(qrCodeElement, {
      text: qrData,
      width: 180,
      height: 180,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H
    });
  }
}

function checkTransfer() {
  if (state.selectedPaymentMethod !== 'transfer') return;

  const statusEl = document.getElementById('transferStatus');
  const isTransferred = Math.random() > 0.3;

  if (isTransferred) {
    state.transferConfirmed = true;
    statusEl.className = 'transfer-status success';
    statusEl.textContent = '✅ Đã nhận được chuyển khoản!';
    document.getElementById('btnConfirmPayment').disabled = false;
    showToast('Xác nhận chuyển khoản thành công', 'success');
  } else {
    state.transferConfirmed = false;
    statusEl.className = 'transfer-status pending';
    statusEl.textContent = '⏳ Chưa thấy giao dịch. Vui lòng thử lại.';
    document.getElementById('btnConfirmPayment').disabled = true;
    showToast('Chưa phát hiện giao dịch', 'error');
  }
}

async function confirmPayment() {
  if (!state.orderItems.length) return;

  const paymentMethod = state.selectedPaymentMethod;
  if (paymentMethod === 'cash') {
    showToast('✅ Thanh toán tiền mặt thành công!', 'success');
  } else if (paymentMethod === 'transfer' && state.transferConfirmed) {
    showToast('✅ Thanh toán chuyển khoản thành công!', 'success');
  } else {
    showToast('❌ Vui lòng kiểm tra chuyển khoản trước!', 'error');
    return;
  }

  const paidAmount = getTotal(state.orderItems);
  state.totalRevenue += paidAmount;

  if (state.selectedTable) {
    try {
      const orderPayload = {
        tableId: state.selectedTable.id,
        tableName: state.selectedTable.name,
        items: state.orderItems,
        total: paidAmount
      };

      const orderResult = await apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify(orderPayload)
      });

      if (orderResult && orderResult.orderId) {
        await apiRequest('/api/payments', {
          method: 'POST',
          body: JSON.stringify({
            orderId: orderResult.orderId,
            method: paymentMethod,
            amount: paidAmount
          })
        });
      }
    } catch (error) {
      console.warn('API payment unavailable, using local fallback:', error);
    }

    const billRecord = {
      id: Date.now() + Math.random(),
      tableName: state.selectedTable.name,
      tableId: state.selectedTable.id,
      items: state.orderItems.map((item) => ({ ...item })),
      total: paidAmount,
      createdAt: new Date().toISOString(),
      paymentMethod
    };

    state.billHistory.unshift(billRecord);
    state.pendingBills = state.pendingBills.filter((bill) => bill.tableId !== state.selectedTable.id);
    state.tableOrders[state.selectedTable.id] = [];
    state.orderItems = [];
    updateBillHistory();
    renderTableGrid();
  }

  persistCafeState();
  updateRevenueDisplay();
  closePaymentModal();
  updateOrderSummary();
  renderPendingBills();
  openAdminDashboard();

  setTimeout(() => {
    goBackToTables();
  }, 300);
}

function updateBillHistory() {
  const billHistory = state.billHistory || [];
  const billCountEl = document.getElementById('adminBillCount');
  if (billCountEl) billCountEl.textContent = String(billHistory.length);

  const revenueEl = document.getElementById('adminTotalRevenue');
  if (revenueEl) revenueEl.textContent = formatMoney(state.totalRevenue);
}

function openAdminDashboard() {
  const modal = document.getElementById('adminDashboardModal');
  if (!modal) return;

  const revenueEl = document.getElementById('adminTotalRevenue');
  const billCountEl = document.getElementById('adminBillCount');
  const listEl = document.getElementById('adminBillsList');

  if (revenueEl) revenueEl.textContent = formatMoney(state.totalRevenue);
  if (billCountEl) billCountEl.textContent = String((state.billHistory || []).length);

  if (listEl) {
    const bills = state.billHistory || [];
    if (!bills.length) {
      listEl.innerHTML = '<div class="bill-empty">Chưa có bill nào trong hệ thống.</div>';
    } else {
      listEl.innerHTML = bills.map((order) => `
        <div class="bill-card" style="margin-bottom:12px;">
          <div class="bill-header">
            <span class="bill-table">${order.tableName || 'Bàn chưa rõ'}</span>
            <span class="bill-total">${formatMoney(order.total || 0)}</span>
          </div>
          <div style="font-size:0.8rem; color:#666; margin:8px 0;">Ngày: ${new Date(order.createdAt || Date.now()).toLocaleString('vi-VN')}</div>
          <ul class="bill-items">
            ${(order.items || []).map((item) => `
              <li class="bill-item">
                <span>${item.icon || '☕'} ${item.name} x${item.quantity}</span>
                <span>${formatMoney(Number(item.price || 0) * Number(item.quantity || 0))}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      `).join('');
    }
  }

  loadDailyRevenueChart();
  modal.classList.add('active');
}

function closeAdminDashboard() {
  const modal = document.getElementById('adminDashboardModal');
  if (modal) modal.classList.remove('active');
}

function printReceipt() {
  if (!state.orderItems.length) return;

  const total = getTotal(state.orderItems);
  const receiptContent = document.getElementById('receiptContent');
  const printArea = document.getElementById('printArea');

  let itemsHtml = '';
  state.orderItems.forEach((item) => {
    itemsHtml += `
      <div class="receipt-line">
        <span>${item.icon || '☕'} ${item.name} x${item.quantity}</span>
        <span>${formatMoney(Number(item.price || 0) * Number(item.quantity || 0))}</span>
      </div>
    `;
  });

  const receiptData = `bill:${total}:${state.selectedTable ? state.selectedTable.id : 0}:${Date.now()}`;

  receiptContent.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-title">☕ QUÁN NƯỚC</div>
      <div style="font-size:0.85rem;">Địa chỉ: 123 Đường ABC, TP.HCM</div>
      <div style="font-size:0.85rem;">SĐT: 0123 456 789</div>
      <div class="receipt-table">🪑 ${state.selectedTable ? state.selectedTable.name : 'Bàn: -'}</div>
      <div style="font-size:0.8rem;">Ngày: ${new Date().toLocaleString('vi-VN')}</div>
    </div>
    ${itemsHtml}
    <div class="receipt-total">
      <span>TỔNG CỘNG</span>
      <span>${formatMoney(total)}</span>
    </div>
    <div class="receipt-qr" id="receiptQrContainer"></div>
    <div class="receipt-footer">
      Cảm ơn quý khách! Hẹn gặp lại ❤️
    </div>
    <div class="receipt-actions">
      <button class="btn-preview-action btn-print-action" onclick="window.print()">🖨️ In hóa đơn</button>
      <button class="btn-preview-action btn-close-action" onclick="closeReceiptPreview()">✖ Đóng</button>
    </div>
  `;

  if (printArea) printArea.classList.add('active');

  const qrContainer = document.getElementById('receiptQrContainer');
  if (qrContainer && window.QRCode) {
    new window.QRCode(qrContainer, {
      text: receiptData,
      width: 180,
      height: 180,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }
}

function closeReceiptPreview() {
  const printArea = document.getElementById('printArea');
  if (printArea) printArea.classList.remove('active');
}

function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️'
  };

  toast.innerHTML = `${icons[type] || 'ℹ️'} ${message}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s ease';
    setTimeout(() => toast.remove(), 500);
  }, 2500);
}

function init() {
  hydrateStaticData();
  syncTableStatuses();
  restorePersistedView();

  const savedLogin = localStorage.getItem('cafeLoggedIn') === 'true';
  if (savedLogin) {
    state.isLoggedIn = true;
    if (state.selectedTable) {
      const loginScreen = document.getElementById('loginScreen');
      const tableScreen = document.getElementById('tableScreen');
      const mainScreen = document.getElementById('mainScreen');
      if (loginScreen) loginScreen.style.display = 'none';
      if (tableScreen) tableScreen.style.display = 'none';
      if (mainScreen) mainScreen.style.display = 'block';
      const currentTableBadge = document.getElementById('currentTableBadge');
      if (currentTableBadge) currentTableBadge.textContent = `🪑 ${state.selectedTable.name}`;
      updateUserMenuVisibility();
      renderTableGrid();
      updateOrderSummary();
    } else {
      showTableSelectionScreen();
    }
  } else {
    state.isLoggedIn = false;
    showLoginScreen();
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  const avatarButton = document.getElementById('avatarButton');
  if (avatarButton) {
    avatarButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleUserDropdown();
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  const revenueBtn = document.getElementById('revenueBtn');
  if (revenueBtn) {
    revenueBtn.addEventListener('click', () => {
      showToast(`💰 Tổng tiền đã nhận: ${formatMoney(state.totalRevenue)}`, 'info');
    });
  }

  const menuManagerBtn = document.getElementById('menuManagerBtn');
  if (menuManagerBtn) {
    menuManagerBtn.addEventListener('click', openMenuManager);
  }

  const adminDashboardBtn = document.getElementById('adminDashboardBtn');
  if (adminDashboardBtn) {
    adminDashboardBtn.addEventListener('click', openAdminDashboard);
  }

  const addDrinkBtn = document.getElementById('addDrinkBtn');
  if (addDrinkBtn) {
    addDrinkBtn.addEventListener('click', addMenuItem);
  }

  const dailyRevenueBtn = document.getElementById('dailyRevenueBtn');
  if (dailyRevenueBtn) {
    dailyRevenueBtn.addEventListener('click', loadDailyRevenueChart);
  }

  document.addEventListener('click', (event) => {
    const dropdown = document.getElementById('userDropdown');
    const avatarBtn = document.getElementById('avatarButton');
    if (!dropdown || !avatarBtn) return;
    if (!dropdown.contains(event.target) && !avatarBtn.contains(event.target)) {
      dropdown.classList.remove('active');
    }
  });

  renderTableGrid();
  renderMenu();
  renderMenuManagerList();
  updateOrderSummary();
  renderPendingBills();
  updateRevenueDisplay();
  updateBillHistory();
  loadDailyRevenueChart();
}

init();
