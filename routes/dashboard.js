const express = require('express');
const { getQuery, allQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/* ================================================================
   GET /api/dashboard/stats
   Estadísticas del dashboard (PostgreSQL compatible)
================================================================ */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [
      totalEmployees,
      todayAttendance,
      pendingExits,
      weeklyStats,
      recentActivity
    ] = await Promise.all([
      
      // Total empleados activos
      getQuery(`
        SELECT COUNT(*) AS count 
        FROM employees 
        WHERE is_active = TRUE
      `),

      // Asistencia de hoy
      getQuery(`
        SELECT COUNT(*) AS count 
        FROM attendance 
        WHERE date = $1
      `, [today]),

      // Salidas pendientes hoy
      getQuery(`
        SELECT COUNT(*) AS count 
        FROM attendance 
        WHERE date = $1 
          AND exit_time IS NULL
      `, [today]),

      // Estadísticas semanales (últimos 7 días)
      getQuery(`
        SELECT 
          COUNT(DISTINCT employee_id) AS employees_this_week,
          SUM(
            CASE 
              WHEN exit_time IS NOT NULL THEN 
                EXTRACT(EPOCH FROM (exit_time - entry_time)) / 3600
              ELSE 0
            END
          ) AS total_hours
        FROM attendance
        WHERE date BETWEEN (CURRENT_DATE - INTERVAL '7 days') AND CURRENT_DATE
      `),

      // Actividad reciente de HOY
      allQuery(`
        SELECT 
          e.name AS employee_name,
          a.date,
          a.entry_time,
          a.exit_time,
          CASE 
            WHEN a.exit_time IS NULL THEN 'Entrada'
            ELSE 'Salida'
          END AS action_type
        FROM attendance a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.date = $1
        ORDER BY a.entry_time DESC
        LIMIT 5
      `, [today])
    ]);

    const weeklyHours =
      weeklyStats && weeklyStats.total_hours
        ? Math.round(weeklyStats.total_hours * 10) / 10
        : 0;

    res.json({
      success: true,
      data: {
        totalEmployees: totalEmployees?.count || 0,
        todayAttendance: todayAttendance?.count || 0,
        pendingExits: pendingExits?.count || 0,
        weeklyHours: weeklyHours,
        weeklyEmployees: weeklyStats?.employees_this_week || 0,
        recentActivity: recentActivity || []
      },
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas del dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas del dashboard'
    });
  }
});

/* ================================================================
   GET /api/dashboard/attendance-today
   Asistencia del día actual
================================================================ */
router.get('/attendance-today', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const attendance = await allQuery(`
      SELECT 
        e.name,
        e.type,
        e.photo,
        a.entry_time,
        a.exit_time,
        a.hours_extra,
        CASE 
          WHEN a.exit_time IS NULL THEN 'working'
          ELSE 'completed'
        END AS status
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date = $1
      ORDER BY a.entry_time DESC
    `, [today]);

    res.json({
      success: true,
      data: attendance,
      date: today,
      count: attendance.length
    });

  } catch (error) {
    console.error('Error obteniendo asistencia de hoy:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener asistencia de hoy'
    });
  }
});

module.exports = router;
