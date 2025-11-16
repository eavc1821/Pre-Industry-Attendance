const express = require('express');
const router = express.Router();
const { runQuery, allQuery } = require('../config/database');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

// Resetear base de datos (mantener usuarios)
router.delete(
  '/reset-database',
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      console.log('🧹 Iniciando reset de base de datos...');

      await runQuery('DELETE FROM attendance');
      await runQuery('DELETE FROM employees');
      await runQuery('DELETE FROM sqlite_sequence WHERE name IN ("employees", "attendance")');

      res.json({
        success: true,
        message: 'Base de datos reseteada exitosamente. Usuarios mantienen intactos.'
      });

    } catch (error) {
      console.error('❌ Error reseteando base de datos:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno al resetear la base de datos: ' + error.message
      });
    }
  }
);

module.exports = router;
