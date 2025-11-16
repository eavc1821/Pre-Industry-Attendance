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

      // Eliminar registros
      await runQuery('DELETE FROM attendance');
      await runQuery('DELETE FROM employees');

      // Reiniciar autoincrementos (PostgreSQL)
      await runQuery('ALTER SEQUENCE employees_id_seq RESTART WITH 1');
      await runQuery('ALTER SEQUENCE attendance_id_seq RESTART WITH 1');

      res.json({
        success: true,
        message: 'Base de datos reseteada exitosamente (PostgreSQL). Usuarios intactos.'
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
