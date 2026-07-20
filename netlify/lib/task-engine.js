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

// Booking marca igual las reservas reales y los bloqueos manuales del
// anfitrion ("CLOSED - Not available"), sin forma de distinguirlos por el
// texto. Pero un bloqueo suele ser de meses y una reserva real es corta, asi
// que descartamos como bloqueo cualquier evento de Booking de mas de 90 noches
// (ninguna reserva por noche dura tanto). Las reservas cortas se respetan.
const MAX_NOCHES_BOOKING = 90;

function nochesEvento(ev) {
  if (!ev.start || !ev.end) return 0;
  return Math.round((new Date(ev.end.date + "T00:00:00") - new Date(ev.start.date + "T00:00:00")) / 86400000);
}

function esBloqueoLargoBooking(ev, platform) {
  return platform === "booking" && nochesEvento(ev) > MAX_NOCHES_BOOKING;
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
    const usables = events.filter((ev) => !esBloqueoLargoBooking(ev, platform));
    const checkouts = checkoutsFromEvents(usables).filter((c) => isRealReservationCheckout(c, platform));
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
    const usables = events.filter((ev) => !esBloqueoLargoBooking(ev, platform));
    const checkins = checkinsFromEvents(usables).filter((c) => isRealReservationCheckout(c, platform));
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
 * Empleada asignada por defecto a toda tarea nueva: la principal (Susana),
 * que coordina y despues reparte a Mari/Random reasignando a mano. La
 * reasignacion manual se respeta aparte (via overrides en buildTasks), asi
 * que esto solo define el estado inicial de una tarea sin tocar.
 */
function pickAssignee(employees) {
  const cleaners = employees
    .filter((e) => e.rol === "empleada")
    .sort((a, b) => (a.ordenAsignacion || 99) - (b.ordenAsignacion || 99));
  return cleaners[0] ? cleaners[0].id : null;
}

/**
 * Construye la lista de tareas para todas las propiedades a partir de:
 *  - properties: array de netlify data/properties.json
 *  - icsResultsByCode: { [codigo]: { airbnb: text|null, booking: text|null, vrbo: text|null } }
 *  - employees: array de data/employees.json
 *  - overrides: { [taskId]: { status, assignedTo, assignedName, notes } } (lo que persiste Blobs)
 * Devuelve un array de tareas ordenado por fecha.
 */
// Devuelve los .ics de una propiedad. Si la propiedad tiene el Booking solo
// para bloquear fechas (bookingSoloBloqueo), ignoramos ese feed: Booking marca
// igual las reservas reales y los bloqueos manuales ("CLOSED - Not available"),
// asi que en esos deptos generaria check-ins/limpiezas fantasma.
function icsParaPropiedad(prop, icsResultsByCode) {
  const icsTexts = icsResultsByCode[prop.codigo] || {};
  return prop.bookingSoloBloqueo ? { ...icsTexts, booking: null } : icsTexts;
}

function buildTasks(properties, icsResultsByCode, employees, overrides = {}) {
  const tasks = [];

  for (const prop of properties) {
    const icsTexts = icsParaPropiedad(prop, icsResultsByCode);
    const checkouts = checkoutsForProperty(icsTexts);
    for (const c of checkouts) {
      const taskId = `${prop.codigo}_${c.date}`;
      const already = overrides[taskId];

      // Arranca sin asignar: hay que elegir quien limpio antes de marcarla
      // hecha, para que el pago no se acredite mal.
      const assignedTo = already?.assignedTo || null;

      // Si se cambio la fecha a mano (ej. el huesped extendio por afuera de la
      // plataforma), la limpieza va en la fecha real; guardamos la del iCal.
      const fechaReal = already?.fecha || c.date;

      tasks.push({
        id: taskId,
        propertyCode: prop.codigo,
        propertyName: prop.nombre,
        barrio: prop.barrio,
        direccion: prop.direccion || "",
        date: fechaReal,
        fechaOriginal: fechaReal !== c.date ? c.date : null,
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
 * propiedades. No genera tareas ni tiene asignacion, pero si guarda un flag
 * "done" (via overrides) para poder marcar en el calendario que la llegada
 * ya se gestiono.
 */
function buildCheckins(properties, icsResultsByCode, overrides = {}) {
  const checkins = [];
  for (const prop of properties) {
    const icsTexts = icsParaPropiedad(prop, icsResultsByCode);
    const llegadas = checkinsForProperty(icsTexts);
    for (const c of llegadas) {
      const id = `${prop.codigo}_checkin_${c.date}`;
      checkins.push({
        id,
        propertyCode: prop.codigo,
        propertyName: prop.nombre,
        barrio: prop.barrio,
        direccion: prop.direccion || "",
        date: c.date,
        platform: c.platform,
        type: "checkin",
        done: overrides[id]?.done || false,
      });
    }
  }
  return checkins.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { checkoutsForProperty, checkinsForProperty, pickAssignee, buildTasks, buildCheckins, isRealReservationCheckout };
