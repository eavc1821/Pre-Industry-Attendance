const express = require("express");
const router = express.Router();
const { getQuery, allQuery } = require("../config/database");
const { authenticateToken, requireSuperAdmin } = require("../middleware/auth");

/* ============================================================
   Helpers
============================================================ */
const N = (v) => Number(v) || 0;
const toNum = (v) => parseFloat(v) || 0;
const round2 = (v) => Number(Number(v || 0).toFixed(2));

/* ============================================================
   📌 WEEKLY REPORT — SUPER ADMIN ONLY
============================================================ */
router.get('/weekly', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: "start_date y end_date son requeridos"
      });
    }

    // 1. Obtener datos de empleados + asistencia semanal
    const rows = await allQuery(
      `
      SELECT 
        a.employee_id,
        e.name AS employee,
        e.dni,
        e.type AS employee_type,
        e.monthly_salary,
        a.date,

        -- Producción
        COALESCE(a.despalillo, 0) AS despalillo,
        COALESCE(a.escogida, 0) AS escogida,
        COALESCE(a.monado, 0) AS monado,

        -- Al Día
        COALESCE(a.hours_extra, 0) AS hours_extra

      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.date BETWEEN $1 AND $2
        AND a.exit_time IS NOT NULL
      ORDER BY e.name ASC
      `,
      [start_date, end_date]
    );

    // Acumuladores por empleado
    const employees = {};

    for (const row of rows) {
      const id = row.employee_id;

      if (!employees[id]) {
        employees[id] = {
          employee_id: id,
          employee: row.employee,
          dni: row.dni,
          employee_type: row.employee_type,
          monthly_salary: row.monthly_salary,

          // Producción
          total_despalillo: 0,
          total_escogida: 0,
          total_monado: 0,

          // Al Día
          days_worked: 0,
          hours_extra: 0
        };
      }

      if (row.employee_type === "Producción") {
        employees[id].total_despalillo += Number(row.despalillo);
        employees[id].total_escogida   += Number(row.escogida);
        employees[id].total_monado     += Number(row.monado);
        employees[id].days_worked++;
      } else {
        employees[id].hours_extra += Number(row.hours_extra);
        employees[id].days_worked++;
      }
    }

    const productionEmployees = [];
    const alDiaEmployees = [];

    // Procesar cálculos finales
    for (const emp of Object.values(employees)) {
      if (emp.employee_type === "Producción") {

        const TDes = emp.total_despalillo * 80;
        const TEsc = emp.total_escogida * 70;
        const TMon = emp.total_monado   * 1;

        const totalProd = TDes + TEsc + TMon;

        const saturdayBonus = Number((totalProd * 0.090909).toFixed(2));
        const seventhDay    = Number((totalProd * 0.181818).toFixed(2));

        const netPay = Number((totalProd + saturdayBonus + seventhDay).toFixed(2));

        productionEmployees.push({
          employee_id: emp.employee_id,
          employee: emp.employee,
          dni: emp.dni,
          type: "Producción",

          total_despalillo: emp.total_despalillo,
          total_escogida: emp.total_escogida,
          total_monado: emp.total_monado,

          production_money: totalProd,
          saturday_bonus: saturdayBonus,
          seventh_day: seventhDay,

          net_pay: netPay
        });

      } else {

          const dailySalary = emp.monthly_salary / 30;
          const hourValue = dailySalary / 8;
          const overtimeValue = hourValue + hourValue * 0.25;

          const hoursMoney = Number((emp.hours_extra * overtimeValue).toFixed(2));

          // 7mo día solo si tiene 5 o más días trabajados
          const seventh = emp.days_worked >= 5 ? dailySalary : 0;

          // NETO OFICIAL PARA EMPLEADOS AL DÍA
          const netPay = Number(
            (emp.days_worked * dailySalary + hoursMoney + seventh).toFixed(2)
          );

          alDiaEmployees.push({
            employee_id: emp.employee_id,
            employee: emp.employee,
            dni: emp.dni,
            type: "Al Día",

            daily_salary: Number(dailySalary.toFixed(2)),
            days_worked: emp.days_worked,
            hours_extra: emp.hours_extra,
            hours_extra_money: hoursMoney,
            seventh_day: Number(seventh.toFixed(2)),

            net_pay: netPay
          });
        }
    }

    // RESUMEN
    const summary = {
      total_employees: productionEmployees.length + alDiaEmployees.length,
      total_production_employees: productionEmployees.length,
      total_aldia_employees: alDiaEmployees.length,
      total_production_payroll: productionEmployees.reduce((sum, e) => sum + e.net_pay, 0),
      total_aldia_payroll: alDiaEmployees.reduce((sum, e) => sum + e.net_pay, 0)
    };

    summary.total_payroll =
      summary.total_production_payroll + summary.total_aldia_payroll;

    return res.json({
      success: true,
      data: {
        production: productionEmployees,
        alDia: alDiaEmployees,
        summary
      }
    });

  } catch (error) {
    console.error("❌ Error en weekly:", error);
    res.status(500).json({ success: false, error: "Error generando reporte semanal" });
  }
});


/* ============================================================
   📌 DAILY REPORT — SUPER ADMIN ONLY
============================================================ */
router.get("/daily", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "date is required: YYYY-MM-DD"
      });
    }

    const rows = await getQuery(
      `
      SELECT
        a.id,
        a.employee_id,
        e.name AS employee_name,
        e.type AS employee_type,
        e.monthly_salary,
        a.date,
        a.hours_extra,
        a.exit_time
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY e.name ASC
      `,
      [date]
    );

    return res.json({ success: true, data: rows });

  } catch (error) {
    console.error("❌ Error generating daily report:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
