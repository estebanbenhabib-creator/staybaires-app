// Liquidación de un mes reconstruida desde datos PERSISTENTES, no del calendario
// vivo. El calendario (iCal) pierde las reservas pasadas, así que para un mes
// cerrado /api/payments cuenta muy pocos días. Acá reconstruimos las limpiezas
// "hechas" desde task-overrides (donde queda registrado quién limpió cada
// checkout y que se marcó hecho), las tareas manuales y las reservas cargadas a
// mano, y calculamos la liquidación con el mismo motor. Lo usa el módulo Ingresos
// para que viáticos y limpiezas del mes salgan completos.
//
// GET /api/liquidacion-mes?periodo=YYYY-MM  -> { summary, config, periodo }

const properties = require("../../data/properties.json");
const employees = require("../../data/employees.json");
const { getJSON } = require("../lib/store");
const { computeLiquidacion, DEFAULT_CONFIG } = require("../lib/payment-engine");

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method not allowed" };
  const periodo = (event.queryStringParameters || {}).periodo;
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return json(400, { error: "Falta periodo YYYY-MM" });

  const from = `${periodo}-01`;
  const to = `${periodo}-31`;

  const overrides = await getJSON("task-overrides", {});
  const manualTasks = await getJSON("manual-tasks", []);
  const config = { ...DEFAULT_CONFIG, ...(await getJSON("pay-config", {})) };
  const items = await getJSON("pay-items", []);

  const propByCod = {};
  for (const p of properties) propByCod[p.codigo] = p;

  // Reconstruir las tareas HECHAS a partir de la historia persistente.
  const tasks = [];

  // 1) Check-outs (limpiezas) desde task-overrides. Cada override marcado "hecha"
  //    es una limpieza que ocurrió, aunque la reserva ya no esté en el calendario.
  //    id de checkout = `${codigo}_${YYYY-MM-DD}` (el código no tiene "_"; la
  //    fecha usa guiones). Se saltean check-ins (`_checkin_`) y tareas manuales
  //    (prefijo `manual_`, que se toman del blob manual-tasks).
  for (const [id, ov] of Object.entries(overrides)) {
    if (!ov || ov.status !== "hecha") continue;
    if (id.includes("_checkin_")) continue;
    if (id.startsWith("manual_")) continue;
    const us = id.indexOf("_");
    if (us <= 0) continue;
    const codigo = id.slice(0, us);
    const fechaOrig = id.slice(us + 1);
    const date = ov.fecha || fechaOrig;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const prop = propByCod[codigo];
    tasks.push({
      id,
      type: "checkout",
      status: "hecha",
      assignedTo: ov.assignedTo || null,
      assignedName: ov.assignedName || null,
      date,
      propertyCode: codigo,
      propertyName: prop ? prop.nombre : "",
      direccion: prop ? prop.direccion || "" : "",
    });
  }

  // 2) Tareas manuales (inspecciones, limpiezas extra) con sus overrides aplicados.
  for (const mt of manualTasks) {
    const ov = overrides[mt.id] || {};
    const status = ov.status || mt.status;
    if (status !== "hecha") continue;
    tasks.push({
      ...mt,
      status: "hecha",
      assignedTo: ov.assignedTo || mt.assignedTo || null,
      date: ov.fecha || mt.date,
    });
  }

  const summary = computeLiquidacion(tasks, employees, config, items, from, to);
  return json(200, { summary, config, periodo });
};
