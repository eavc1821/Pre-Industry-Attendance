const express = require("express");
const router = express.Router();
const { getQuery, allQuery } = require("../config/database");
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

    const toNum = (v) => parseFloat(v) || 0;

    // Obtener registros
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
        a.septimo_dia
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1 AND $2
      ORDER BY e.name ASC, a.date ASC
      `,
      [start, end]
    );

    if (!rows || rows.length === 0) {
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

    const production = [];
    const alDia = [];

    // Clasificar registros según tipo
    rows.forEach(row => {
      const empType = (row.employee_type || "").trim().toLowerCase();

      /* =======================
         PRODUCCIÓN
      ========================== */
      if (empType === "producción" || empType === "produccion") {

        const tDesp = toNum(row.t_despalillo);
        const tEsco = toNum(row.t_escogida);
        const tMona = toNum(row.t_monado);
        const propSab = toNum(row.prop_sabado);
        const sept = toNum(row.septimo_dia);

        const neto = tDesp + tEsco + tMona + propSab + sept;

        production.push({
          ...row,
          total_despalillo: tDesp,
          total_escogida: tEsco,
          total_monado: tMona,
          total_produccion: tDesp + tEsco + tMona,
          prop_sabado: propSab,
          septimo_dia: sept,
          neto_pagar: neto,
          dias_trabajados: 1
        });

      } else {

        /* =======================
           AL DÍA
        ========================== */
        const salarioMensual = toNum(row.monthly_salary);
        const salarioDiario = salarioMensual / 30;

        const valorHoraExtra = (salarioDiario / 8) * 1.25;
        const dineroHE = toNum(row.hours_extra) * valorHoraExtra;

        const sept = toNum(row.septimo_dia);
        const neto = salarioDiario + dineroHE + sept;

        alDia.push({
          ...row,
          salario_diario: salarioDiario,
          horas_extra_dinero: dineroHE,
          dias_trabajados: 1,
          septimo_dia: sept,
          neto_pagar: neto
        });
      }
    });

    /* ============================================================
       AGRUPAR PRODUCCIÓN POR EMPLEADO
    ============================================================ */
    const prodMap = {};

    production.forEach(p => {
      if (!prodMap[p.employee_id]) {
        prodMap[p.employee_id] = { ...p };
      } else {
        prodMap[p.employee_id].total_despalillo += p.total_despalillo;
        prodMap[p.employee_id].total_escogida += p.total_escogida;
        prodMap[p.employee_id].total_monado += p.total_monado;
        prodMap[p.employee_id].total_produccion += p.total_produccion;
        prodMap[p.employee_id].prop_sabado += p.prop_sabado;
        prodMap[p.employee_id].septimo_dia += p.septimo_dia;
        prodMap[p.employee_id].neto_pagar += p.neto_pagar;
        prodMap[p.employee_id].dias_trabajados += 1;
      }
    });

    const groupedProduction = Object.values(prodMap).map(emp => ({
      ...emp,
      total_despalillo: Number(emp.total_despalillo.toFixed(2)),
      total_escogida: Number(emp.total_escogida.toFixed(2)),
      total_monado: Number(emp.total_monado.toFixed(2)),
      total_produccion: Number(emp.total_produccion.toFixed(2)),
      prop_sabado: Number(emp.prop_sabado.toFixed(2)),
      septimo_dia: Number(emp.septimo_dia.toFixed(2)),
      neto_pagar: Number(emp.neto_pagar.toFixed(2))
    }));


    /* ============================================================
       AGRUPAR AL DÍA POR EMPLEADO
    ============================================================ */
    const alDiaMap = {};

    alDia.forEach(a => {
      if (!alDiaMap[a.employee_id]) {
        alDiaMap[a.employee_id] = { ...a };
      } else {
        alDiaMap[a.employee_id].horas_extra_dinero += a.horas_extra_dinero;
        alDiaMap[a.employee_id].septimo_dia += a.septimo_dia;
        alDiaMap[a.employee_id].neto_pagar += a.neto_pagar;
        alDiaMap[a.employee_id].dias_trabajados += 1;
      }
    });

    const groupedAlDia = Object.values(alDiaMap).map(emp => ({
      ...emp,
      salario_diario: Number(emp.salario_diario.toFixed(2)),
      horas_extra_dinero: Number(emp.horas_extra_dinero.toFixed(2)),
      septimo_dia: Number(emp.septimo_dia.toFixed(2)),
      neto_pagar: Number(emp.neto_pagar.toFixed(2))
    }));

    
    /* ===========================
       RESUMEN FINAL
    ============================ */
    const summary = {
      total_employees: groupedProduction.length + groupedAlDia.length,
      total_payroll: [...groupedProduction, ...groupedAlDia]
        .reduce((sum, e) => sum + e.neto_pagar, 0),

      total_production_employees: groupedProduction.length,
      total_production_payroll: groupedProduction
        .reduce((s, e) => s + e.neto_pagar, 0),

      total_aldia_employees: groupedAlDia.length,
      total_aldia_payroll: groupedAlDia
        .reduce((s, e) => s + e.neto_pagar, 0)
    };


    /* ===========================
       RESPUESTA FINAL
    ============================ */
    res.json({
      success: true,
      data: {
        production: groupedProduction,
        alDia: groupedAlDia,
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
