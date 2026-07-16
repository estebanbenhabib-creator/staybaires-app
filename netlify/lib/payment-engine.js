// Calculo de pagos: fijo por dia trabajado, no por tarea/depto.
// Una empleada "trabaja" un dia si tiene al menos una tarea asignada
// (de cualquier estado) o un jornal cargado a mano para ese dia.

/**
 * @param {Array} tasks - tareas del task-engine (con date, assignedTo)
 * @param {Array} manualJornales - jornales cargados a mano: { employeeId, date, motivo }
 *   (por si un dia hay que pagarle a alguien sin que haya checkout, ej. tarea extra)
 * @param {Array} employees - data/employees.json
 * @returns {Array} un resumen por empleada: { employeeId, nombre, dias: [...fechas], totalDias, tarifaPorDia, totalPago }
 */
function computeDailyPayments(tasks, manualJornales, employees) {
  const daysByEmployee = new Map(); // employeeId -> Set(dates)

  for (const t of tasks) {
    if (!t.assignedTo) continue;
    if (!daysByEmployee.has(t.assignedTo)) daysByEmployee.set(t.assignedTo, new Set());
    daysByEmployee.get(t.assignedTo).add(t.date);
  }

  for (const j of manualJornales || []) {
    if (!daysByEmployee.has(j.employeeId)) daysByEmployee.set(j.employeeId, new Set());
    daysByEmployee.get(j.employeeId).add(j.date);
  }

  const results = [];
  for (const emp of employees) {
    if (emp.rol !== "empleada") continue;
    const dias = Array.from(daysByEmployee.get(emp.id) || []).sort();
    const tarifa = emp.tarifaPorDia || 0;
    results.push({
      employeeId: emp.id,
      nombre: emp.nombre,
      dias,
      totalDias: dias.length,
      tarifaPorDia: tarifa,
      totalPago: dias.length * tarifa,
    });
  }
  return results;
}

/**
 * Filtra el resumen de pagos a un rango de fechas (inclusive), formato 'YYYY-MM-DD'.
 */
function filterByDateRange(paymentSummary, from, to) {
  return paymentSummary.map((p) => {
    const dias = p.dias.filter((d) => (!from || d >= from) && (!to || d <= to));
    return {
      ...p,
      dias,
      totalDias: dias.length,
      totalPago: dias.length * p.tarifaPorDia,
    };
  });
}

module.exports = { computeDailyPayments, filterByDateRange };
