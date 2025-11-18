const express = require("express");
const router = express.Router();
const { getQuery, runQuery } = require("../config/database");
const { authenticateToken, requireSuperAdmin } = require("../middleware/auth");

/* ============================================================
   🛠 FUNCIÓN SEGURA PARA CONVERTIR NÚMEROS
============================================================ */
const N = (v) => Number(v) || 0;

/* ============================================================
   📌 ENDPOINT: REPORTE SEMANAL (SOLO SUPER ADMIN)
============================================================ */
router.get("/weekly", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar 'start' y 'end' para generar el reporte."
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
        a.t_despalillo,
        a.t_escogida,
        a.t_monado,
        a.prop_sabado,
        a.septimo_dia,
        a.dias_trabajados,
        a.sabado
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1 AND $2
      ORDER BY e.name ASC, a.date ASC
      `,
      [start, end]
    );

    if (!rows.length) {
      return res.json({ success: true, data: [] });
    }

    const processed = rows.map((row) => {

      /* ======================================================
         🔵 EMPLEADOS AL DÍA
      ====================================================== */
      if (row.employee_type === "Al Dia") {
        const salarioMensual = N(row.monthly_salary);
        const salarioDiario = salarioMensual / 30;

        const dias = N(row.dias_trabajados);
        const he = N(row.hours_extra);

        const sab = N(row.sabado);
        const sept = N(row.septimo_dia);

        const valorHora = salarioDiario / 8;
        const valorExtra = valorHora * 1.25;

        const dineroHE = he * valorExtra;

        const neto =
          dias * salarioDiario +
          dineroHE +
          sab +
          sept;

        return {
          ...row,
          salario_diario: Number(salarioDiario.toFixed(2)),
          he_dinero: Number(dineroHE.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      /* ======================================================
         🟢 EMPLEADOS PRODUCCIÓN
      ====================================================== */
      if (row.employee_type === "Producción") {
        const tDesp = N(row.t_despalillo);
        const tEsco = N(row.t_escogida);
        const tMona = N(row.t_monado);
        const sept = N(row.septimo_dia);

        const totalProd = tDesp + tEsco + tMona;
        const propSabado = totalProd * 0.090909;

        const neto = totalProd + propSabado + sept;

        return {
          ...row,
          total_produccion: Number(totalProd.toFixed(2)),
          prop_sabado: Number(propSabado.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      return row;
    });

    res.json({
      success: true,
      data: processed,
    });

  } catch (error) {
    console.error("❌ Error generando reporte semanal:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ============================================================
   📌 ENDPOINT: REPORTE MENSUAL (SOLO SUPER ADMIN)
============================================================ */
router.get("/monthly", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar 'year' y 'month'."
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

    res.json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error("❌ Error generando reporte mensual:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ============================================================
   📌 ENDPOINT: REPORTE DIARIO (SOLO SUPER ADMIN)
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
        a.dias_trabajados,
        a.sabado,
        a.date
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY e.name ASC
      `,
      [date]
    );

    if (!rows.length) {
      return res.json({ success: true, data: [] });
    }

    const processed = rows.map((row) => {

      /* ----------
         AL DÍA
      ----------- */
      if (row.employee_type === "Al Dia") {
        const salarioMensual = N(row.monthly_salary);
        const salarioDiario = salarioMensual / 30;

        const dias = N(row.dias_trabajados);
        const he = N(row.hours_extra);

        const sab = N(row.sabado);
        const sept = N(row.septimo_dia);

        const valorHora = salarioDiario / 8;
        const valorExtra = valorHora * 1.25;
        const dineroHE = he * valorExtra;

        const neto =
          dias * salarioDiario +
          dineroHE +
          sab +
          sept;

        return {
          ...row,
          tipo: "Al Día",
          salario_diario: Number(salarioDiario.toFixed(2)),
          horas_extra_dinero: Number(dineroHE.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      /* ----------
         PRODUCCIÓN
      ----------- */
      if (row.employee_type === "Producción") {
        const tDesp = N(row.t_despalillo);
        const tEsco = N(row.t_escogida);
        const tMona = N(row.t_monado);
        const sept = N(row.septimo_dia);

        const totalProd = tDesp + tEsco + tMona;
        const propSabado = totalProd * 0.090909;

        const neto = totalProd + propSabado + sept;

        return {
          ...row,
          tipo: "Producción",
          total_produccion: Number(totalProd.toFixed(2)),
          prop_sabado: Number(propSabado.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      return row;
    });

    res.json({
      success: true,
      data: processed
    });

  } catch (error) {
    console.error("❌ Error generando reporte diario:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
