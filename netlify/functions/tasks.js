// GET  /.netlify/functions/tasks            -> lista de tareas (cache, rapido)
// GET  /.netlify/functions/tasks?refresh=1   -> fuerza resync de calendarios antes de responder
// POST /.netlify/functions/tasks             -> actualiza una tarea puntual
//      body: { id, status?, assignedTo?, assignedName?, notes? }

const { getJSON, setJSON } = require("../lib/store");
const { runSync } = require("./sync-calendars");

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    const forceRefresh = event.queryStringParameters && event.queryStringParameters.refresh === "1";
    let payload = await getJSON("tasks-cache", null);

    const stale = !payload || Date.now() - new Date(payload.lastSync).getTime() > SIX_HOURS_MS;
    if (forceRefresh || stale) {
      try {
        payload = await runSync();
      } catch (err) {
        if (!payload) {
          return { statusCode: 500, body: JSON.stringify({ error: "No se pudo sincronizar calendarios: " + err.message }) };
        }
        // seguimos con la cache vieja si el resync falla pero ya habia algo guardado
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || { tasks: [], checkins: [], lastSync: null, syncErrors: [] }),
    };
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "JSON invalido" }) };
    }
    if (!body.id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta id de tarea" }) };
    }

    const overrides = await getJSON("task-overrides", {});
    overrides[body.id] = {
      ...(overrides[body.id] || {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.assignedTo ? { assignedTo: body.assignedTo } : {}),
      ...(body.assignedName !== undefined ? { assignedName: body.assignedName } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.done !== undefined ? { done: body.done } : {}),
      ...(body.fecha ? { fecha: body.fecha } : {}),
    };
    await setJSON("task-overrides", overrides);

    const ov = overrides[body.id];
    const patch = (t) => {
      const m = { ...t, ...ov };
      // Si se cambio la fecha a mano, mover la tarea a esa fecha (y recordar la original).
      if (ov.fecha) {
        m.fechaOriginal = t.fechaOriginal || t.date;
        m.date = ov.fecha;
      }
      return m;
    };
    const payload = await getJSON("tasks-cache", { tasks: [], checkins: [], lastSync: null, syncErrors: [] });
    payload.tasks = payload.tasks.map((t) => (t.id === body.id ? patch(t) : t)).sort((a, b) => a.date.localeCompare(b.date));
    payload.checkins = (payload.checkins || []).map((c) => (c.id === body.id ? { ...c, ...ov } : c));
    await setJSON("tasks-cache", payload);

    const updated = payload.tasks.find((t) => t.id === body.id) || payload.checkins.find((c) => c.id === body.id);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, task: updated }) };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
