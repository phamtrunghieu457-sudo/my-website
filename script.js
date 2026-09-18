const tables = [
    { id: 1, name: 'Bàn 1', status: 'empty' },
    { id: 2, name: 'Bàn 2', status: 'empty' },
    { id: 3, name: 'Bàn 3', status: 'empty' },
    { id: 4, name: 'Bàn 4', status: 'empty' },
    { id: 5, name: 'Bàn 5', status: 'empty' },
    { id: 6, name: 'Bàn 6', status: 'empty' },
    { id: 7, name: 'Bàn 7', status: 'empty' },
    { id: 8, name: 'Bàn 8', status: 'empty' },
    { id: 9, name: 'Bàn 9', status: 'empty' },
    { id: 10, name: 'Bàn 10', status: 'empty' },
];

const menuItems = [
    { id: 1, name: 'Cà phê đen', price: 20000, icon: '☕' },
    { id: 2, name: 'Cà phê sữa', price: 25000, icon: '🥛' },
    { id: 3, name: 'Trà đào', price: 30000, icon: '🍑' },
    { id: 4, name: 'Nước cam', price: 35000, icon: '🍊' },
    { id: 5, name: 'Sinh tố bơ', price: 40000, icon: '🥑' },
    { id: 6, name: 'Nước dừa', price: 25000, icon: '🥥' },
    { id: 7, name: 'Trà sữa', price: 35000, icon: '🧋' },
    { id: 8, name: 'Nước chanh', price: 20000, icon: '🍋' },
    { id: 9, name: 'Soda', price: 22000, icon: '🥤' },
    { id: 10, name: 'Nước suối', price: 10000, icon: '💧' },
    { id: 11, name: 'Bạc xỉu', price: 28000, icon: '☕' },
    { id: 12, name: 'Matcha đá xay', price: 45000, icon: '🍵' },
];

let selectedTable = null;
let orderItems = [];
let selectedPaymentMethod = null;
let transferConfirmed = false;
let pendingBills = [];

function init() {
    renderTableGrid();
    renderMenu();
    updateOrderSummary();
    renderPendingBills();
}

function renderTableGrid() {
    const grid = document.getElementById('tableGrid');
    grid.innerHTML = '';
    tables.forEach(table => {
        const card = document.createElement('div');
        card.className = `table-card ${table.status === 'occupied' ? 'occupied' : ''}`;
        card.innerHTML = `
            <div class="table-number">${table.name.replace('Bàn ', '')}</div>
            <div class="table-status ${table.status === 'occupied' ? 'status-occupied' : 'status-empty'}">
                ${table.status === 'occupied' ? '🔴 Đang sử dụng' : '🟢 Trống'}
            </div>
        `;
        if (table.status === 'empty') {
            card.addEventListener('click', () => selectTable(table));
        }
        grid.appendChild(card);
    });
}

