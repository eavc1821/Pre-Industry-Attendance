const express = require('express');
const { getQuery, allQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats - Estadísticas del dashboard
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Obtener todas las estadísticas en paralelo
    const [
      totalEmployees,
      todayAttendance,
      pendingExits,
      weeklyStats,
      recentActivity
    ] = await Promise.all([
      // Total de empleados activos
      getQuery('SELECT COUNT(*) as count FROM employees WHERE is_active = 1'),
      
      // Asistencia de hoy
      getQuery('SELECT COUNT(*) as count FROM attendance WHERE date = ?', [today]),
      
      // Salidas pendientes
      getQuery(`
        SELECT COUNT(*) as count 
        FROM attendance 
        WHERE date = ? AND exit_time IS NULL
      `, [today]),
      
      // Estadísticas semanales
      getQuery(`
        SELECT 
          COUNT(DISTINCT employee_id) as employees_this_week,
          SUM(
            CASE 
              WHEN exit_time IS NOT NULL THEN 
                (julianday(exit_time) - julianday(entry_time)) * 24
              ELSE 0 
            END
          ) as total_hours
        FROM attendance 
        WHERE date BETWEEN date('now', '-7 days') AND ?
      `, [today]),
      
      // Actividad reciente (últimos 5 registros)
      allQuery(`
        SELECT 
          e.name as employee_name,
          a.date,
          a.entry_time,
          a.exit_time,
          CASE 
            WHEN a.exit_time IS NULL THEN 'Entrada'
            ELSE 'Salida'
          END as action_type
        FROM attendance a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.date = ?
        ORDER BY a.entry_time DESC
        LIMIT 5
      `, [today])
    ]);

    // Calcular horas semanales
    const weeklyHours = weeklyStats ? Math.round(weeklyStats.total_hours * 10) / 10 : 0;

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

// GET /api/dashboard/attendance-today - Asistencia de hoy
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
        END as status
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date = ?
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