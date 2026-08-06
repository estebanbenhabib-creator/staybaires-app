// Convierte una reserva cargada a mano (blob "ingresos-manual", que alimenta el
// modulo Ingresos) en las tareas del calendario: un CHECK-OUT (limpieza) el dia
// de egreso y un CHECK-IN el dia de ingreso. Asi una reserva arreglada por fuera
// de las plataformas aparece igual que una de Airbnb/Booking: asignable, se
// marca hecha y cuenta para el pago. Se usa desde sync-calendars (para que
// sobreviva cada resync) y desde ingresos-manual (para reflejarla al instante).
//
// El check-out reusa el mismo id que los de iCal (`${codigo}_${fin}`) para que
// los overrides (asignacion / hecho) funcionen igual. El check-in usa el mismo
// esquema que buildCheckins (`${codigo}_checkin_${inicio}`).

// Devuelve { checkout, checkin } (cualquiera puede ser null si falta la fecha o
// la propiedad no existe). overrides = blob "task-overrides".
function reservaManualTasks(reserva, properties, overrides = {}) {
  const prop = properties.find((p) => p.codigo === reserva.codigo);
  if (!prop) return { checkout: null, checkin: null };

  let checkout = null;
  if (reserva.fin) {
    const id = `${prop.codigo}_${reserva.fin}`;
    const ov = overrides[id] || {};
    checkout = {
      id,
      propertyCode: prop.codigo,
      propertyName: prop.nombre,
      barrio: prop.barrio,
      direccion: prop.direccion || "",
      date: ov.fecha || reserva.fin,
      fechaOriginal: ov.fecha && ov.fecha !== reserva.fin ? reserva.fin : null,
      platform: "directo",
      type: "checkout",
      origen: "reserva-manual",
      manualResId: reserva.id || null,
      status: ov.status || "pendiente",
      assignedTo: ov.assignedTo || null,
      assignedName: ov.assignedName || null,
      notes: ov.notes || (reserva.huesped ? `Reserva a mano · ${reserva.huesped}` : "Reserva a mano"),
    };
  }

  let checkin = null;
  if (reserva.inicio) {
    const id = `${prop.codigo}_checkin_${reserva.inicio}`;
    checkin = {
      id,
      propertyCode: prop.codigo,
      propertyName: prop.nombre,
      barrio: prop.barrio,
      direccion: prop.direccion || "",
      date: reserva.inicio,
      platform: "directo",
      type: "checkin",
      origen: "reserva-manual",
      manualResId: reserva.id || null,
      done: overrides[id]?.done || false,
    };
  }

  return { checkout, checkin };
}

module.exports = { reservaManualTasks };
