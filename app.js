const renderApiUrl = 'https://my-website-qpnq.onrender.com';
window.APP_CONFIG = window.APP_CONFIG || { API_BASE_URL: renderApiUrl };
const API_BASE_URL = window.APP_CONFIG.API_BASE_URL || renderApiUrl;

const SHARED_STORAGE_KEYS = new Set([
  'cafeTables',
  'cafeMenu',
  'cafeMenuCategories',
  'cafeActiveMenuCategory',
  'cafeAppState',
  'cafeLoggedIn'
]);

function guardSharedCafeStorage() {
  if (window.__cafeStorageGuardInstalled) return;

  const applyGuard = (storage) => {
    if (!storage || storage.__cafeStorageGuardInstalled) return;

    const nativeSetItem = storage.setItem.bind(storage);
    const nativeGetItem = storage.getItem.bind(storage);
    const nativeRemoveItem = storage.removeItem.bind(storage);

    storage.setItem = function guardedSetItem(key, value) {
      if (SHARED_STORAGE_KEYS.has(String(key))) {
        return nativeSetItem(key, value);
      }
      return nativeSetItem(key, value);
    };

    storage.getItem = function guardedGetItem(key) {
      if (SHARED_STORAGE_KEYS.has(String(key))) {
        return nativeGetItem(key);
      }
      return nativeGetItem(key);
    };

    storage.removeItem = function guardedRemoveItem(key) {
      if (SHARED_STORAGE_KEYS.has(String(key))) {
        return nativeRemoveItem(key);
      }
      return nativeRemoveItem(key);
    };

    storage.__cafeStorageGuardInstalled = true;
  };

  applyGuard(window.localStorage);
  window.__cafeStorageGuardInstalled = true;
}

guardSharedCafeStorage();

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

