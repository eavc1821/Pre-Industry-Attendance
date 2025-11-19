const express = require('express');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');

const router = express.Router();

function getLocalDate() {
  const now = new Date();
  const HondurasOffset = -6; // UTC-6
  const local = new Date(now.getTime() + HondurasOffset * 60 * 60 * 1000);

  const pad = (n) => n.toString().padStart(2, '0');

  const year = local.getFullYear();
  const month = pad(local.getMonth() + 1);
  const day = pad(local.getDate());

  return `${year}-${month}-${day}`;
}


function getLocalTimestamp() {
  const now = new Date();
  const HondurasOffset = -6; // UTC-6
  const local = new Date(now.getTime() + HondurasOffset * 60 * 60 * 1000);

  const pad = (n) => n.toString().padStart(2, '0');

  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ` +
         `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`;
}

function getLocalTimeOnly() {
  const now = new Date();
  const HondurasOffset = -6; 
  const local = new Date(now.getTime() + HondurasOffset * 60 * 60 * 1000);

  const pad = (n) => n.toString().padStart(2, '0');

  return `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`;
}




/* ================================================================
   POST /api/attendance/entry - Registrar entrada
================================================================ */
router.post('/entry', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const { employee_id } = req.body;
    const today = getLocalDate();

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        error: 'ID de empleado es requerido'
      });
    }

    const employee = await getQuery(
      'SELECT id, name, type FROM employees WHERE id = $1 AND is_active = TRUE',
      [employee_id]
    );

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Empleado no encontrado o inactivo'
      });
    }

    const existingRecord = await getQuery(
      'SELECT id, exit_time FROM attendance WHERE employee_id = $1 AND date = $2',
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

    const now = new Date();

    const entryTimestamp = getLocalTimestamp(); // TIMESTAMP local
    const entryTimeOnly = getLocalTimeOnly();   // HH:MM:SS local


    const result = await runQuery(
      `INSERT INTO attendance (employee_id, date, entry_time, created_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id`,
      [employee_id, today, entryTimeOnly, entryTimestamp]
    );


      console.log("🟦 RESULTADO INSERT:", result);

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
   POST /api/attendance/exit - Registrar salida
================================================================ */
router.post('/exit', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const { employee_id, hours_extra = 0, despalillo = 0, escogida = 0, monado = 0 } = req.body;
    const today = getLocalDate();

    if (!employee_id) {
      return res.status(400).json({ success: false, error: 'ID de empleado es requerido' });
    }

    const employee = await getQuery(
      'SELECT id, name, type, is_active FROM employees WHERE id = $1',
      [employee_id]
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Empleado no encontrado' });
    }

    if (!employee.is_active) {
      return res.status(400).json({ success: false, error: 'Empleado está inactivo' });
    }

    // Buscar entrada activa
    const attendanceRecord = await getQuery(
      `SELECT * 
       FROM attendance 
       WHERE employee_id = $1 
         AND date = $2 
         AND exit_time IS NULL`,
      [employee_id, today]
    );

    if (!attendanceRecord) {
      return res.status(400).json({
        success: false,
        error: 'No existe entrada pendiente para hoy.'
      });
    }

    const exitTime = getLocalTimeOnly(); // HH:MM:SS

    // Valores puros a almacenar
    const hoursExtraNum = parseFloat(hours_extra) || 0;
    const desNum = parseFloat(despalillo) || 0;
    const escNum = parseFloat(escogida) || 0;
    const monNum = parseFloat(monado) || 0;

    await runQuery(
      `UPDATE attendance 
       SET exit_time = $1,
           hours_extra = $2,
           despalillo = $3,
           escogida = $4,
           monado = $5
       WHERE id = $6`,
      [
        exitTime,
        employee.type === 'Al Día' ? hoursExtraNum : 0,
        employee.type === 'Producción' ? desNum : 0,
        employee.type === 'Producción' ? escNum : 0,
        employee.type === 'Producción' ? monNum : 0,
        attendanceRecord.id
      ]
    );

    res.json({
      success: true,
      message: `Salida registrada para ${employee.name}`,
      data: {
        employee_id,
        employee_name: employee.name,
        employee_type: employee.type.toLowerCase(),
        date: today,
        entry_time: attendanceRecord.entry_time,
        exit_time: exitTime,

        // Datos puros diarios
        hours_extra: hoursExtraNum,
        despalillo: desNum,
        escogida: escNum,
        monado: monNum,

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
   GET /api/attendance/today
================================================================ */
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const today = getLocalDate();

    const records = await allQuery(
      `
      SELECT 
        a.id,
        a.employee_id,
        a.entry_time,
        a.exit_time,
        a.date,
        a.hours_extra,
        a.t_despalillo,
        a.t_escogida,
        a.t_monado,
        a.septimo_dia,
        a.prop_sabado,

        e.name AS employee_name,
        e.dni AS employee_dni,
        e.type AS employee_type,
        e.photo

      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date = $1
      ORDER BY a.entry_time DESC
    `,
      [today]
    );

    const processed = (records || []).map(r => {
      
      const typeNorm = (r.employee_type || "").trim().toLowerCase();

      return {
        id: r.id,
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        employee_dni: r.employee_dni,
        employee_type: typeNorm,
        photo: r.photo,

        // Times formatted HH:mm
        entry_time: r.entry_time,
        exit_time: r.exit_time,
        entry_time_display: r.entry_time ? r.entry_time.substring(0,5) : '-',
        exit_time_display: r.exit_time ? r.exit_time.substring(0,5) : '-',
        date: r.date,

        // Work state
        is_working: r.exit_time === null,
        status: r.exit_time === null ? "active" : "completed",
        status_text: r.exit_time === null ? "En Trabajo" : "Completado",

        // Raw attendance values
        hours_extra: Number(r.hours_extra) || 0,

        // Production fields
        total_despalillo: Number(r.t_despalillo) || 0,
        total_escogida: Number(r.t_escogida) || 0,
        total_monado: Number(r.t_monado) || 0,
        saturday_bonus: Number(r.prop_sabado) || 0,
        seventh_day: Number(r.septimo_dia) || 0
      };
    });

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
