// Se ejecuta 1 vez por dia sola (ver schedule en netlify.toml) y tambien se
// puede llamar a mano pegandole a /.netlify/functions/sync-calendars para
// forzar un refresco ("Actualizar ahora" en el admin).

const properties = require("../../data/properties.json");
const employees = require("../../data/employees.json");
const { fetchAllCalendars } = require("../lib/fetch-calendars");
const { buildTasks, buildCheckins } = require("../lib/task-engine");
const { getJSON, setJSON } = require("../lib/store");

async function runSync() {
  const icsResults = await fetchAllCalendars(properties);

  const icsByCode = {};
  const errors = [];
  for (const [codigo, r] of Object.entries(icsResults)) {
    icsByCode[codigo] = { airbnb: r.airbnb, booking: r.booking, vrbo: r.vrbo };
    if (r.errors.length) errors.push({ codigo, errors: r.errors });
  }

  const overrides = await getJSON("task-overrides", {});
  const icalTasks = buildTasks(properties, icsByCode, employees, overrides);

  // Tareas manuales (inspecciones, limpiezas extra): no vienen de iCal, se
  // guardan aparte y se fusionan aca aplicandoles los mismos overrides.
  const manual = await getJSON("manual-tasks", []);
  const manualTasks = manual.map((m) => ({ ...m, ...(overrides[m.id] || {}) }));

  const tasks = [...icalTasks, ...manualTasks].sort((a, b) => a.date.localeCompare(b.date));
  // "Hoy" en horario de Argentina (UTC-3) para filtrar los check-in corridos de
  // Booking (ver buildCheckins). El server corre en UTC.
  const hoyAR = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const checkins = buildCheckins(properties, icsByCode, overrides, hoyAR);

  const payload = {
    tasks,
    checkins,
    lastSync: new Date().toISOString(),
    syncErrors: errors,
  };
  await setJSON("tasks-cache", payload);
  return payload;
}

exports.handler = async () => {
  try {
    const payload = await runSync();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, tasks: payload.tasks.length, syncErrors: payload.syncErrors, lastSync: payload.lastSync }),
    };
  } catch (err) {
    console.error("sync-calendars fallo:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};

exports.runSync = runSync;
