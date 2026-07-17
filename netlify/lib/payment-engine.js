// Liquidacion de pago a las colaboradoras. Se calcula sobre las tareas
// MARCADAS COMO HECHAS en un rango de fechas, y para cada colaboradora suma:
//   base por dia:  dias trabajados x tarifaPorDia
//   + valor por depto: por cada limpieza hecha, el valor del depto (Ajustes)
//   + viatico: dias trabajados x monto de viatico (Ajustes)
//   + plus domingo: dias trabajados que caen domingo x plusDomingo (Ajustes)
//   + plus feriado: dias trabajados marcados feriado x plusFeriado (Ajustes)
//   + items manuales: viaticos extra, reembolsos de super/articulos, plus
//     suciedad, etc., que carga el admin (concepto + monto).
//
// Los montos (tarifa por depto, viatico, plus, feriados) viven en el blob de
// configuracion "pay-config"; los items en "pay-items". Un "dia trabajado" es
// una fecha unica con al menos una tarea hecha.

const DEFAULT_CONFIG = { viatico: 0, plusDomingo: 0, plusFeriado: 0, feriados: [], valorDepto: {}, telefonos: {} };

function esDomingo(iso) {
  return new Date(iso + "T00:00:00").getDay() === 0;
}

function computeLiquidacion(tasks, employees, config, items, from, to) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const feriados = new Set(cfg.feriados || []);
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const results = [];

  for (const emp of employees) {
    if (emp.rol !== "empleada") continue;

    // Tareas de limpieza (checkout o manual) hechas por esta colaboradora en el rango.
    const suyas = tasks.filter((t) => t.assignedTo === emp.id && t.status === "hecha" && t.type !== "checkin" && inRange(t.date));
    const dias = Array.from(new Set(suyas.map((t) => t.date))).sort();
    const tarifa = emp.tarifaPorDia || 0;
    const baseDias = dias.length * tarifa;

    const deptosDetalle = suyas.map((t) => ({
      nombre: t.propertyName,
      direccion: t.direccion,
      date: t.date,
      monto: (cfg.valorDepto && cfg.valorDepto[t.propertyCode]) || 0,
    }));
    const valorDeptos = deptosDetalle.reduce((s, d) => s + d.monto, 0);

    const viatico = dias.length * (cfg.viatico || 0);
    const domingos = dias.filter(esDomingo);
    const plusDomingo = domingos.length * (cfg.plusDomingo || 0);
    const feriadosTrab = dias.filter((d) => feriados.has(d));
    const plusFeriado = feriadosTrab.length * (cfg.plusFeriado || 0);

    const misItems = (items || []).filter((it) => it.employeeId === emp.id && inRange(it.date));
    const itemsTotal = misItems.reduce((s, it) => s + (Number(it.monto) || 0), 0);

    const total = baseDias + valorDeptos + viatico + plusDomingo + plusFeriado + itemsTotal;

    results.push({
      employeeId: emp.id,
      nombre: emp.nombre,
      tarifaPorDia: tarifa,
      dias,
      totalDias: dias.length,
      baseDias,
      cantDeptos: suyas.length,
      deptosDetalle,
      valorDeptos,
      viaticoDia: cfg.viatico || 0,
      viatico,
      domingos: domingos.length,
      plusDomingo,
      feriados: feriadosTrab.length,
      plusFeriado,
      items: misItems,
      itemsTotal,
      total,
    });
  }
  return results;
}

module.exports = { computeLiquidacion, DEFAULT_CONFIG };
