const express = require("express");
const router = express.Router();
const { getQuery } = require("../config/database");
const { authenticateToken, requireSuperAdmin } = require("../middleware/auth");

/* ============================================================
   Función para convertir valores numéricos de forma segura
============================================================ */
const N = (v) => Number(v) || 0;

/* ============================================================
   📌 REPORTE SEMANAL — SOLO SUPER ADMIN
============================================================ */
router.get("/weekly", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar 'start' y 'end' en formato YYYY-MM-DD."
      });
    }

    const rows = await getQuery(
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
        a.septimo_dia
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1 AND $2
      ORDER BY e.name ASC, a.date ASC
    `,
      [start, end]
    );

    if (!rows.length) {
      return res.json({
        success: true,
        data: {
          production: [],
          alDia: [],
          summary: {
            total_employees: 0,
            total_payroll: 0,
            total_production_employees: 0,
            total_aldia_employees: 0
          }
        }
      });
    }

    // Agrupar registros por tipo
    const production = [];
    const alDia = [];

    rows.forEach(row => {
      if (row.employee_type === "Producción") {
        const tDesp = N(row.t_despalillo);
        const tEsco = N(row.t_escogida);
        const tMona = N(row.t_monado);
        const propSabado = N(row.prop_sabado);
        const sept = N(row.septimo_dia);

        const neto = tDesp + tEsco + tMona + propSabado + sept;

        production.push({
          ...row,
          total_despalillo: tDesp,
          total_escogida: tEsco,
          total_monado: tMona,
          total_produccion: tDesp + tEsco + tMona,
          prop_sabado: propSabado,
          septimo_dia: sept,
          neto_pagar: Number(neto.toFixed(2)),
          dias_trabajados: 1
        });

      } else {
        const salarioMensual = N(row.monthly_salary);
        const salarioDiario = salarioMensual / 30;

        const valorHoraExtra = (salarioDiario / 8) * 1.25;
        const dineroHE = N(row.hours_extra) * valorHoraExtra;

        const neto = salarioDiario + dineroHE + N(row.septimo_dia);

        alDia.push({
          ...row,
          salario_diario: Number(salarioDiario.toFixed(2)),
          horas_extra_dinero: Number(dineroHE.toFixed(2)),
          dias_trabajados: 1,
          neto_pagar: Number(neto.toFixed(2))
        });
      }
    });

    // Resumen global
    const summary = {
      total_employees: production.length + alDia.length,
      total_payroll: [
        ...production,
        ...alDia
      ].reduce((sum, r) => sum + r.neto_pagar, 0),

      total_production_employees: production.length,
      total_production_payroll: production.reduce((sum, r) => sum + r.neto_pagar, 0),

      total_aldia_employees: alDia.length,
      total_aldia_payroll: alDia.reduce((sum, r) => sum + r.neto_pagar, 0)
    };

    res.json({
      success: true,
      data: {
        production,
        alDia,
        summary
      }
    });

  } catch (error) {
    console.error("❌ Error generando reporte semanal:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});


/* ============================================================
   📌 REPORTE MENSUAL — SOLO SUPER ADMIN
============================================================ */
router.get("/monthly", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar year y month en formato válido."
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

    res.json({ success: true, data: rows });

  } catch (error) {
    console.error("❌ Error generando reporte mensual:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ============================================================
   📌 REPORTE DIARIO — SOLO SUPER ADMIN
============================================================ */
router.get("/daily", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar ?date=YYYY-MM-DD"
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
        a.entry_time,
        a.exit_time,
        a.hours_extra,
        a.t_despalillo,
        a.t_escogida,
        a.t_monado,
        a.prop_sabado,
        a.septimo_dia,
        a.date
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY e.name ASC
      `,
      [date]
    );

    const processed = rows.map(row => {

      if (row.employee_type === "Al Dia") {
        const salarioMensual = N(row.monthly_salary);
        const salarioDiario = salarioMensual / 30;

        const horasExtra = N(row.hours_extra);
        const valorHora = salarioDiario / 8;
        const valorHE = valorHora * 1.25;
        const dineroHE = horasExtra * valorHE;

        const neto = salarioDiario + dineroHE + N(row.septimo_dia);

        return {
          ...row,
          tipo: "Al Día",
          salario_diario: Number(salarioDiario.toFixed(2)),
          horas_extra_dinero: Number(dineroHE.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      if (row.employee_type === "Producción") {
        const tDesp = N(row.t_despalillo);
        const tEsco = N(row.t_escogida);
        const tMona = N(row.t_monado);
        const propSabado = N(row.prop_sabado);
        const sept = N(row.septimo_dia);

        const totalProd = tDesp + tEsco + tMona;
        const neto = totalProd + propSabado + sept;

        return {
          ...row,
          tipo: "Producción",
          total_produccion: Number(totalProd.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      return row;
    });

    res.json({ success: true, data: processed });

  } catch (error) {
    console.error("❌ Error generando reporte diario:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
