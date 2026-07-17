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
  const tasks = buildTasks(properties, icsByCode, employees, overrides);
  const checkins = buildCheckins(properties, icsByCode, overrides);

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
