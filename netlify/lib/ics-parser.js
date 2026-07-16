// Parser de iCalendar (RFC 5545) hecho a mano, sin dependencias externas.
// Alcanza para lo que exportan Airbnb, Booking.com y Vrbo: bloques VEVENT
// simples con DTSTART/DTEND/SUMMARY/UID. No intenta soportar recurrencia
// (RRULE) porque las reservas no la usan.

function unfoldLines(raw) {
  // RFC5545: una linea que empieza con espacio o tab es continuacion de la anterior.
  const rawLines = raw.replace(/\r\n/g, "\n").split("\n");
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim() !== "") {
      lines.push(line);
    }
  }
  return lines;
}

function parseDateValue(value, params) {
  // value tipo 20260718 (solo fecha) o 20260718T110000Z (fecha+hora)
  const isDateOnly = /^\d{8}$/.test(value) || (params && params.VALUE === "DATE");
  const clean = value.replace("Z", "");
  const y = clean.slice(0, 4);
  const m = clean.slice(4, 6);
  const d = clean.slice(6, 8);
  if (isDateOnly || clean.length <= 8) {
    return { date: `${y}-${m}-${d}`, allDay: true };
  }
  const hh = clean.slice(9, 11) || "00";
  const mm = clean.slice(11, 13) || "00";
  const ss = clean.slice(13, 15) || "00";
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}:${ss}`, allDay: false };
}

function parseLine(line) {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const [key, ...paramParts] = left.split(";");
  const params = {};
  for (const p of paramParts) {
    const [pk, pv] = p.split("=");
    if (pk) params[pk] = pv;
  }
  return { key: key.toUpperCase(), value, params };
}

/**
 * Parsea un .ics y devuelve una lista de eventos { uid, start, end, summary, raw }
 */
function parseICS(icsText) {
  const lines = unfoldLines(icsText);
  const events = [];
  let current = null;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { key, value, params } = parsed;

    if (key === "BEGIN" && value === "VEVENT") {
      current = { uid: null, start: null, end: null, summary: "" };
      continue;
    }
    if (key === "END" && value === "VEVENT") {
      if (current && current.start && current.end) {
        events.push(current);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    if (key === "UID") current.uid = value;
    else if (key === "DTSTART") current.start = parseDateValue(value, params);
    else if (key === "DTEND") current.end = parseDateValue(value, params);
    else if (key === "SUMMARY") current.summary = value;
  }

  return events;
}

/**
 * A partir de eventos de reserva, calcula las fechas de checkout (= DTEND,
 * porque en el formato DATE el rango es start..end exclusive, y el huesped
 * se va la manana del DTEND).
 */
function checkoutsFromEvents(events) {
  const seen = new Map();
  for (const ev of events) {
    if (!ev.end) continue;
    const key = ev.end.date;
    if (!seen.has(key)) {
      seen.set(key, { date: key, uid: ev.uid, summary: ev.summary });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { parseICS, checkoutsFromEvents, unfoldLines, parseDateValue };
