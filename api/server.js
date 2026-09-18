const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3001;
const dbDir = path.join(__dirname, '..', 'database');
const dbPath = path.join(dbDir, 'cafe.db');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Không thể mở database:', err.message);
    process.exit(1);
  }
  console.log('Đã kết nối SQLite:', dbPath);
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

function seedInitialData() {
  const defaultTables = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    name: `Bàn ${index + 1}`,
    status: 'empty'
  }));

  const defaultMenu = [
    { id: 1, name: 'Cà phê sữa', price: 25000, icon: '☕' },
    { id: 2, name: 'Cà phê đen', price: 22000, icon: '☕' },
    { id: 3, name: 'Trà sữa trân châu', price: 35000, icon: '🧋' },
    { id: 4, name: 'Trà đào', price: 30000, icon: '🍑' },
    { id: 5, name: 'Sinh tố bơ', price: 40000, icon: '🥤' },
    { id: 6, name: 'Nước cam', icon: '🍊', price: 28000 },
    { id: 7, name: 'Nước dừa', icon: '🥥', price: 25000 },
    { id: 8, name: 'Matcha đá xay', icon: '🍵', price: 45000 },
    { id: 9, name: 'Espresso', icon: '☕', price: 30000 },
    { id: 10, name: 'Bạc xỉu', icon: '🥛', price: 27000 },
    { id: 11, name: 'Milk tea', icon: '🍼', price: 32000 },
    { id: 12, name: 'Nước suối', icon: '💧', price: 15000 }
  ];

  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'admin'
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        price INTEGER,
        icon TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY,
        name TEXT,
        status TEXT DEFAULT 'empty'
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER,
        table_name TEXT,
        total INTEGER,
        status TEXT DEFAULT 'pending',
        created_at TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        item_id INTEGER,
        name TEXT,
        icon TEXT,
        price INTEGER,
        quantity INTEGER,
        note TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        method TEXT,
        amount INTEGER,
        created_at TEXT
      )
    `);

    db.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES ('admin', '123456', 'admin')`);

    defaultTables.forEach((table) => {
      db.run(
        'INSERT OR IGNORE INTO tables (id, name, status) VALUES (?, ?, ?)',
        [table.id, table.name, table.status]
      );
    });

    defaultMenu.forEach((item) => {
      db.run(
        'INSERT OR IGNORE INTO menu_items (id, name, price, icon) VALUES (?, ?, ?, ?)',
        [item.id, item.name, item.price, item.icon]
      );
    });
  });
}

seedInitialData();

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'API cafe đang hoạt động', port: PORT });
});

app.get('/api/menu', (req, res) => {
  db.all('SELECT * FROM menu_items ORDER BY id ASC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    return res.json(rows);
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
    if (!row) return res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
    return res.json({ success: true, user: { id: row.id, username: row.username, role: row.role } });
  });
});

app.get('/api/tables', (req, res) => {
  db.all('SELECT * FROM tables ORDER BY id ASC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    return res.json(rows);
  });
});

app.post('/api/orders', (req, res) => {
  const { tableId, tableName, items, total } = req.body;

  if (!tableId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Dữ liệu đơn hàng không hợp lệ' });
  }

  const createdAt = new Date().toISOString();
  db.run(
    'INSERT INTO orders (table_id, table_name, total, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [tableId, tableName, Number(total), 'pending', createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const orderId = this.lastID;
      Promise.all(items.map((item) => new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO order_items (order_id, item_id, name, icon, price, quantity, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [orderId, item.id, item.name, item.icon || '☕', item.price, item.quantity, item.note || ''],
          (innerErr) => innerErr ? reject(innerErr) : resolve()
        );
      })))
        .then(() => res.json({ success: true, orderId, message: 'Đơn hàng đã được lưu vào database' }))
        .catch((error) => res.status(500).json({ error: error.message }));
    }
  );
});

app.get('/api/orders', (req, res) => {
  db.all('SELECT * FROM orders ORDER BY created_at DESC', (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });
    const orderPromises = orders.map((order) => new Promise((resolve) => {
      db.all('SELECT * FROM order_items WHERE order_id = ?', [order.id], (innerErr, items) => {
        if (innerErr) return resolve({ ...order, items: [] });
        resolve({ ...order, items });
      });
    }));

    Promise.all(orderPromises)
      .then((result) => res.json(result))
      .catch((error) => res.status(500).json({ error: error.message }));
  });
});

app.get('/api/revenue', (req, res) => {
  db.get('SELECT COALESCE(SUM(amount), 0) AS total FROM payments', (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    return res.json({ total: Number(row?.total || 0) });
  });
});

app.get('/api/revenue-by-day', (req, res) => {
  db.all(
    `SELECT date(created_at) AS date, COALESCE(SUM(amount), 0) AS total
     FROM payments
     GROUP BY date(created_at)
     ORDER BY date(created_at) ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const points = (rows || []).map((row) => ({ date: row.date, total: Number(row.total || 0) }));
      return res.json({ points });
    }
  );
});

app.post('/api/payments', (req, res) => {
  const { orderId, method, amount } = req.body;

  if (!orderId || !method || !Number.isFinite(Number(amount))) {
    return res.status(400).json({ error: 'Dữ liệu thanh toán không hợp lệ' });
  }

  db.run(
    'INSERT INTO payments (order_id, method, amount, created_at) VALUES (?, ?, ?, ?)',
    [orderId, method, Number(amount), new Date().toISOString()],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      return res.json({ success: true, id: this.lastID });
    }
  );
});

app.put('/api/tables/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) return res.status(400).json({ error: 'Thiếu trạng thái bàn' });

  db.run('UPDATE tables SET status = ? WHERE id = ?', [status, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Không tìm thấy bàn' });
    return res.json({ success: true, tableId: Number(id), status });
  });
});

app.delete('/api/orders/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM order_items WHERE order_id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run('DELETE FROM orders WHERE id = ?', [id], function (deleteErr) {
      if (deleteErr) return res.status(500).json({ error: deleteErr.message });
      return res.json({ success: true, deletedOrderId: Number(id) });
    });
  });
});

app.delete('/api/menu/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM menu_items WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Không tìm thấy món cần xóa' });
    return res.json({ success: true, deletedId: Number(id) });
  });
});

app.post('/api/menu', (req, res) => {
  const { name, price, icon } = req.body;
  if (!name || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    return res.status(400).json({ error: 'Tên và giá món không hợp lệ' });
  }

  db.run(
    'INSERT INTO menu_items (name, price, icon) VALUES (?, ?, ?)',
    [name, Number(price), icon || '☕'],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      return res.json({ id: this.lastID, name, price: Number(price), icon: icon || '☕' });
    }
  );
});

app.listen(PORT, () => {
  console.log(`API đang chạy tại http://localhost:${PORT}`);
});
