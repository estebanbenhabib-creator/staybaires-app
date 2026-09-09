// Se ejecuta 1 vez por dia sola (ver schedule en netlify.toml) y tambien se
// puede llamar a mano pegandole a /.netlify/functions/sync-calendars para
// forzar un refresco ("Actualizar ahora" en el admin).

const properties = require("../../data/properties.json");
const employees = require("../../data/employees.json");
const { fetchAllCalendars } = require("../lib/fetch-calendars");
const { buildTasks, buildCheckins, consolidarBooking } = require("../lib/task-engine");
const { reservaManualTasks } = require("../lib/manual-reservas");
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

  // "Hoy" en horario de Argentina (UTC-3); el server corre en UTC.
  const hoyAR = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  // Memoria de estadias de Booking: reconocemos cada reserva por solapamiento y
  // guardamos su llegada/salida REAL, porque Booking corre el DTSTART de las
  // reservas en curso y ademas saca la reserva del feed el dia del checkout.
  // De aca salen tanto los check-in como los check-out (limpiezas) de Booking.
  const estadiasPrev = await getJSON("booking-estadias", {});
  const { reservas: reservasBk, estadias } = consolidarBooking(properties, icsByCode, estadiasPrev, hoyAR);
  await setJSON("booking-estadias", estadias);

  const icalTasks = buildTasks(properties, icsByCode, employees, overrides, reservasBk);

  // Tareas manuales (inspecciones, limpiezas extra): no vienen de iCal, se
  // guardan aparte y se fusionan aca aplicandoles los mismos overrides.
  const manual = await getJSON("manual-tasks", []);
  const manualTasks = manual.map((m) => ({ ...m, ...(overrides[m.id] || {}) }));

  const tasks = [...icalTasks, ...manualTasks].sort((a, b) => a.date.localeCompare(b.date));
  const checkins = buildCheckins(properties, icsByCode, overrides, hoyAR, reservasBk);

  // Reservas cargadas a mano (arregladas por fuera de las plataformas): generan
  // su check-out (limpieza) y check-in, con dedup por id contra las de iCal.
  const reservasManuales = await getJSON("ingresos-manual", []);
  const idsTasks = new Set(tasks.map((t) => t.id));
  const idsCheckins = new Set(checkins.map((c) => c.id));
  for (const r of reservasManuales) {
    const { checkout, checkin } = reservaManualTasks(r, properties, overrides);
    if (checkout && !idsTasks.has(checkout.id)) {
      tasks.push(checkout);
      idsTasks.add(checkout.id);
    }
    if (checkin && !idsCheckins.has(checkin.id)) {
      checkins.push(checkin);
      idsCheckins.add(checkin.id);
    }
  }
  // Extensiones huérfanas: un check-out que se movió a una fecha posterior con
  // "Cambiar día" (override.fecha), pero cuya reserva ya se cayó del feed de
  // iCal, dejaría de generarse y la limpieza desaparecería. Si esa fecha movida
  // es hoy o futura y la tarea no está hecha ni ya presente, la reponemos.
  for (const [id, ov] of Object.entries(overrides)) {
    if (!ov || !ov.fecha) continue; // solo las que se movieron de día
    if (id.includes("_checkin_") || id.startsWith("manual_")) continue; // solo check-outs de depto
    if (idsTasks.has(id)) continue; // ya la generó el feed (con el override aplicado)
    if (ov.status === "hecha") continue; // ya resuelta
    if (ov.fecha < hoyAR) continue; // solo hoy/futuro, para no revivir extensiones viejas
    const us = id.indexOf("_");
    if (us <= 0) continue;
    const codigo = id.slice(0, us);
    const prop = properties.find((p) => p.codigo === codigo);
    if (!prop) continue;
    tasks.push({
      id,
      propertyCode: codigo,
      propertyName: prop.nombre,
      barrio: prop.barrio,
      direccion: prop.direccion || "",
      date: ov.fecha,
      fechaOriginal: id.slice(us + 1),
      platform: "directo",
      type: "checkout",
      origen: "extension",
      status: ov.status || "pendiente",
      assignedTo: ov.assignedTo || null,
      assignedName: ov.assignedName || null,
      notes: ov.notes || "Extensión · la reserva ya no está en el calendario",
    });
    idsTasks.add(id);
  }

  tasks.sort((a, b) => a.date.localeCompare(b.date));
  checkins.sort((a, b) => a.date.localeCompare(b.date));

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
