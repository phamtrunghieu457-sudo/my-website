const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cafe_db';

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:8080',
  'https://phamtrunghieu457-sudo.github.io',
  'https://phamtrunghieu457-sudo.github.io/my-website'
];

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());

async function ensureSchema() {
  const defaultTables = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    name: `Bàn ${index + 1}`,
    status: 'empty'
  }));

  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin'
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        icon TEXT DEFAULT '☕',
        category TEXT DEFAULT 'Khác'
      )
    `);

    await client.query(`
      ALTER TABLE menu_items
      ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Khác'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'empty'
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        table_id INTEGER NOT NULL,
        table_name TEXT NOT NULL,
        total INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '☕',
        price INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        note TEXT DEFAULT ''
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        method TEXT NOT NULL,
        amount INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS revenue_summary (
        id INTEGER PRIMARY KEY DEFAULT 1,
        total INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(
      `INSERT INTO revenue_summary (id, total, updated_at)
       VALUES (1, 0, NOW())
       ON CONFLICT (id) DO NOTHING`
    );

    await client.query(
      `INSERT INTO users (username, password, role)
       VALUES ('admin', '123456', 'admin')
       ON CONFLICT (username) DO NOTHING`
    );

    for (const table of defaultTables) {
      await client.query(
        `INSERT INTO tables (id, name, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [table.id, table.name, table.status]
      );
    }

    console.log('PostgreSQL schema ready');
  } finally {
    client.release();
  }
}

async function testConnection() {
  try {
    await pool.query('SELECT 1');
    console.log('Đã kết nối PostgreSQL');
    await ensureSchema();
  } catch (error) {
    console.error('Không thể kết nối PostgreSQL:', error.message);
    process.exit(1);
  }
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, message: 'Database cafe đang hoạt động' });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
    }

    return res.json({
      success: true,
      user: { id: row.id, username: row.username, role: row.role }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
});

app.get('/api/menu', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM menu_items ORDER BY id ASC');
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/menu', async (req, res) => {
  const { name, price, icon, category } = req.body;

  if (!name || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    return res.status(400).json({ error: 'Tên và giá món không hợp lệ' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO menu_items (name, price, icon, category) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, Number(price), icon || '☕', category || 'Khác']
    );

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/menu/:id', async (req, res) => {
  const { id } = req.params;
  const { name, price, icon, category } = req.body;

  if (!name || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    return res.status(400).json({ error: 'Tên và giá món không hợp lệ' });
  }

  try {
    const result = await pool.query(
      'UPDATE menu_items SET name = $1, price = $2, icon = $3, category = $4 WHERE id = $5 RETURNING *',
      [name, Number(price), icon || '☕', category || 'Khác', Number(id)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Không tìm thấy món cần sửa' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/menu/categories', async (req, res) => {
  const { from, to } = req.body;
  const source = String(from || '').trim() || 'Khác';
  const target = String(to || '').trim() || 'Khác';

  if (!source || source === target) {
    return res.json({ success: true, updatedCount: 0, category: target });
  }

  try {
    const result = await pool.query(
      'UPDATE menu_items SET category = $1 WHERE category = $2 RETURNING *',
      [target, source]
    );

    return res.json({ success: true, updatedCount: result.rowCount, category: target });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/menu/categories', async (req, res) => {
  const { category, from, name } = req.body || {};
  const target = String(category || from || name || '').trim() || 'Khác';

  if (!target || target === 'Khác' && !req.body) {
    return res.json({ success: true, deletedCount: 0, category: target });
  }

  try {
    const result = await pool.query(
      'DELETE FROM menu_items WHERE category = $1 RETURNING *',
      [target]
    );

    return res.json({ success: true, deletedCount: result.rowCount, category: target });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/menu/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM menu_items WHERE id = $1 RETURNING *', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Không tìm thấy món cần xóa' });
    }

    return res.json({ success: true, deletedId: Number(id) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/menu/reset', async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_items');
    await pool.query('ALTER SEQUENCE menu_items_id_seq RESTART WITH 1');

    return res.json({ success: true, message: 'Đã reset menu về rỗng' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/tables', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tables ORDER BY id ASC');
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const { tableId, tableName, items, total } = req.body;

  if (!tableId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Dữ liệu đơn hàng không hợp lệ' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (table_id, table_name, total, status, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id',
      [Number(tableId), tableName, Number(total), 'pending']
    );

    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, item_id, name, icon, price, quantity, note) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [orderId, item.id, item.name, item.icon || '☕', Number(item.price), Number(item.quantity || 1), item.note || '']
      );
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      orderId,
      message: 'Đơn hàng đã được lưu vào database'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const ordersResult = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    const orders = ordersResult.rows;

    const result = await Promise.all(orders.map(async (order) => {
      const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
      return { ...order, items: itemsResult.rows };
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/pending', async (req, res) => {
  try {
    const ordersResult = await pool.query('SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC', ['pending']);
    const orders = ordersResult.rows;

    const result = await Promise.all(orders.map(async (order) => {
      const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
      return {
        ...order,
        items: itemsResult.rows.map((item) => ({
          ...item,
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0)
        }))
      };
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/revenue', async (req, res) => {
  try {
    const summaryResult = await pool.query('SELECT total FROM revenue_summary WHERE id = 1');
    if (summaryResult.rows[0]) {
      return res.json({ total: Number(summaryResult.rows[0].total || 0) });
    }

    const paymentResult = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total FROM payments');
    return res.json({ total: Number(paymentResult.rows[0]?.total || 0) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/revenue', async (req, res) => {
  const { total } = req.body;
  const revenueAmount = Number(total);

  if (!Number.isFinite(revenueAmount) || revenueAmount <= 0) {
    return res.status(400).json({ error: 'Tổng tiền không hợp lệ' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO revenue_summary (id, total, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET
         total = revenue_summary.total + EXCLUDED.total,
         updated_at = NOW()
       RETURNING *`,
      [revenueAmount]
    );

    return res.json({ success: true, total: Number(result.rows[0].total || 0) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/revenue-by-day', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT TO_CHAR(created_at::date, 'YYYY-MM-DD') AS date, COALESCE(SUM(amount), 0) AS total
       FROM payments
       GROUP BY created_at::date
       ORDER BY created_at::date ASC`
    );

    const points = (result.rows || []).map((row) => ({
      date: row.date,
      total: Number(row.total || 0)
    }));

    return res.json({ points });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/tables/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Thiếu trạng thái bàn' });
  }

  try {
    const result = await pool.query(
      'UPDATE tables SET status = $1 WHERE id = $2 RETURNING *',
      [status, Number(id)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Không tìm thấy bàn' });
    }

    return res.json({ success: true, tableId: Number(id), status });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Thiếu trạng thái đơn hàng' });
  }

  try {
    const result = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, Number(id)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    }

    return res.json({ success: true, orderId: Number(id), status });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM order_items WHERE order_id = $1', [Number(id)]);
    const result = await client.query('DELETE FROM orders WHERE id = $1 RETURNING id', [Number(id)]);
    await client.query('COMMIT');

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    }

    return res.json({ success: true, deletedOrderId: Number(id) });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/payments', async (req, res) => {
  const { orderId, method, amount } = req.body;

  if (!orderId || !method || !Number.isFinite(Number(amount))) {
    return res.status(400).json({ error: 'Dữ liệu thanh toán không hợp lệ' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO payments (order_id, method, amount, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
      [Number(orderId), method, Number(amount)]
    );

    return res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    ok: true,
    message: 'This app is configured as a dedicated API backend. Serve the frontend statically from GitHub Pages or a separate static server.',
    apiBase: `http://localhost:${PORT}`
  });
});

testConnection();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server đang chạy tại http://0.0.0.0:${PORT}`);
});
