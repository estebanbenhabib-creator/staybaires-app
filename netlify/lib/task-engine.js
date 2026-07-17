// Logica de negocio pura (sin red, sin Blobs) para poder testearla con
// "node script.js" sin depender de Netlify. La usan tanto la function
// tasks.mjs como los tests locales.

const { parseICS, checkoutsFromEvents, checkinsFromEvents } = require("./ics-parser");

const BLOCKED_SUMMARY_RE = /not available|blocked|closed$/i;

/**
 * Filtra checkouts que en realidad son bloqueos manuales del anfitrion
 * (no una reserva real), asi no generamos tareas de limpieza sin sentido.
 *
 * OJO: esto solo tiene sentido para Airbnb, que mezcla en el mismo feed
 * las reservas reales Y los bloqueos manuales del host ("Airbnb (Not
 * available)"). Booking.com y Vrbo exportan un feed que son solo reservas
 * confirmadas - si les aplicamos este mismo filtro, un evento con summary
 * "CLOSED - Not available" (que en Booking SI es una reserva real, asi le
 * dicen ellos) se descarta por error y la limpieza correspondiente
 * desaparece del calendario. Por eso el filtro solo corre para platform
 * "airbnb"; booking/vrbo siempre se toman como reserva real.
 */
function isRealReservationCheckout(checkout, platform) {
  if (platform !== "airbnb") return true;
  const s = (checkout.summary || "").trim();
  if (s === "") return true;
  if (/reserv/i.test(s)) return true; // "Reserved"
  if (BLOCKED_SUMMARY_RE.test(s)) return false;
  return true;
}

/**
 * A partir del texto crudo de los .ics de una propiedad (uno por plataforma),
 * devuelve la lista de fechas de checkout unicas, con la plataforma de origen.
 */
function checkoutsForProperty(icsTextsByPlatform) {
  const all = [];
  for (const [platform, text] of Object.entries(icsTextsByPlatform)) {
    if (!text) continue;
    let events;
    try {
      events = parseICS(text);
    } catch (err) {
      continue;
    }
    const checkouts = checkoutsFromEvents(events).filter((c) => isRealReservationCheckout(c, platform));
    for (const c of checkouts) {
      all.push({ ...c, platform });
    }
  }
  // dedup por fecha (si dos plataformas coincidieran, nos quedamos con la primera)
  const byDate = new Map();
  for (const c of all) {
    if (!byDate.has(c.date)) byDate.set(c.date, c);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Igual que checkoutsForProperty pero para la fecha de llegada del huesped
 * (DTSTART en vez de DTEND). Solo es informativo para el calendario, no
 * genera tareas de limpieza ni pasa por la logica de asignacion.
 */
function checkinsForProperty(icsTextsByPlatform) {
  const all = [];
  for (const [platform, text] of Object.entries(icsTextsByPlatform)) {
    if (!text) continue;
    let events;
    try {
      events = parseICS(text);
    } catch (err) {
      continue;
    }
    const checkins = checkinsFromEvents(events).filter((c) => isRealReservationCheckout(c, platform));
    for (const c of checkins) {
      all.push({ ...c, platform });
    }
  }
  const byDate = new Map();
  for (const c of all) {
    if (!byDate.has(c.date)) byDate.set(c.date, c);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Devuelve la primera empleada disponible segun jerarquia (orden de
 * asignacion) que no tenga ya una tarea asignada ese mismo dia. Si todas
 * las de la jerarquia ya tienen algo ese dia, cae en Random.
 */
function pickAssignee(date, employees, tasksAlreadyAssignedToday) {
  const cleaners = employees
    .filter((e) => e.rol === "empleada")
    .sort((a, b) => (a.ordenAsignacion || 99) - (b.ordenAsignacion || 99));

  for (const emp of cleaners) {
    const busy = tasksAlreadyAssignedToday.some((t) => t.assignedTo === emp.id);
    if (!busy) return emp.id;
  }
  // todas ocupadas: cae en la rotativa igual (alguien va a cubrir)
  const rotativa = cleaners.find((e) => e.esRotativa);
  return rotativa ? rotativa.id : cleaners[0] && cleaners[0].id;
}

/**
 * Construye la lista de tareas para todas las propiedades a partir de:
 *  - properties: array de netlify data/properties.json
 *  - icsResultsByCode: { [codigo]: { airbnb: text|null, booking: text|null, vrbo: text|null } }
 *  - employees: array de data/employees.json
 *  - overrides: { [taskId]: { status, assignedTo, assignedName, notes } } (lo que persiste Blobs)
 * Devuelve un array de tareas ordenado por fecha.
 */
function buildTasks(properties, icsResultsByCode, employees, overrides = {}) {
  const tasks = [];
  const assignedByDate = new Map();

  for (const prop of properties) {
    const icsTexts = icsResultsByCode[prop.codigo] || {};
    const checkouts = checkoutsForProperty(icsTexts);
    for (const c of checkouts) {
      const taskId = `${prop.codigo}_${c.date}`;
      const already = overrides[taskId];

      if (!assignedByDate.has(c.date)) assignedByDate.set(c.date, []);
      const todays = assignedByDate.get(c.date);

      const assignedTo = already?.assignedTo || pickAssignee(c.date, employees, todays);
      todays.push({ assignedTo });

      tasks.push({
        id: taskId,
        propertyCode: prop.codigo,
        propertyName: prop.nombre,
        barrio: prop.barrio,
        direccion: prop.direccion || "",
        date: c.date,
        platform: c.platform,
        type: "checkout",
        status: already?.status || "pendiente",
        assignedTo,
        assignedName: already?.assignedName || null,
        notes: already?.notes || null,
      });
    }
  }

  return tasks.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Construye la lista de check-ins (llegadas de huespedes) para todas las
 * propiedades. Es solo informativo para el calendario del admin/Susana -
 * no genera tareas, no tiene asignacion ni estado.
 */
function buildCheckins(properties, icsResultsByCode) {
  const checkins = [];
  for (const prop of properties) {
    const icsTexts = icsResultsByCode[prop.codigo] || {};
    const llegadas = checkinsForProperty(icsTexts);
    for (const c of llegadas) {
      checkins.push({
        id: `${prop.codigo}_checkin_${c.date}`,
        propertyCode: prop.codigo,
        propertyName: prop.nombre,
        barrio: prop.barrio,
        direccion: prop.direccion || "",
        date: c.date,
        platform: c.platform,
        type: "checkin",
      });
    }
  }
  return checkins.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { checkoutsForProperty, checkinsForProperty, pickAssignee, buildTasks, buildCheckins, isRealReservationCheckout };
