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
        e.id AS employee_id,
        e.name AS employee_name,
        e.dni,
        e.type AS employee_type,
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
        END AS status
      FROM employees e
      LEFT JOIN attendance a 
        ON e.id = a.employee_id 
       AND a.date = $1
      WHERE e.is_active = TRUE
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
   GET /api/reports/weekly - Reporte semanal completo
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

    // --- CONSULTA PRODUCCIÓN ---
    const productionQuery = `
      SELECT 
        e.id AS employee_id,
        e.name AS employee,
        e.dni,
        COUNT(a.id) AS dias_trabajados,
        SUM(COALESCE(a.despalillo, 0)) AS total_despalillo,
        SUM(COALESCE(a.escogida, 0)) AS total_escogida,
        SUM(COALESCE(a.monado, 0)) AS total_monado,
        SUM(COALESCE(a.t_despalillo, 0)) AS t_despalillo,
        SUM(COALESCE(a.t_escogida, 0)) AS t_escogida,
        SUM(COALESCE(a.t_monado, 0)) AS t_monado,
        SUM(COALESCE(a.prop_sabado, 0)) AS prop_sabado,
        SUM(COALESCE(a.septimo_dia, 0)) AS septimo_dia
      FROM employees e
      INNER JOIN attendance a ON e.id = a.employee_id 
      WHERE e.type = 'Producción'
        AND e.is_active = TRUE
        AND a.date BETWEEN $1 AND $2
        AND a.exit_time IS NOT NULL
      GROUP BY e.id
      HAVING COUNT(a.id) > 0
    `;

    // --- CONSULTA AL DÍA ---
    const alDiaQuery = `
      SELECT 
        e.id AS employee_id,
        e.name AS employee,
        e.dni,
        e.monthly_salary,
        COUNT(a.id) AS dias_trabajados,
        SUM(COALESCE(a.hours_extra, 0)) AS horas_extras,
        SUM(COALESCE(a.prop_sabado, 0)) AS sabado,
        SUM(COALESCE(a.septimo_dia, 0)) AS septimo_dia
      FROM employees e
      INNER JOIN attendance a ON e.id = a.employee_id 
      WHERE e.type = 'Al Dia'
        AND e.is_active = TRUE
        AND a.date BETWEEN $1 AND $2
        AND a.exit_time IS NOT NULL
      GROUP BY e.id
      HAVING COUNT(a.id) > 0
    `;

    // Ejecutar ambas consultas
    const [productionRows, alDiaRows] = await Promise.all([
      allQuery(productionQuery, [start_date, end_date]),
      allQuery(alDiaQuery, [start_date, end_date])
    ]);

    /* ================================================================
       CÁLCULOS PRODUCCIÓN
    ================================================================ */
    const productionWithTotals = productionRows.map(row => {
      const totalProd =
        (row.t_despalillo || 0) +
        (row.t_escogida || 0) +
        (row.t_monado || 0);

      const propSabado = totalProd * 0.090909;
      const neto = totalProd + propSabado + (row.septimo_dia || 0);

      return {
        ...row,
        total_produccion: Number(totalProd.toFixed(2)),
        prop_sabado: Number(propSabado.toFixed(2)),
        neto_pagar: Number(neto.toFixed(2))
      };
    });

    /* ================================================================
       CÁLCULOS AL DÍA
    ================================================================ */
    const alDiaWithTotals = alDiaRows.map(row => {
      const salario_diario = (row.monthly_salary || 0) / 30;
      const valorHora = salario_diario / 8;
      const valorHE = valorHora * 1.25;

      const heDinero = valorHE * (row.horas_extras || 0);

      const neto =
        (row.dias_trabajados * salario_diario) +
        heDinero +
        (row.sabado || 0) +
        (row.septimo_dia || 0);

      return {
        ...row,
        salario_diario: Number(salario_diario.toFixed(2)),
        he_dinero: Number(heDinero.toFixed(2)),
        sabado: Number(row.sabado || 0),
        septimo_dia: Number(row.septimo_dia || 0),
        neto_pagar: Number(neto.toFixed(2))
      };
    });

    /* ================================================================
       SUMATORIAS
    ================================================================ */
    const totalProduction = productionWithTotals.reduce((acc, r) => acc + r.neto_pagar, 0);
    const totalAlDia = alDiaWithTotals.reduce((acc, r) => acc + r.neto_pagar, 0);

    res.json({
      success: true,
      data: {
        production: productionWithTotals,
        alDia: alDiaWithTotals
      },
      summary: {
        total_employees: productionWithTotals.length + alDiaWithTotals.length,
        total_production_employees: productionWithTotals.length,
        total_aldia_employees: alDiaWithTotals.length,
        total_payroll: Number((totalProduction + totalAlDia).toFixed(2)),
        total_production_payroll: Number(totalProduction.toFixed(2)),
        total_aldia_payroll: Number(totalAlDia.toFixed(2)),
        period: { start_date, end_date }
      }
    });

  } catch (error) {
    console.error('❌ Error generando reporte semanal:', error);
    res.status(500).json({ success: false, error: 'Error al generar reporte semanal' });
  }
});

module.exports = router;
