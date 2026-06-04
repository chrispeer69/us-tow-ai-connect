const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ustow:ustow_dev@localhost:5435/ustow' });
pool.query('SELECT id, email, "googleId", "passwordHash" IS NOT NULL as has_password FROM users').then(res => {
  console.log(res.rows);
  process.exit(0);
});
