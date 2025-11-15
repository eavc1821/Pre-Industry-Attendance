const express = require('express');
const { allQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/* ================================================================
   GET /api/reports/daily - Reporte diario
   ================================================================ */
router.get('/daily', authenticateToken, async (req, res) => {
  try {
    const { date } = req.query;
    const reportDate = date || new Date().toISOString().split('T')[0];

    const records = await allQuery(
      `
      SELECT 
        e.id as employee_id,
        e.name as employee_name,
        e.dni,
        e.type as employee_type,
        e.photo,
        a.entry_time,
        a.exit_time,
        a.hours_extra,
        a.despalillo,
        a.escogida,
        a.monado,
        CASE 
          WHEN a.entry_time IS NOT NULL AND a.exit_time IS NULL THEN 'En trabajo'
          WHEN a.entry_time IS NOT NULL AND a.exit_time IS NOT NULL THEN 'Completado'
          ELSE 'No registrado'
        END as status
      FROM employees e
      LEFT JOIN attendance a ON e.id = a.employee_id AND a.date = ?
      WHERE e.is_active = 1
      ORDER BY e.type, e.name
      `,
      [reportDate]
    );

    res.json({
      success: true,
      data: records,
      date: reportDate,
      count: records.length
    });

  } catch (error) {
    console.error('❌ Error generando reporte diario:', error);
    res.status(500).json({ success: false, error: 'Error al generar reporte diario' });
  }
});

/* ================================================================
   GET /api/reports/weekly - Reporte semanal (ÚNICA VERSIÓN CORRECTA)
   ================================================================ */
router.get('/weekly', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: 'Fecha inicio y fecha fin son requeridas'
      });
    }

    // --- CONSULTAS BASE ---
    const productionQuery = `
      SELECT 
        e.id as employee_id,
        e.name as employee,
        e.dni,
        COUNT(a.id) as dias_trabajados,
        SUM(COALESCE(a.despalillo, 0)) as total_despalillo,
        SUM(COALESCE(a.escogida, 0)) as total_escogida,
        SUM(COALESCE(a.monado, 0)) as total_monado,
        SUM(COALESCE(a.t_despalillo, 0)) as t_despalillo,
        SUM(COALESCE(a.t_escogida, 0)) as t_escogida,
        SUM(COALESCE(a.t_monado, 0)) as t_monado,
        SUM(COALESCE(a.prop_sabado, 0)) as prop_sabado,
        SUM(COALESCE(a.septimo_dia, 0)) as septimo_dia
      FROM employees e
      INNER JOIN attendance a ON e.id = a.employee_id 
      WHERE e.type = 'Producción' 
        AND e.is_active = 1
        AND a.date BETWEEN ? AND ?
        AND a.exit_time IS NOT NULL
      GROUP BY e.id
      HAVING COUNT(a.id) > 0
    `;

    const alDiaQuery = `
      SELECT 
        e.id as employee_id,
        e.name as employee,
        e.dni,
        e.monthly_salary,
        COUNT(a.id) as dias_trabajados,
        SUM(COALESCE(a.hours_extra, 0)) as horas_extras,
        SUM(COALESCE(a.prop_sabado, 0)) as sabado,
        SUM(COALESCE(a.septimo_dia, 0)) as septimo_dia
      FROM employees e
      INNER JOIN attendance a ON e.id = a.employee_id 
      WHERE e.type = 'Al Dia' 
        AND e.is_active = 1
        AND a.date BETWEEN ? AND ?
        AND a.exit_time IS NOT NULL
      GROUP BY e.id
      HAVING COUNT(a.id) > 0
    `;

    // --- EJECUCIÓN EN PARALELO ---
    const [productionRows, alDiaRows] = await Promise.all([
      allQuery(productionQuery, [start_date, end_date]),
      allQuery(alDiaQuery, [start_date, end_date])
    ]);

    // --- CÁLCULOS PARA PRODUCCIÓN ---
    const productionWithCalculations = productionRows.map(row => {
      const total_produccion =
        (row.t_despalillo || 0) +
        (row.t_escogida || 0) +
        (row.t_monado || 0);

      const prop_sabado = total_produccion * 0.090909;
      const neto_pagar =
        total_produccion + prop_sabado + (row.septimo_dia || 0);

      return {
        ...row,
        total_produccion: Math.round(total_produccion * 100) / 100,
        prop_sabado: Math.round(prop_sabado * 100) / 100,
        neto_pagar: Math.round(neto_pagar * 100) / 100
      };
    });

    // --- CÁLCULOS PARA AL DÍA ---
    const alDiaWithCalculations = alDiaRows.map(row => {
      const salario_diario = (row.monthly_salary || 0) / 30;
      const valorHoraNormal = salario_diario / 8;
      const valorHoraExtra = valorHoraNormal * 1.25;

      const he_dinero = (row.horas_extras || 0) * valorHoraExtra;

      const neto_pagar =
        (row.dias_trabajados * salario_diario) +
        he_dinero +
        (row.sabado || 0) +
        (row.septimo_dia || 0);

      return {
        ...row,
        salario_diario: Math.round(salario_diario * 100) / 100,
        he_dinero: Math.round(he_dinero * 100) / 100,
        sabado: Math.round((row.sabado || 0) * 100) / 100,
        septimo_dia: Math.round((row.septimo_dia || 0) * 100) / 100,
        neto_pagar: Math.round(neto_pagar * 100) / 100
      };
    });

    // --- SUMATORIAS FINALES ---
    const totalProduction = productionWithCalculations.reduce((t, r) => t + r.neto_pagar, 0);
    const totalAlDia = alDiaWithCalculations.reduce((t, r) => t + r.neto_pagar, 0);

    res.json({
      success: true,
      data: {
        production: productionWithCalculations,
        alDia: alDiaWithCalculations
      },
      summary: {
        total_employees: productionWithCalculations.length + alDiaWithCalculations.length,
        total_production_employees: productionWithCalculations.length,
        total_aldia_employees: alDiaWithCalculations.length,
        total_payroll: totalProduction + totalAlDia,
        total_production_payroll: totalProduction,
        total_aldia_payroll: totalAlDia,
        period: { start_date, end_date }
      }
    });

  } catch (error) {
    console.error('❌ Error generando reporte semanal:', error);
    res.status(500).json({ success: false, error: 'Error al generar reporte semanal' });
  }
});

module.exports = router;
