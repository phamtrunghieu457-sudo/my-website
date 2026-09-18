const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cafe_db';

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

async function ensureSchema() {
  const defaultTables = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    name: `Bàn ${index + 1}`,
    status: 'empty'
  }));

  const defaultMenu = [
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
    { id: 12, name: 'Matcha đá xay', price: 45000, icon: '🍵' }
  ];

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
        icon TEXT DEFAULT '☕'
      )
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

    for (const item of defaultMenu) {
      await client.query(
        `INSERT INTO menu_items (id, name, price, icon)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [item.id, item.name, item.price, item.icon]
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

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, message: 'API cafe đang hoạt động', port: PORT });
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
  const { name, price, icon } = req.body;

  if (!name || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    return res.status(400).json({ error: 'Tên và giá món không hợp lệ' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO menu_items (name, price, icon) VALUES ($1, $2, $3) RETURNING *',
      [name, Number(price), icon || '☕']
    );

    return res.json(result.rows[0]);
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

app.get('/api/tables', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tables ORDER BY id ASC');
    return res.json(result.rows);
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
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Không tìm thấy bàn' });
    }

    return res.json({ success: true, tableId: Number(id), status: result.rows[0].status });
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
      'INSERT INTO orders (table_id, table_name, total, status, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [tableId, tableName, Number(total), 'pending']
    );

    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, item_id, name, icon, price, quantity, note) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [orderId, item.id, item.name, item.icon || '☕', item.price, item.quantity, item.note || '']
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, orderId, message: 'Đơn hàng đã được lưu vào database' });
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

    const result = [];
    for (const order of orders) {
      const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
      result.push({ ...order, items: itemsResult.rows });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);
    const result = await client.query('DELETE FROM orders WHERE id = $1 RETURNING *', [id]);
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
      'INSERT INTO payments (order_id, method, amount, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [orderId, method, Number(amount)]
    );

    return res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/revenue', async (req, res) => {
  try {
    const result = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total FROM payments');
    return res.json({ total: Number(result.rows[0].total || 0) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/revenue-by-day', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT date(created_at) AS date, COALESCE(SUM(amount), 0) AS total
      FROM payments
      GROUP BY date(created_at)
      ORDER BY date(created_at) ASC
    `);

    const points = (result.rows || []).map((row) => ({
      date: row.date,
      total: Number(row.total || 0)
    }));

    return res.json({ points });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

async function start() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`API đang chạy tại http://localhost:${PORT}`);
  });
}

start();
