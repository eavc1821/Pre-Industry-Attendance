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
router.get("/weekly", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        error: "start and end dates are required in YYYY-MM-DD format."
      });
    }

    /* ============================================================
       Load all rows with exit_time (required for accurate attendance)
    ============================================================= */
    const rows = await allQuery(
      `
      SELECT 
        a.id,
        a.employee_id,
        e.name AS employee,
        e.type AS employee_type,
        e.monthly_salary,
        a.date,
        a.hours_extra,
        a.t_despalillo,
        a.t_escogida,
        a.t_monado,
        a.prop_sabado,
        a.septimo_dia,
        a.exit_time
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date >= $1 AND a.date <= $2
      ORDER BY e.name ASC, a.date ASC
      `,
      [start, end]
    );

    if (!rows.length) {
      return res.json({
        success: true,
        data: { production: [], alDia: [], summary: {
          total_employees: 0,
          total_payroll: 0,
          total_production_employees: 0,
          total_aldia_employees: 0
        }}
      });
    }

    const productionMap = {};
    const alDiaMap = {};

    /* ============================================================
       Group rows by employee
    ============================================================= */
    rows.forEach(row => {
      const id = row.employee_id;
      const type = (row.employee_type || "").trim().toLowerCase();
      const worked = row.exit_time !== null && row.exit_time !== undefined;

      /* ===== Production Employees ===== */
      if (type === "producción" || type === "produccion") {
        if (!productionMap[id]) {
          productionMap[id] = {
            employee_id: id,
            employee: row.employee,
            monthly_salary: toNum(row.monthly_salary),
            days_worked: worked ? 1 : 0,
            total_despalillo: toNum(row.t_despalillo),
            total_escogida: toNum(row.t_escogida),
            total_monado: toNum(row.t_monado),
            saturday_bonus: toNum(row.prop_sabado),
            seventh_day: toNum(row.septimo_dia)
          };
        } else {
          productionMap[id].days_worked += worked ? 1 : 0;
          productionMap[id].total_despalillo += toNum(row.t_despalillo);
          productionMap[id].total_escogida += toNum(row.t_escogida);
          productionMap[id].total_monado += toNum(row.t_monado);
          productionMap[id].saturday_bonus += toNum(row.prop_sabado);
          productionMap[id].seventh_day += toNum(row.septimo_dia);
        }
      }

      /* ===== Al Día Employees ===== */
      else {
        if (!alDiaMap[id]) {
          alDiaMap[id] = {
            employee_id: id,
            employee: row.employee,
            monthly_salary: toNum(row.monthly_salary),
            days_worked: worked ? 1 : 0,
            hours_extra: toNum(row.hours_extra)
          };
        } else {
          alDiaMap[id].days_worked += worked ? 1 : 0;
          alDiaMap[id].hours_extra += toNum(row.hours_extra);
        }
      }
    });

    /* ============================================================
       Process "Al Día" Payroll
    ============================================================= */
    const groupedAlDia = Object.values(alDiaMap).map(emp => {
      const monthly = emp.monthly_salary;
      const dailySalary = monthly / 30;
      const days = emp.days_worked;
      const extraHours = emp.hours_extra;

      const extraHourRate = (dailySalary / 8) * 1.25;
      const hours_extra_money = extraHours * extraHourRate;

      const seventh_day = days >= 5 ? dailySalary : 0;

      const baseSalary = days * dailySalary;
      const net_pay = baseSalary + hours_extra_money + seventh_day;

      return {
        ...emp,
        daily_salary: round2(dailySalary),
        hours_extra: extraHours,
        hours_extra_money: round2(hours_extra_money),
        seventh_day: round2(seventh_day),
        net_pay: round2(net_pay)
      };
    });

    /* ============================================================
       Process Production Payroll
    ============================================================= */
    const groupedProduction = Object.values(productionMap).map(emp => {
      const production_total =
        emp.total_despalillo +
        emp.total_escogida +
        emp.total_monado;

      const net_pay = production_total + emp.saturday_bonus + emp.seventh_day;

      return {
        ...emp,
        production_total: round2(production_total),
        net_pay: round2(net_pay)
      };
    });

    /* ============================================================
       Summary
    ============================================================= */
    const summary = {
      total_employees: groupedProduction.length + groupedAlDia.length,
      total_production_employees: groupedProduction.length,
      total_aldia_employees: groupedAlDia.length,
      total_production_payroll: round2(groupedProduction.reduce((s, e) => s + e.net_pay, 0)),
      total_aldia_payroll: round2(groupedAlDia.reduce((s, e) => s + e.net_pay, 0))
    };

    summary.total_payroll =
      round2(summary.total_production_payroll + summary.total_aldia_payroll);

    /* ============================================================
       Return data
    ============================================================= */
    return res.json({
      success: true,
      data: {
        production: groupedProduction,
        alDia: groupedAlDia,
        summary
      }
    });

  } catch (error) {
    console.error("❌ Error generating weekly report:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* ============================================================
   📌 MONTHLY REPORT — SUPER ADMIN ONLY
============================================================ */
router.get("/monthly", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        error: "year and month required."
      });
    }

    const start = `${year}-${month}-01`;
    const end = `${year}-${month}-31`;

    const rows = await getQuery(
      `
      SELECT 
        a.*,
        e.name AS employee_name,
        e.type AS employee_type,
        e.monthly_salary
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1 AND $2
      ORDER BY e.name ASC, a.date ASC
      `,
      [start, end]
    );

    return res.json({ success: true, data: rows });

  } catch (error) {
    console.error("❌ Error generating monthly:", error);
    return res.status(500).json({ success: false, error: error.message });
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