async function syncTableStatusToServer(tableId, status) {
  if (!tableId || !status) return;

  try {
    await apiRequest(`/api/tables/${tableId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
  } catch (error) {
    console.warn('Không thể đồng bộ trạng thái bàn lên server:', error);
  }
}

function persistCafeState() {
  if (state && typeof state.persist === 'function') {
    state.persist();
  }
}

function syncTableStatuses() {
  window.cafeData.tables = getTables().map((table) => {
    const hasSessionOrder = state.tableOrders[table.id] && state.tableOrders[table.id].length > 0;
    const nextStatus = hasSessionOrder ? 'occupied' : (table.status === 'occupied' || table.status === 'empty' ? table.status : 'empty');

    return {
      ...table,
      status: nextStatus
    };
  });

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

function getMenuCategories() {
  const saved = JSON.parse(localStorage.getItem('cafeMenuCategories') || 'null');
  const derived = [...new Set(getMenuItems().map((item) => (item.category || 'Khác').trim()).filter(Boolean))];
  const merged = Array.from(new Set([...(Array.isArray(saved) ? saved : []), ...derived]));

  if (merged.length) {
    localStorage.setItem('cafeMenuCategories', JSON.stringify(merged));
    return merged;
  }

  const fallback = ['Khác'];
  localStorage.setItem('cafeMenuCategories', JSON.stringify(fallback));
  return fallback;
}

function saveMenuCategories(categories) {
  const cleaned = Array.from(new Set((Array.isArray(categories) ? categories : []).map((item) => String(item || '').trim()).filter(Boolean)));
  const next = cleaned.length ? cleaned : ['Khác'];
  localStorage.setItem('cafeMenuCategories', JSON.stringify(next));
  return next;
}

function rebuildMenuCategoryList(items = getMenuItems()) {
  const existing = Array.isArray(JSON.parse(localStorage.getItem('cafeMenuCategories') || 'null')) ? JSON.parse(localStorage.getItem('cafeMenuCategories') || 'null') : [];
  const derived = [...new Set(items.map((item) => (item.category || 'Khác').trim()).filter(Boolean))];
  const categories = Array.from(new Set([...existing, ...derived].map((item) => String(item || '').trim()).filter(Boolean)));

  if (!categories.length) {
    return saveMenuCategories(['Khác']);
  }

  return saveMenuCategories(categories);
}

function addCategoryGroup(categoryName) {
  const value = String(categoryName || '').trim();
  if (!value) return null;

  const categories = getMenuCategories();
  if (!categories.includes(value)) {
    categories.push(value);
    saveMenuCategories(categories);
  }

  localStorage.setItem('cafeActiveMenuCategory', value);
  renderMenu();
  return value;
}

function saveTablesToStorage() {
  localStorage.setItem('cafeTables', JSON.stringify(getTables()));
}

async function refreshSharedData() {
  try {
    const [menuData, tableData] = await Promise.all([
      apiRequest('/api/menu'),
      apiRequest('/api/tables')
    ]);

    if (Array.isArray(menuData) && menuData.length) {
      window.cafeData.menuItems = menuData;
      saveMenuToStorage();
    }

    if (Array.isArray(tableData) && tableData.length) {
      window.cafeData.tables = tableData;
      saveTablesToStorage();
    }

    rebuildMenuCategoryList(window.cafeData.menuItems || []);
    syncTableStatuses();
    renderMenu();
    renderTableGrid();
    renderMenuManagerList();
    updateOrderSummary();
    await syncPendingBillsFromServer();
    renderPendingBills();
  } catch (error) {
    console.warn('Không thể đồng bộ dữ liệu chia sẻ từ server:', error);
  }
}

function startSharedDataPolling() {
  if (window.__cafeSharedPollingId) {
    return;
  }

  window.__cafeSharedPollingId = window.setInterval(() => {
    refreshSharedData();
    syncRevenueFromServer();
  }, 4000);
}

async function hydrateStaticData() {
  try {
    const menuData = await apiRequest('/api/menu');
    if (Array.isArray(menuData)) {
      window.cafeData.menuItems = menuData;
      localStorage.setItem('cafeMenu', JSON.stringify(menuData));
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

  renderMenu();
  renderMenuManagerList();
}

function getTableOrder(tableId) {
  return Array.isArray(state.tableOrders[tableId]) ? [...state.tableOrders[tableId]] : [];
}

function saveTableOrder(tableId, items) {
  state.tableOrders[tableId] = Array.isArray(items) ? [...items] : [];
  if (state.selectedTable && state.selectedTable.id === tableId) {
    state.orderItems = [...state.tableOrders[tableId]];
  }

  const nextStatus = state.tableOrders[tableId] && state.tableOrders[tableId].length > 0 ? 'occupied' : 'empty';
  syncTableStatuses();
  void syncTableStatusToServer(tableId, nextStatus);
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

async function syncRevenueFromServer() {
  try {
    const result = await apiRequest('/api/revenue');
    const total = Number(result?.total || 0);
    if (Number.isFinite(total)) {
      state.totalRevenue = total;
      persistCafeState();
      updateRevenueDisplay();
    }
  } catch (error) {
    console.warn('Không thể đồng bộ doanh thu từ DB:', error);
  }
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

function addMenuGroupFromDropdown() {
  const newName = window.prompt('Tên nhóm mới:', 'Trà');
  if (!newName) return;

  const value = addCategoryGroup(newName);
  if (value) {
    showToast(`Đã thêm nhóm "${value}"`, 'success');
  }
}

function renameCurrentMenuCategoryFromDropdown() {
  const current = localStorage.getItem('cafeActiveMenuCategory') || 'Khác';
  const next = window.prompt('Tên nhóm mới:', current);
  if (next === null) return;

  const value = next.trim();
  if (!value) {
    showToast('Tên nhóm không được để trống.', 'error');
    return;
  }

  renameMenuCategory(current, value)
    .then(() => {
      showToast(`Đã đổi nhóm "${current}" thành "${value}"`, 'success');
    })
    .catch((error) => {
      showToast(error && error.message ? error.message : 'Không thể đổi tên nhóm.', 'error');
    });
}

function deleteCurrentMenuCategoryFromDropdown() {
  const current = localStorage.getItem('cafeActiveMenuCategory') || 'Khác';
  const categories = getMenuCategories();
  if (categories.length <= 1) {
    showToast('Phải giữ ít nhất 1 nhóm menu.', 'error');
    return;
  }

  const confirmed = window.confirm(`Bạn có chắc muốn xóa nhóm "${current}" không?`);
  if (!confirmed) return;

  deleteMenuCategory(current)
    .then(() => {
      showToast(`Đã xóa nhóm "${current}"`, 'success');
    })
    .catch((error) => {
      showToast(error && error.message ? error.message : 'Không thể xóa nhóm.', 'error');
    });
}

function openCurrentMenuManagerFromDropdown() {
  const current = localStorage.getItem('cafeActiveMenuCategory') || getMenuCategories()[0] || 'Khác';
  localStorage.setItem('cafeActiveMenuCategory', current);
  openMenuManager(current);
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
  sessionStorage.removeItem('cafeLoggedIn');
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
    sessionStorage.setItem('cafeLoggedIn', 'true');
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
  sessionStorage.setItem('cafeLoggedIn', 'true');
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

async function loadDailyRevenueChart() {
  try {
    const data = await apiRequest('/api/revenue-by-day');
    const points = Array.isArray(data?.points) && data.points.length ? data.points : buildDailyRevenuePoints();
    renderDailyRevenueChart(points);
    return;
  } catch (error) {
    console.warn('Không thể lấy doanh thu theo ngày từ API, dùng dữ liệu local:', error);
  }

  renderDailyRevenueChart(buildDailyRevenuePoints());
}

async function syncPendingBillsFromServer() {
  try {
    const orders = await apiRequest('/api/orders/pending');
    if (!Array.isArray(orders)) return;

    state.pendingBills = orders.map((order) => ({
      id: Number(order.id),
      tableId: Number(order.table_id),
      tableName: order.table_name || `Bàn ${order.table_id}`,
      total: Number(order.total || 0),
      createdAt: order.created_at || new Date().toISOString(),
      items: Array.isArray(order.items) ? order.items.map((item) => ({
        id: Number(item.item_id || item.id),
        name: item.name,
        icon: item.icon || '☕',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        note: item.note || ''
      })) : []
    }));

    persistCafeState();
    renderPendingBills();
  } catch (error) {
    console.warn('Không thể đồng bộ đơn đang chờ phục vụ từ server:', error);
  }
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
        ${(bill.items || []).map((item) => `
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

async function completePendingBill(billId) {
  const bill = state.pendingBills.find((item) => item.id === billId);
  if (bill && bill.tableId) {
    const table = getTables().find((item) => item.id === bill.tableId);
    if (table) {
      table.status = 'empty';
      void syncTableStatusToServer(table.id, 'empty');
    }
  }

  try {
    await apiRequest(`/api/orders/${billId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'completed' })
    });
  } catch (error) {
    console.warn('Không cập nhật trạng thái đơn hàng lên server:', error);
  }

  state.pendingBills = state.pendingBills.filter((item) => item.id !== billId);
  syncTableStatuses();
  persistCafeState();
  renderTableGrid();
  renderPendingBills();
  showToast('✅ Bill đã hoàn thành!', 'success');
  await syncPendingBillsFromServer();
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
  const items = getMenuItems();
  const categories = getMenuCategories();
  const activeCategory = localStorage.getItem('cafeActiveMenuCategory') || categories[0] || 'Khác';
  const selectedCategory = categories.includes(activeCategory) ? activeCategory : (categories[0] || 'Khác');
  localStorage.setItem('cafeActiveMenuCategory', selectedCategory);

  const tabs = document.createElement('div');
  tabs.className = 'menu-tabs';

  categories.forEach((category) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = `menu-tab ${category === selectedCategory ? 'active' : ''}`;
    tabButton.textContent = category;
    tabButton.addEventListener('click', () => {
      localStorage.setItem('cafeActiveMenuCategory', category);
      renderMenu();
    });
    tabs.appendChild(tabButton);
  });

  menuGrid.appendChild(tabs);

  const categoryItems = items.filter((item) => (item.category || 'Khác') === selectedCategory);
  const categoryBlock = document.createElement('div');
  categoryBlock.className = 'menu-category-block';

  const categoryHeader = document.createElement('div');
  categoryHeader.className = 'menu-category-header';

  const categoryTitle = document.createElement('div');
  categoryTitle.className = 'menu-category-title';
  categoryTitle.textContent = selectedCategory;

  const categoryCount = document.createElement('span');
  categoryCount.className = 'menu-category-count';
  categoryCount.textContent = `${categoryItems.length} món`;

  categoryHeader.appendChild(categoryTitle);
  categoryHeader.appendChild(categoryCount);
  categoryBlock.appendChild(categoryHeader);

  const categoryGrid = document.createElement('div');
  categoryGrid.className = 'menu-grid-inner';

  if (!categoryItems.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'menu-category-empty';
    emptyState.textContent = 'Chưa có món trong nhóm này';
    categoryGrid.appendChild(emptyState);
  } else {
    categoryItems.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'menu-item menu-item-compact';
      div.innerHTML = `
        <div class="drink-icon">${item.icon || '☕'}</div>
        <div class="drink-name">${item.name}</div>
        <div class="drink-price">${formatMoney(item.price)}</div>
      `;
      div.addEventListener('click', () => addToOrder(item));
      categoryGrid.appendChild(div);
    });
  }

  categoryBlock.appendChild(categoryGrid);

  menuGrid.appendChild(categoryBlock);

  if (!categories.length) {
    menuGrid.innerHTML = '<div class="bill-empty">Chưa có món nào trong menu.</div>';
  }
}

function renderMenuManagerList() {
  const list = document.getElementById('menuManagerList');
  if (!list) return;

  const activeCategory = localStorage.getItem('cafeActiveMenuCategory') || 'Khác';
  const items = getMenuItems().filter((item) => (item.category || 'Khác') === activeCategory);
  if (!items.length) {
    list.innerHTML = `<div class="bill-empty">Chưa có món nào trong nhóm "${activeCategory}".</div>`;
    return;
  }

  list.innerHTML = items.map((item) => `
    <div class="menu-manager-row">
      <div class="menu-manager-info">
        <span class="menu-manager-icon">${item.icon || '☕'}</span>
        <div>
          <div class="menu-manager-name">${item.name}</div>
          <div class="menu-manager-price">${formatMoney(item.price)}</div>
          <div class="menu-manager-category">${item.category || 'Khác'}</div>
        </div>
      </div>
      <div class="menu-manager-actions">
        <button class="menu-edit-btn" type="button" data-item-id="${item.id}">Sửa</button>
        <button class="menu-delete-btn" type="button" data-item-id="${item.id}">Xóa</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.menu-edit-btn').forEach((button) => {
    button.addEventListener('click', () => editMenuItem(Number(button.dataset.itemId)));
  });

  list.querySelectorAll('.menu-delete-btn').forEach((button) => {
    button.addEventListener('click', () => deleteMenuItem(Number(button.dataset.itemId)));
  });
}

function openMenuManager(categoryName = null) {
  const modal = document.getElementById('menuManagerModal');
  if (!modal) return;

  const selectedCategory = categoryName || localStorage.getItem('cafeActiveMenuCategory') || 'Khác';
  localStorage.setItem('cafeActiveMenuCategory', selectedCategory);
  renderMenuManagerList();
  modal.classList.add('active');

  const nameInput = document.getElementById('newDrinkName');
  if (nameInput) {
    setTimeout(() => {
      nameInput.focus();
    }, 50);
  }
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

async function renameMenuCategory(oldCategory, newCategory) {
  const from = String(oldCategory || 'Khác').trim();
  const to = String(newCategory || 'Khác').trim();
  if (!from || !to || from === to) return;

  try {
    const result = await apiRequest('/api/menu/categories', {
      method: 'PUT',
      body: JSON.stringify({ from, to })
    });

    const items = getMenuItems().map((item) => ((item.category || 'Khác') === from ? { ...item, category: to } : item));
    window.cafeData.menuItems = items;
    saveMenuToStorage();
    rebuildMenuCategoryList(items);
    localStorage.setItem('cafeActiveMenuCategory', to);
    renderMenu();
    renderMenuManagerList();

    return result;
  } catch (error) {
    const items = getMenuItems().map((item) => ((item.category || 'Khác') === from ? { ...item, category: to } : item));
    const categories = getMenuCategories().map((category) => (category === from ? to : category));
    window.cafeData.menuItems = items;
    saveMenuToStorage();
    saveMenuCategories(categories.length ? categories : ['Khác']);
    localStorage.setItem('cafeActiveMenuCategory', to);
    renderMenu();
    renderMenuManagerList();
    return { success: true, updatedCount: items.length, localFallback: true };
  }
}

async function deleteMenuCategory(categoryName) {
  const category = String(categoryName || '').trim() || 'Khác';
  if (!category) return;

  try {
    const result = await apiRequest('/api/menu/categories', {
      method: 'DELETE',
      body: JSON.stringify({ category })
    });

    const remaining = getMenuCategories().filter((item) => item !== category);
    const fallback = remaining[0] || 'Khác';
    saveMenuCategories(remaining.length ? remaining : ['Khác']);
    localStorage.setItem('cafeActiveMenuCategory', fallback);

    const deletedCount = getMenuItems().filter((item) => (item.category || 'Khác') === category).length;
    const items = getMenuItems().filter((item) => (item.category || 'Khác') !== category);
    window.cafeData.menuItems = items;
    saveMenuToStorage();
    rebuildMenuCategoryList(items);

    renderMenu();
    renderMenuManagerList();

    return { ...result, deletedCount };
  } catch (error) {
    const remaining = getMenuCategories().filter((item) => item !== category);
    const fallback = remaining[0] || 'Khác';
    saveMenuCategories(remaining.length ? remaining : ['Khác']);
    localStorage.setItem('cafeActiveMenuCategory', fallback);

    const deletedCount = getMenuItems().filter((item) => (item.category || 'Khác') === category).length;
    const items = getMenuItems().filter((item) => (item.category || 'Khác') !== category);
    window.cafeData.menuItems = items;
    saveMenuToStorage();
    rebuildMenuCategoryList(items);

    renderMenu();
    renderMenuManagerList();
    return { success: true, deletedCount, localFallback: true };
  }
}

async function editMenuItem(itemId) {
  const items = getMenuItems();
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return;

  const newName = window.prompt('Tên mới:', item.name);
  if (newName === null) return;

  const newPriceValue = window.prompt('Giá mới:', String(item.price));
  if (newPriceValue === null) return;

  const newIcon = window.prompt('Icon mới:', item.icon || '☕');
  if (newIcon === null) return;

  const newCategory = window.prompt('Nhóm mới:', item.category || 'Khác');
  if (newCategory === null) return;

  const name = newName.trim();
  const price = Number(newPriceValue);
  const icon = (newIcon || '☕').trim() || '☕';
  const category = (newCategory || 'Khác').trim() || 'Khác';

  if (!name || !Number.isFinite(price) || price <= 0) {
    showToast('Tên và giá món không hợp lệ.', 'error');
    return;
  }

  try {
    const updatedItem = await apiRequest(`/api/menu/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, price, icon, category })
    });

    const nextItems = items.map((entry) => entry.id === itemId ? { ...entry, ...updatedItem } : entry);
    window.cafeData.menuItems = nextItems;
    saveMenuToStorage();
    rebuildMenuCategoryList(nextItems);
    localStorage.setItem('cafeActiveMenuCategory', category);
    renderMenu();
    renderMenuManagerList();
    showToast('Đã cập nhật món.', 'success');
  } catch (error) {
    showToast(error && error.message ? error.message : 'Không thể cập nhật món.', 'error');
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
  const category = localStorage.getItem('cafeActiveMenuCategory') || 'Khác';

  if (!name || !Number.isFinite(price) || price <= 0) {
    messageEl.textContent = 'Vui lòng nhập tên và giá món hợp lệ.';
    messageEl.className = 'auth-message error';
    return;
  }

  try {
    const result = await apiRequest('/api/menu', {
      method: 'POST',
      body: JSON.stringify({ name, price, icon, category })
    });

    if (result && result.id) {
      window.cafeData.menuItems.push({ id: result.id, name, price, icon, category });
      saveMenuToStorage();

      const categories = getMenuCategories();
      if (!categories.includes(category)) {
        categories.push(category);
        saveMenuCategories(categories);
      }
    }

    await hydrateStaticData();
  } catch (error) {
    console.error('Thêm món thất bại:', error);
    const detail = error && error.message ? error.message : 'Vui lòng thử lại.';
    messageEl.textContent = `Thêm món thất bại: ${detail}`;
    messageEl.className = 'auth-message error';
    return;
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
  const itemToDelete = items.find((item) => item.id === itemId);

  if (!itemToDelete) return;

  const confirmed = window.confirm(`Bạn có chắc muốn xóa món "${itemToDelete.name}" không?`);
  if (!confirmed) return;

  try {
    await apiRequest(`/api/menu/${itemId}`, { method: 'DELETE' });
  } catch (error) {
    const errorText = error && error.message ? error.message : String(error || '');
    const alreadyDeleted = errorText.includes('Không tìm thấy món cần xóa') || errorText.includes('Not Found');

    if (alreadyDeleted) {
      window.cafeData.menuItems = items.filter((item) => item.id !== itemId);
      saveMenuToStorage();

      renderMenu();
      renderMenuManagerList();
      updateOrderSummary();

      const messageEl = document.getElementById('menuManagerMessage');
      if (messageEl) {
        messageEl.textContent = `Món "${itemToDelete.name}" đã được xóa trước đó.`;
        messageEl.className = 'auth-message success';
      }
      return;
    }

    console.error('Xóa món thất bại:', error);
    const messageEl = document.getElementById('menuManagerMessage');
    if (messageEl) {
      messageEl.textContent = 'Xóa món thất bại. Vui lòng thử lại.';
      messageEl.className = 'auth-message error';
    }
    return;
  }

  window.cafeData.menuItems = items.filter((item) => item.id !== itemId);
  state.orderItems = state.orderItems.filter((item) => item.id !== itemId);
  saveMenuToStorage();

  if (state.selectedTable) {
    saveTableOrder(state.selectedTable.id, state.orderItems);
  }

  await hydrateStaticData();
  renderMenu();
  renderMenuManagerList();
  updateOrderSummary();

  const messageEl = document.getElementById('menuManagerMessage');
  if (messageEl) {
    messageEl.textContent = `Đã xóa món "${itemToDelete.name}"!`;
    messageEl.className = 'auth-message success';
  }
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
  const customQrUpload = document.getElementById('customQrUpload');

  if (cash) cash.classList.remove('selected');
  if (transfer) transfer.classList.remove('selected');
  if (qrContainer) qrContainer.classList.remove('active');
  if (confirmBtn) confirmBtn.disabled = true;
  if (customQrUpload) customQrUpload.value = '';
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
  state.transferConfirmed = method === 'transfer';

  document.getElementById('optCash').classList.remove('selected');
  document.getElementById('optTransfer').classList.remove('selected');
  const transferStatus = document.getElementById('transferStatus');
  if (transferStatus) {
    transferStatus.className = 'transfer-status success';
    transferStatus.textContent = method === 'transfer' ? '✅ Sẵn sàng thanh toán chuyển khoản.' : '';
  }

  if (method === 'cash') {
    document.getElementById('optCash').classList.add('selected');
    document.getElementById('qrContainer').classList.remove('active');
    document.getElementById('btnConfirmPayment').disabled = false;
    document.getElementById('qrCode').innerHTML = '';
  } else if (method === 'transfer') {
    document.getElementById('optTransfer').classList.add('selected');
    document.getElementById('qrContainer').classList.add('active');
    document.getElementById('btnConfirmPayment').disabled = false;
    generateQRCode();
  }
}

function getCustomQrImage() {
  try {
    const fromSession = sessionStorage.getItem('cafeCustomQrImage');
    if (fromSession) {
      state.customQrImage = fromSession;
      return fromSession;
    }
  } catch (error) {
    console.warn('Không thể đọc ảnh QR tùy chỉnh:', error);
  }

  if (state.customQrImage) {
    return state.customQrImage;
  }

  return state.defaultQrImage || '';
}

function renderQrImageInto(target, options = {}) {
  if (!target) return;

  target.innerHTML = '';
  const imageSrc = getCustomQrImage() || state.defaultQrImage || 'image/qr.jpg';

  const img = document.createElement('img');
  img.src = imageSrc;
  img.alt = 'Mã QR thanh toán';
  img.style.width = options.width ? `${options.width}px` : '180px';
  img.style.height = options.height ? `${options.height}px` : '180px';
  img.style.objectFit = 'contain';
  img.style.display = 'block';
  img.style.margin = '0 auto';
  target.appendChild(img);
}

function generateQRCode() {
  const total = getTotal(state.orderItems);
  const qrCodeElement = document.getElementById('qrCode');
  const qrAmount = document.getElementById('qrAmount');

  if (qrAmount) qrAmount.textContent = `Số tiền: ${formatMoney(total)}`;
  renderQrImageInto(qrCodeElement, { total, width: 180, height: 180 });
}

function handleCustomQrUpload(event) {
  const file = event.target && event.target.files ? event.target.files[0] : null;
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('Ảnh QR quá lớn. Vui lòng chọn ảnh dưới 2MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    state.customQrImage = dataUrl;
    try {
      sessionStorage.setItem('cafeCustomQrImage', dataUrl);
    } catch (error) {
      console.warn('Không thể lưu ảnh QR tùy chỉnh:', error);
    }

    if (state.selectedPaymentMethod === 'transfer') {
      generateQRCode();
    }
    showToast('✅ Đã tải ảnh QR của bạn.', 'success');
  };
  reader.readAsDataURL(file);
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
    state.transferConfirmed = false;
    showToast('✅ Thanh toán tiền mặt thành công!', 'success');
  } else if (paymentMethod === 'transfer') {
    state.transferConfirmed = true;
    showToast('✅ Thanh toán chuyển khoản thành công!', 'success');
  } else {
    showToast('❌ Vui lòng chọn phương thức thanh toán!', 'error');
    return;
  }

  const paidAmount = getTotal(state.orderItems);
  state.totalRevenue += paidAmount;

  try {
    await apiRequest('/api/revenue', {
      method: 'POST',
      body: JSON.stringify({ total: paidAmount })
    });
  } catch (error) {
    console.warn('Không thể lưu tổng doanh thu vào DB:', error);
  }

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

    state.billHistory.unshift({ ...billRecord });

    // After a successful payment, the order is sent to the kitchen queue.
    state.pendingBills.unshift({
      id: billRecord.id,
      tableName: billRecord.tableName,
      tableId: billRecord.tableId,
      items: billRecord.items.map((item) => ({ ...item })),
      total: billRecord.total,
      createdAt: billRecord.createdAt,
      paymentMethod: billRecord.paymentMethod
    });

    state.tableOrders[state.selectedTable.id] = [];
    state.orderItems = [];
    void syncTableStatusToServer(state.selectedTable.id, 'empty');
    updateBillHistory();
    renderTableGrid();
  }

  persistCafeState();
  updateRevenueDisplay();
  closePaymentModal();
  updateOrderSummary();
  renderPendingBills();

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

async function openAdminDashboard() {
  const modal = document.getElementById('adminDashboardModal');
  if (!modal) return;

  await syncRevenueFromServer();

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

  await loadDailyRevenueChart();
  modal.classList.add('active');
}

function closeAdminDashboard() {
  const modal = document.getElementById('adminDashboardModal');
  if (modal) modal.classList.remove('active');
}

async function resetRevenueAndBills() {
  const confirmed = window.confirm('Bạn có chắc muốn reset toàn bộ bill và doanh thu? Hành động này sẽ xóa dữ liệu thống kê hiện tại.');
  if (!confirmed) return;

  try {
    await apiRequest('/api/revenue/reset', { method: 'POST' }).catch((error) => {
      console.warn('Reset server thất bại, vẫn tiếp tục reset local:', error);
    });

    state.totalRevenue = 0;
    state.billHistory = [];
    state.pendingBills = [];
    state.tableOrders = {};
    state.orderItems = [];
    state.selectedTable = null;
    persistCafeState();

    window.cafeData.tables = getTables().map((table) => ({ ...table, status: 'empty' }));
    saveTablesToStorage();
    renderTableGrid();
    renderPendingBills();
    updateRevenueDisplay();
    updateBillHistory();

    const modal = document.getElementById('adminDashboardModal');
    if (modal && modal.classList.contains('active')) {
      await openAdminDashboard();
    }

    showToast('✅ Đã reset bill & doanh thu!', 'success');
  } catch (error) {
    console.error('Reset dữ liệu thất bại:', error);
    showToast('❌ Reset thất bại. Vui lòng thử lại.', 'error');
  }
}

function printReceipt() {
  if (!state.orderItems.length) return;

  const total = getTotal(state.orderItems);
  const receiptContent = document.getElementById('receiptContent');
  const printArea = document.getElementById('printArea');

  let itemsHtml = '';
  state.orderItems.forEach((item) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
    itemsHtml += `
      <div class="receipt-line receipt-item-row">
        <span class="receipt-item-name">${item.name}</span>
        <span class="receipt-item-total">${formatMoney(itemTotal)}</span>
      </div>
      <div class="receipt-line receipt-item-meta">
        <span>${Number(item.quantity || 0)} x ${formatMoney(item.price || 0)}</span>
      </div>
    `;
  });

  const receiptData = `bill:${total}:${state.selectedTable ? state.selectedTable.id : 0}:${Date.now()}`;

  receiptContent.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-title">Khu Tổ Hợp Đương</div>
      <div class="receipt-address">Địa chỉ: 998/3 Quang Trung, Thông Tây Hội TP.HCM</div>
      <div class="receipt-address">SĐT: 0333 958 080</div>
      <div class="receipt-table">Bàn: ${state.selectedTable ? state.selectedTable.name : '-'}</div>
      <div class="receipt-date">Ngày: ${new Date().toLocaleString('vi-VN')}</div>
    </div>
    <div class="receipt-divider"></div>
    ${itemsHtml}
    <div class="receipt-divider"></div>
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
  if (qrContainer) {
    renderQrImageInto(qrContainer, {
      width: 180,
      height: 180,
      total
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

async function init() {
  await hydrateStaticData();
  await refreshSharedData();
  syncTableStatuses();
  restorePersistedView();
  await syncRevenueFromServer();
  startSharedDataPolling();

  const savedLogin = sessionStorage.getItem('cafeLoggedIn') === 'true';
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
    menuManagerBtn.addEventListener('click', openCurrentMenuManagerFromDropdown);
  }

  const menuAddGroupBtn = document.getElementById('menuAddGroupBtn');
  if (menuAddGroupBtn) {
    menuAddGroupBtn.addEventListener('click', addMenuGroupFromDropdown);
  }

  const menuRenameGroupBtn = document.getElementById('menuRenameGroupBtn');
  if (menuRenameGroupBtn) {
    menuRenameGroupBtn.addEventListener('click', renameCurrentMenuCategoryFromDropdown);
  }

  const menuDeleteGroupBtn = document.getElementById('menuDeleteGroupBtn');
  if (menuDeleteGroupBtn) {
    menuDeleteGroupBtn.addEventListener('click', deleteCurrentMenuCategoryFromDropdown);
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


  const customQrUpload = document.getElementById('customQrUpload');
  if (customQrUpload) {
    customQrUpload.addEventListener('change', handleCustomQrUpload);
  }

  await syncPendingBillsFromServer();

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
