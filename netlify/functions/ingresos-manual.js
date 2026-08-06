// Reservas cargadas a mano: las que NO vienen en los exports de Airbnb/Booking
// (ej. un listing que está en la cuenta de otro host pero cobra Esteban). Se
// guardan por mes y se suman al depto en el módulo Ingresos.
//   { id, periodo, codigo, inicio, fin, huesped, total, limpieza, comisionPct }
// Reparto (tercero): dueño = (total - limpieza) * (1 - comisionPct/100);
//                    vos   = total - dueño   (= limpieza + comisionPct% del resto)
//
// GET    /api/ingresos-manual   -> lista
// POST   /api/ingresos-manual   -> agrega una. body: { periodo, codigo, inicio, fin, huesped?, total, limpieza?, comisionPct? }
// DELETE /api/ingresos-manual   -> borra una. body: { id }

const properties = require("../../data/properties.json");
const { getJSON, setJSON } = require("../lib/store");
const { reservaManualTasks } = require("../lib/manual-reservas");

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function nuevaId() {
  return "man_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Refleja en el cache del calendario (sin esperar el resync) el check-out y el
// check-in de una reserva a mano. accion "add" los agrega, "remove" los saca.
async function reflejarEnCalendario(reserva, accion) {
  const overrides = await getJSON("task-overrides", {});
  const { checkout, checkin } = reservaManualTasks(reserva, properties, overrides);
  const payload = await getJSON("tasks-cache", { tasks: [], checkins: [], lastSync: null, syncErrors: [] });
  payload.tasks = payload.tasks || [];
  payload.checkins = payload.checkins || [];
  if (accion === "remove") {
    if (checkout) payload.tasks = payload.tasks.filter((t) => t.id !== checkout.id);
    if (checkin) payload.checkins = payload.checkins.filter((c) => c.id !== checkin.id);
  } else {
    if (checkout && !payload.tasks.some((t) => t.id === checkout.id)) payload.tasks.push(checkout);
    if (checkin && !payload.checkins.some((c) => c.id === checkin.id)) payload.checkins.push(checkin);
  }
  payload.tasks.sort((a, b) => a.date.localeCompare(b.date));
  payload.checkins.sort((a, b) => a.date.localeCompare(b.date));
  await setJSON("tasks-cache", payload);
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("ingresos-manual", []));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    const total = Number(body.total) || 0;
    if (!body.periodo || !body.codigo || !total) {
      return json(400, { error: "Faltan periodo, codigo o total" });
    }
    const list = await getJSON("ingresos-manual", []);
    const item = {
      id: nuevaId(),
      periodo: body.periodo,
      codigo: body.codigo,
      inicio: body.inicio || "",
      fin: body.fin || "",
      huesped: body.huesped || "",
      total,
      limpieza: Number(body.limpieza) || 0,
      comisionPct: body.comisionPct != null ? Number(body.comisionPct) : 15,
      creado: new Date().toISOString(),
    };
    list.push(item);
    await setJSON("ingresos-manual", list);
    await reflejarEnCalendario(item, "add");
    return json(200, { ok: true, item });
  }

  if (event.httpMethod === "DELETE") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.id) return json(400, { error: "Falta id" });
    const list = await getJSON("ingresos-manual", []);
    const borrada = list.find((x) => x.id === body.id);
    await setJSON("ingresos-manual", list.filter((x) => x.id !== body.id));
    if (borrada) await reflejarEnCalendario(borrada, "remove");
    return json(200, { ok: true });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
