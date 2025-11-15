const express = require('express');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');

const router = express.Router();

const getLocalDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/* ================================================================
   POST /api/attendance/entry - Registrar entrada (TIMESTAMP REAL)
   ================================================================ */
router.post('/entry', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const { employee_id } = req.body;
    const today = getLocalDate();

    console.log('📥 Recibiendo solicitud de entrada:', { employee_id, today });

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        error: 'ID de empleado es requerido'
      });
    }

    // Verificar si el empleado existe
    const employee = await getQuery(
      'SELECT id, name, type FROM employees WHERE id = ? AND is_active = true',
      [employee_id]
    );

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado o inactivo'
      });
    }

    // Verificar si ya existe entrada hoy
    const existingRecord = await getQuery(
      'SELECT id, exit_time FROM attendance WHERE employee_id = ? AND date = ?',
      [employee_id, today]
    );

    if (existingRecord) {
      if (!existingRecord.exit_time) {
        return res.status(400).json({
          success: false,
          error: 'Ya existe una entrada activa para hoy. Registre la salida primero.'
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'El empleado ya completó su jornada hoy.'
        });
      }
    }

    // Obtener timestamp completo
    const entryTimestamp = new Date().toISOString();

    console.log('⏰ Registrando entrada:', { entryTimestamp });

    const result = await runQuery(
      `INSERT INTO attendance (employee_id, date, entry_time, created_at)
       VALUES (?, ?, ?, ?)`,
      [employee_id, today, entryTimestamp, entryTimestamp]
    );

    res.status(201).json({
      success: true,
      message: `Entrada registrada para ${employee.name}`,
      data: {
        id: result.id,
        employee_id,
        employee_name: employee.name,
        employee_type: employee.type,
        date: today,
        entry_time: entryTimestamp,
        entry_datetime: entryTimestamp,
        status: 'active'
      }
    });

  } catch (error) {
    console.error('❌ Error registrando entrada:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al registrar entrada'
    });
  }
});

/* ================================================================
   POST /api/attendance/exit - Registrar salida (TIMESTAMP REAL)
   ================================================================ */
router.post('/exit', authenticateToken, requireAdminOrScanner, async (req, res) => {
  console.log('🚨 ===== INICIANDO REGISTRO DE SALIDA =====');

  try {
    const { employee_id, hours_extra = 0, despalillo = 0, escogida = 0, monado = 0 } = req.body;
    const today = getLocalDate();

    if (!employee_id) {
      return res.status(400).json({ success: false, error: 'ID de empleado es requerido' });
    }

    const employeeIdNum = parseInt(employee_id);

    const employee = await getQuery(
      'SELECT id, name, type, is_active FROM employees WHERE id = ?',
      [employeeIdNum]
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Empleado no encontrado' });
    }

    if (!employee.is_active) {
      return res.status(400).json({ success: false, error: 'Empleado está inactivo' });
    }

    // Verificar entrada activa
    const attendanceRecord = await getQuery(
      `SELECT a.*, e.name, e.type 
       FROM attendance a 
       JOIN employees e ON a.employee_id = e.id 
       WHERE a.employee_id = ? AND a.date = ? AND a.exit_time IS NULL`,
      [employeeIdNum, today]
    );

    if (!attendanceRecord) {
      return res.status(400).json({
        success: false,
        error: 'No existe entrada pendiente para hoy.'
      });
    }

    // Convertir números
    const hoursExtraNum = parseFloat(hours_extra) || 0;
    const despalilloNum = parseFloat(despalillo) || 0;
    const escogidaNum = parseFloat(escogida) || 0;
    const monadoNum = parseFloat(monado) || 0;

    // Cálculos producción
    let t_despalillo = 0,
        t_escogida = 0,
        t_monado = 0,
        prop_sabado = 0,
        septimo_dia = 0;

    if (employee.type === 'Producción') {
      t_despalillo = despalilloNum * 80;
      t_escogida = escogidaNum * 70;
      t_monado = monadoNum * 1;

      const total_produccion = t_despalillo + t_escogida + t_monado;

      prop_sabado = total_produccion * 0.90909;
      septimo_dia = total_produccion * 0.181818;
    }

    // Timestamp real para salida
    const exitTimestamp = new Date().toISOString();

    console.log('🔄 Ejecutando UPDATE...');

    await runQuery(
      `UPDATE attendance 
       SET exit_time = ?, 
           hours_extra = ?, 
           despalillo = ?, 
           escogida = ?, 
           monado = ?,
           t_despalillo = ?, 
           t_escogida = ?, 
           t_monado = ?, 
           prop_sabado = ?, 
           septimo_dia = ?
       WHERE id = ?`,
      [
        exitTimestamp,
        hoursExtraNum,
        despalilloNum,
        escogidaNum,
        monadoNum,
        t_despalillo,
        t_escogida,
        t_monado,
        prop_sabado,
        septimo_dia,
        attendanceRecord.id
      ]
    );

    res.json({
      success: true,
      message: `Salida registrada para ${employee.name}`,
      data: {
        employee_id: employeeIdNum,
        employee_name: employee.name,
        employee_type: employee.type,
        date: today,
        entry_time: attendanceRecord.entry_time,
        exit_time: exitTimestamp,
        hours_extra: hoursExtraNum,
        despalillo: despalilloNum,
        escogida: escogidaNum,
        monado: monadoNum,
        t_despalillo,
        t_escogida,
        t_monado,
        prop_sabado,
        septimo_dia,
        status: 'completed'
      }
    });

  } catch (error) {
    console.error('🚨 Error en salida:', error);
    res.status(500).json({
      success: false,
      error: `Error al registrar salida: ${error.message}`
    });
  }
});

/* ================================================================
   GET /api/attendance/today - Registros del día actual
   ================================================================ */
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const today = getLocalDate();

    const records = await allQuery(
      `
      SELECT 
        a.*,
        e.name as employee_name,
        e.dni as employee_dni,
        e.type as employee_type,
        e.photo,
        CASE 
          WHEN a.exit_time IS NULL THEN 'active'
          ELSE 'completed'
        END as status
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date = ?
      ORDER BY a.entry_time DESC
    `,
      [today]
    );

    const processed = records.map(r => ({
      ...r,
      entry_time_display: r.entry_time,
      exit_time_display: r.exit_time || '-',
      status_text: r.exit_time ? 'Completado' : 'En Trabajo'
    }));

    res.json({
      success: true,
      data: processed,
      count: processed.length
    });

  } catch (error) {
    console.error('❌ Error obteniendo registros:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener registros de hoy'
    });
  }
});

module.exports = router;
