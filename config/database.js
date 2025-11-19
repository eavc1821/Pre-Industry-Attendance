// ===============================================================
// PostgreSQL Database Adapter (Compatible con todo tu backend)
// ===============================================================

const { Pool } = require('pg');

// 🚨 Requiere variable DATABASE_URL en Railway
if (!process.env.DATABASE_URL) {
  console.error("❌ ERROR FATAL: Falta DATABASE_URL en las variables de entorno");
  process.exit(1);
}

console.log(">>> USING DATABASE_URL:", process.env.DATABASE_URL);


// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Railway usa SSL obligatorio
});

// ===============================================================
// Helper: convierte "?" en "$1, $2, ..." automáticamente
// ===============================================================
function replacePlaceholders(sql, params) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

// ===============================================================
// runQuery → INSERT / UPDATE / DELETE
// ===============================================================
async function runQuery(sql, params = []) {
  try {
    const pgSQL = replacePlaceholders(sql, params);
    const result = await pool.query(pgSQL, params);

    return {
      id: result.rows[0]?.id || null,
      changes: result.rowCount
    };

  } catch (error) {
    console.error("❌ Error en runQuery:", error.message);
    throw error;
  }
}

// ===============================================================
// getQuery → SELECT 1 registro
// ===============================================================
async function getQuery(sql, params = []) {
  try {
    const pgSQL = replacePlaceholders(sql, params);
    const result = await pool.query(pgSQL, params);
    return result.rows[0] || null;

  } catch (error) {
    console.error("❌ Error en getQuery:", error.message);
    throw error;
  }
}

// ===============================================================
// allQuery → SELECT múltiples registros
// ===============================================================
async function allQuery(sql, params = []) {
  try {
    const pgSQL = replacePlaceholders(sql, params);
    const result = await pool.query(pgSQL, params);
    return result.rows || [];

  } catch (error) {
    console.error("❌ Error en allQuery:", error.message);
    throw error;
  }
}

module.exports = {
  pool,
  runQuery,
  getQuery,
  allQuery
};