function selectTable(table) {
    selectedTable = table;
    document.querySelectorAll('.table-card').forEach(card => {
        card.classList.remove('selected');
    });
    const cards = document.querySelectorAll('.table-card');
    const index = tables.indexOf(table);
    if (cards[index]) cards[index].classList.add('selected');

    document.getElementById('tableScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
    document.getElementById('currentTableBadge').textContent = `🪑 ${table.name}`;
    showToast(`Đã chọn ${table.name}`, 'info');
}

function goBackToTables() {
    document.getElementById('mainScreen').style.display = 'none';
    document.getElementById('tableScreen').style.display = 'block';
    if (selectedTable) {
        const table = tables.find(t => t.id === selectedTable.id);
        if (table) table.status = 'empty';
    }
    selectedTable = null;
    orderItems = [];
    selectedPaymentMethod = null;
    transferConfirmed = false;
    renderTableGrid();
    updateOrderSummary();
    closePaymentModal();
}

function renderMenu() {
    const menuGrid = document.getElementById('menuGrid');
    menuGrid.innerHTML = '';
    menuItems.forEach(item => {
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

function addToOrder(item) {
    const existing = orderItems.find(oi => oi.id === item.id);
    if (existing) {
        existing.quantity += 1;
    } else {
        orderItems.push({ ...item, quantity: 1, note: '' });
    }
    updateOrderSummary();
    showToast(`Đã thêm ${item.name}`, 'success');
}

function changeQuantity(itemId, delta) {
    const item = orderItems.find(oi => oi.id === itemId);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
        orderItems = orderItems.filter(oi => oi.id !== itemId);
    }
    updateOrderSummary();
}

function updateItemNote(itemId, value) {
    const item = orderItems.find(oi => oi.id === itemId);
    if (!item) return;
    item.note = value.trim().slice(0, 60);
}

function updateOrderSummary() {
    const orderList = document.getElementById('orderList');
    const totalAmount = document.getElementById('totalAmount');
    const btnPrint = document.getElementById('btnPrint');
    const btnPay = document.getElementById('btnPay');

    if (orderItems.length === 0) {
        orderList.innerHTML = `<div class="order-empty">Chưa có món nào.<br>Chọn đồ uống từ menu bên trái 👈</div>`;
        totalAmount.textContent = '0đ';
        btnPrint.disabled = true;
        btnPay.disabled = true;
        return;
    }

    let html = '';
    let total = 0;
    orderItems.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        html += `
            <div class="order-item">
                <div class="item-info">
                    <span style="font-size:1.3rem;">${item.icon}</span>
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
    orderList.querySelectorAll('.item-note').forEach(input => {
        input.addEventListener('input', (event) => {
            updateItemNote(Number(event.target.dataset.itemId), event.target.value);
        });
    });
    totalAmount.textContent = formatMoney(total);
    btnPrint.disabled = false;
    btnPay.disabled = false;
}

function createPendingBill() {
    if (!selectedTable || orderItems.length === 0) {
        return false;
    }

    const bill = {
        id: Date.now() + Math.random(),
        tableName: selectedTable.name,
        tableId: selectedTable.id,
        items: orderItems.map(item => ({ ...item })),
        total: getTotal(),
        createdAt: new Date().toLocaleString('vi-VN')
    };

    pendingBills.push(bill);
    orderItems = [];
    selectedTable.status = 'occupied';
    renderTableGrid();
    updateOrderSummary();
    renderPendingBills();
    return true;
}

function completePendingBill(billId) {
    pendingBills = pendingBills.filter(bill => bill.id !== billId);
    renderPendingBills();
    showToast('Bill đã hoàn thành và đã xóa khỏi danh sách', 'success');
}

function renderPendingBills() {
    const list = document.getElementById('pendingBillsList');
    if (!list) return;

    if (pendingBills.length === 0) {
        list.innerHTML = '<div class="bill-empty">Chưa có bill nào đang chờ pha chế.</div>';
        return;
    }

    list.innerHTML = pendingBills.map(bill => `
        <div class="bill-card">
            <div class="bill-header">
                <span class="bill-table">${bill.tableName}</span>
                <span class="bill-total">${formatMoney(bill.total)}</span>
            </div>
            <ul class="bill-items">
                ${bill.items.map(item => `
                    <li class="bill-item">
                        <span>${item.icon} ${item.name} x${item.quantity}</span>
                        <span>${formatMoney(item.price * item.quantity)}</span>
                    </li>
                    ${item.note ? `<li class="bill-note">Ghi chú: ${item.note}</li>` : ''}
                `).join('')}
            </ul>
            <button class="bill-action" onclick="completePendingBill(${bill.id})">✅ Hoàn thành bill</button>
        </div>
    `).join('');
}

function getTotal() {
    return orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function formatMoney(amount) {
    return amount.toLocaleString('vi-VN') + 'đ';
}

function openPaymentModal() {
    if (orderItems.length === 0) return;
    const total = getTotal();
    document.getElementById('modalTotal').textContent = formatMoney(total);
    document.getElementById('paymentModal').classList.add('active');
    selectedPaymentMethod = null;
    transferConfirmed = false;
    document.getElementById('optCash').classList.remove('selected');
    document.getElementById('optTransfer').classList.remove('selected');
    document.getElementById('qrContainer').classList.remove('active');
    document.getElementById('btnConfirmPayment').disabled = true;
    document.getElementById('transferStatus').className = 'transfer-status';
    document.getElementById('transferStatus').textContent = '';
    document.getElementById('qrCode').innerHTML = '';
}

function closePaymentModal() {
    document.getElementById('paymentModal').classList.remove('active');
    selectedPaymentMethod = null;
    transferConfirmed = false;
    document.getElementById('qrCode').innerHTML = '';
}

function selectPayment(method) {
    selectedPaymentMethod = method;
    transferConfirmed = false;
    document.getElementById('optCash').classList.remove('selected');
    document.getElementById('optTransfer').classList.remove('selected');
    document.getElementById('transferStatus').className = 'transfer-status';
    document.getElementById('transferStatus').textContent = '';

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
    const total = getTotal();
    const qrData = `pay:${total}:${selectedTable ? selectedTable.id : 0}:${orderItems.length}:${Date.now()}`;
    document.getElementById('qrCode').innerHTML = '';
    document.getElementById('qrAmount').textContent = `Số tiền: ${formatMoney(total)}`;
    new QRCode(document.getElementById('qrCode'), {
        text: qrData,
        width: 180,
        height: 180,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });
}

function checkTransfer() {
    if (selectedPaymentMethod !== 'transfer') return;
    const statusEl = document.getElementById('transferStatus');
    const isTransferred = Math.random() > 0.3;
    if (isTransferred) {
        transferConfirmed = true;
        statusEl.className = 'transfer-status success';
        statusEl.textContent = '✅ Đã nhận được chuyển khoản!';
        document.getElementById('btnConfirmPayment').disabled = false;
        showToast('Xác nhận chuyển khoản thành công', 'success');
    } else {
        transferConfirmed = false;
        statusEl.className = 'transfer-status pending';
        statusEl.textContent = '⏳ Chưa thấy giao dịch. Vui lòng thử lại.';
        document.getElementById('btnConfirmPayment').disabled = true;
        showToast('Chưa phát hiện giao dịch', 'error');
    }
}

function confirmPayment() {
    if (orderItems.length === 0) return;
    if (selectedPaymentMethod === 'cash') {
        showToast('✅ Thanh toán tiền mặt thành công!', 'success');
    } else if (selectedPaymentMethod === 'transfer' && transferConfirmed) {
        showToast('✅ Thanh toán chuyển khoản thành công!', 'success');
    } else {
        showToast('❌ Vui lòng kiểm tra chuyển khoản trước!', 'error');
        return;
    }

    if (selectedTable) {
        const mailToKitchen = createPendingBill();
        if (!mailToKitchen) {
            showToast('❌ Không có đơn để gửi pha chế!', 'error');
            return;
        }
        const table = tables.find(t => t.id === selectedTable.id);
        if (table) table.status = 'empty';
        selectedTable.status = 'empty';
        renderTableGrid();
    }

    closePaymentModal();
    updateOrderSummary();

    setTimeout(() => {
        goBackToTables();
    }, 300);
}

function closeReceiptPreview() {
    document.getElementById('printArea').classList.remove('active');
}

function printReceipt() {
    if (orderItems.length === 0) return;
    const total = getTotal();
    const receiptContent = document.getElementById('receiptContent');
    const printArea = document.getElementById('printArea');

    let itemsHtml = '';
    orderItems.forEach(item => {
        itemsHtml += `
            <div class="receipt-line">
                <span>${item.name}</span>
            </div>
        `;
    });

    const receiptData = `bill:${total}:${selectedTable ? selectedTable.id : 0}:${Date.now()}`;

    receiptContent.innerHTML = `
        <div class="receipt-header">
            <div class="receipt-title">Khu Tổ Hợp Đương</div>
            <div style="font-size:0.85rem;">Địa chỉ: 998/3 Quang Trung, Thông Tây Hội TP.HCM</div>
            <div style="font-size:0.85rem;">SĐT: 0333 958 080</div>
            <div class="receipt-table">Bàn: ${selectedTable ? selectedTable.name : '-'}</div>
            <div style="font-size:0.8rem;">Ngày: ${new Date().toLocaleString('vi-VN')}</div>
        </div>
        ${itemsHtml}
        <div class="receipt-total">
            <span>TỔNG CỘNG</span>
            <span>${formatMoney(total)}</span>
        </div>
        <div class="receipt-qr" id="receiptQrContainer"></div>
        <div class="receipt-footer">
            Cảm ơn quý khách! Hẹn gặp lại!
        </div>
        <div class="receipt-actions">
            <button class="btn-preview-action btn-print-action" onclick="window.print()">🖨️ In hóa đơn</button>
            <button class="btn-preview-action btn-close-action" onclick="closeReceiptPreview()">✖ Đóng</button>
        </div>
    `;

    printArea.classList.add('active');

    const qrContainer = document.getElementById('receiptQrContainer');
    new QRCode(qrContainer, {
        text: receiptData,
        width: 120,
        height: 120,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });
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

init();
