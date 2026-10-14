// Tareas cargadas a mano (no vienen de ningun calendario): inspecciones,
// limpiezas extra, etc. Se guardan en el blob "manual-tasks" (persistente,
// porque no se pueden recalcular) y se fusionan con las tareas de iCal al
// armar el calendario. Reusan el mismo sistema de reasignar / marcar hecho
// (overrides por id) y cuentan para el pago como un dia trabajado mas.
//
// GET    /api/manual-tasks   -> lista cruda de tareas manuales
// POST   /api/manual-tasks   -> crea una  body: { date, tipo, propertyCode, assignedTo, valor?, notes? }
// PUT    /api/manual-tasks   -> edita una  body: { id, valor?, notes? }
// DELETE /api/manual-tasks   -> borra una  body: { id }

const properties = require("../../data/properties.json");
const { getJSON, setJSON } = require("../lib/store");

function nuevaId() {
  return "manual_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("manual-tasks", []));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.date || !body.tipo) {
      return json(400, { error: "Faltan date o tipo" });
    }
    const prop = body.propertyCode ? properties.find((p) => p.codigo === body.propertyCode) : null;
    const task = {
      id: nuevaId(),
      source: "manual",
      type: "manual",
      tipo: body.tipo,
      date: body.date,
      propertyCode: body.propertyCode || null,
      propertyName: prop ? prop.nombre : body.propertyName || "",
      direccion: prop ? prop.direccion || "" : body.direccion || "",
      barrio: prop ? prop.barrio || "" : "",
      assignedTo: body.assignedTo || null,
      valor: Number(body.valor) || 0,
      notes: body.notes || null,
      status: "pendiente",
      // Campos de Mantenimiento (solo para tareas tipo "Mantenimiento"):
      monto: Number(body.monto) || 0, // ARS que se le paga a la persona
      paga: body.paga || null, // "esteban" (reclamo al dueño) | "propietario"
      cobrado: !!body.cobrado, // si paga=esteban: ya me lo cobró el dueño
    };
    const list = await getJSON("manual-tasks", []);
    list.push(task);
    await setJSON("manual-tasks", list);

    // Reflejarla de una en el cache para que aparezca sin esperar el resync.
    const payload = await getJSON("tasks-cache", { tasks: [], checkins: [], lastSync: null, syncErrors: [] });
    payload.tasks = [...(payload.tasks || []), task].sort((a, b) => a.date.localeCompare(b.date));
    await setJSON("tasks-cache", payload);

    return json(200, { ok: true, task });
  }

  if (event.httpMethod === "PUT") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.id) return json(400, { error: "Falta id" });

    const list = await getJSON("manual-tasks", []);
    const idx = list.findIndex((t) => t.id === body.id);
    if (idx === -1) return json(404, { error: "No existe esa tarea" });
    const cambios = {};
    if (body.valor != null) cambios.valor = Number(body.valor) || 0;
    if (body.notes !== undefined) cambios.notes = body.notes;
    if (body.monto != null) cambios.monto = Number(body.monto) || 0;
    if (body.paga !== undefined) cambios.paga = body.paga;
    if (body.cobrado !== undefined) cambios.cobrado = !!body.cobrado;
    Object.assign(list[idx], cambios);
    await setJSON("manual-tasks", list);

    // reflejar el cambio en el cache para que las vistas lo tomen ya.
    const payload = await getJSON("tasks-cache", { tasks: [], checkins: [] });
    payload.tasks = (payload.tasks || []).map((t) => (t.id === body.id ? { ...t, ...cambios } : t));
    await setJSON("tasks-cache", payload);

    return json(200, { ok: true, task: list[idx] });
  }

  if (event.httpMethod === "DELETE") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.id) return json(400, { error: "Falta id" });

    const list = await getJSON("manual-tasks", []);
    await setJSON("manual-tasks", list.filter((t) => t.id !== body.id));

    const payload = await getJSON("tasks-cache", { tasks: [], checkins: [] });
    payload.tasks = (payload.tasks || []).filter((t) => t.id !== body.id);
    await setJSON("tasks-cache", payload);

    const overrides = await getJSON("task-overrides", {});
    if (overrides[body.id]) {
      delete overrides[body.id];
      await setJSON("task-overrides", overrides);
    }
    return json(200, { ok: true });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
