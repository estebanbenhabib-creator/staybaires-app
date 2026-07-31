// Motor de calculo de ingresos netos por departamento. Puro (sin DOM ni red)
// para poder testearlo con node. Lo usa la pantalla "Ingresos" (app.js) sobre
// las filas que devuelve el lector de planillas (SheetJS), y tambien los tests.
//
// Fuentes:
//  - Airbnb: export "Ganancias/Transacciones" (CSV). Cada reserva trae un tipo:
//      "Reserva"               -> sos el anfitrion (host directo)
//      "Cobro como coanfitrion"-> sos co-host, el monto ya es TU parte
//      "Payout"                -> transferencia (se ignora para atribuir)
//      "Ajuste"                -> correccion de una reserva (se suma al grupo)
//    El pago de Airbnb YA viene neto de la comision de Airbnb.
//  - Booking: export de reservas. Trae Total Payment (100%) y Commission (lo
//    que cobra Booking). El cobro lo hace Esteban directo al huesped.
//
// Formulas (validadas con Esteban, julio 2026):
//  Airbnb co-anfitrion         -> vos = monto liquidado;           dueño = 0
//  Airbnb host directo, propio -> vos = deposito;                  dueño = 0
//  Airbnb host directo, tercero-> dueño = (deposito - limpieza) * 0.85 * 0.92
//                                 vos   = deposito - dueño
//  Booking propio              -> vos = total - comisionBooking;   dueño = 0
//  Booking tercero             -> dueño = (total - comisionBooking - limpieza) * 0.85
//                                 vos   = (total - comisionBooking) - dueño
//  (El "costo chicas" — lo que se paga a la limpieza — se resta en una capa
//   posterior; aca todavia no.)

(function (root) {
  "use strict";

  const CONFIG_DEFAULT = {
    // Palabras clave (en minuscula) para reconocer los deptos PROPIOS de Esteban
    // (se queda el 100%, sin pago a dueño). Editable desde la pantalla de config.
    propioAirbnb: ["cañitas", "chacarita"], // San Benito, Dorrego (Manzanares va como co-anfitrion)
    propioBooking: ["dorrego", "san benito"],
    limpiezaBooking: 30, // el export de Booking no trae limpieza; tarifa fija por depto (USD)
  };

  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v == null ? "" : v).trim().replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function contieneAlguna(texto, claves) {
    const t = (texto || "").toLowerCase();
    return claves.some((k) => t.includes(k));
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // ---- AIRBNB ----
  // Agrupa filas por codigo de confirmacion y calcula por reserva.
  function calcularAirbnb(rows, cfg) {
    const grupos = new Map();
    for (const r of rows) {
      const tipo = String(r["Tipo"] || "").trim();
      const cod = String(r["Código de confirmación"] || r["Codigo de confirmación"] || "").trim();
      if (tipo === "Payout" || !cod) continue;
      if (!grupos.has(cod)) {
        grupos.set(cod, { cod, anuncio: "", tipo: null, deposito: 0, limpieza: 0, inicio: "", fin: "", huesped: "" });
      }
      const g = grupos.get(cod);
      g.anuncio = String(r["Anuncio"] || "").trim() || g.anuncio;
      g.deposito += num(r["Monto"]);
      if (tipo !== "Ajuste") {
        g.tipo = tipo;
        g.limpieza = Math.max(g.limpieza, num(r["Tarifa de limpieza"]));
        g.inicio = String(r["Fecha de inicio"] || "").trim();
        g.fin = String(r["Fecha de finalización"] || "").trim();
        g.huesped = String(r["Huésped"] || "").trim();
      }
    }
    const reservas = [];
    for (const g of grupos.values()) {
      const coanfitrion = g.tipo === "Cobro como coanfitrión" || g.tipo === "Cobro como coanfitrion";
      const propio = contieneAlguna(g.anuncio, cfg.propioAirbnb);
      let vos, dueno, modalidad;
      if (coanfitrion) {
        modalidad = "coanfitrion";
        vos = g.deposito;
        dueno = 0;
      } else if (propio) {
        modalidad = "propio";
        vos = g.deposito;
        dueno = 0;
      } else {
        modalidad = "host_tercero";
        dueno = (g.deposito - g.limpieza) * 0.85 * 0.92;
        vos = g.deposito - dueno;
      }
      reservas.push({
        plataforma: "airbnb",
        codigo: g.cod,
        unidad: g.anuncio,
        huesped: g.huesped,
        inicio: g.inicio,
        fin: g.fin,
        modalidad,
        ingreso: g.deposito,
        limpieza: g.limpieza,
        vos: round2(vos),
        dueno: round2(dueno),
      });
    }
    return reservas;
  }

  // ---- BOOKING ----
  function calcularBooking(rows, cfg) {
    const reservas = [];
    for (const r of rows) {
      const nombre = String(r["Property Name"] || "").trim();
      const loc = String(r["Location"] || "").trim();
      const total = num(r["Total Payment"]);
      const com = num(r["Commission"]);
      if (!nombre && !total) continue;
      const propio = contieneAlguna(nombre + " " + loc, cfg.propioBooking);
      const limpieza = cfg.limpiezaBooking;
      let vos, dueno, modalidad;
      const saldo = total - com;
      if (propio) {
        modalidad = "propio";
        vos = saldo;
        dueno = 0;
      } else {
        modalidad = "tercero";
        dueno = (saldo - limpieza) * 0.85;
        vos = saldo - dueno;
      }
      reservas.push({
        plataforma: "booking",
        codigo: String(r["Reservation Number"] || "").replace(/\.0$/, ""),
        unidad: nombre,
        huesped: String(r["Booker Name"] || "").trim(),
        inicio: String(r["Arrival"] || "").trim(),
        fin: String(r["Departure"] || "").trim(),
        modalidad,
        ingreso: total,
        limpieza: propio ? 0 : limpieza,
        vos: round2(vos),
        dueno: round2(dueno),
      });
    }
    return reservas;
  }

  // Agrupa una lista de reservas por unidad (anuncio/propiedad) y suma.
  function agrupar(reservas) {
    const map = new Map();
    for (const r of reservas) {
      const key = r.plataforma + "||" + r.unidad;
      if (!map.has(key)) {
        map.set(key, { plataforma: r.plataforma, unidad: r.unidad, modalidad: r.modalidad, n: 0, ingreso: 0, vos: 0, dueno: 0, reservas: [] });
      }
      const g = map.get(key);
      g.n += 1;
      g.ingreso += r.ingreso;
      g.vos += r.vos;
      g.dueno += r.dueno;
      g.reservas.push(r);
    }
    const out = Array.from(map.values()).map((g) => ({
      ...g,
      ingreso: round2(g.ingreso),
      vos: round2(g.vos),
      dueno: round2(g.dueno),
    }));
    out.sort((a, b) => b.vos - a.vos);
    return out;
  }

  // Entrada principal: recibe las filas crudas de cada archivo (o null) y
  // devuelve reservas, agrupado por unidad y totales.
  function computeIngresos(airbnbRows, bookingRows, cfgOverride) {
    const cfg = Object.assign({}, CONFIG_DEFAULT, cfgOverride || {});
    const reservas = [
      ...(airbnbRows ? calcularAirbnb(airbnbRows, cfg) : []),
      ...(bookingRows ? calcularBooking(bookingRows, cfg) : []),
    ];
    const porUnidad = agrupar(reservas);
    const totales = reservas.reduce(
      (acc, r) => {
        acc.ingreso += r.ingreso;
        acc.vos += r.vos;
        acc.dueno += r.dueno;
        return acc;
      },
      { ingreso: 0, vos: 0, dueno: 0, n: reservas.length }
    );
    totales.ingreso = round2(totales.ingreso);
    totales.vos = round2(totales.vos);
    totales.dueno = round2(totales.dueno);
    return { reservas, porUnidad, totales, cfg };
  }

  const API = { computeIngresos, calcularAirbnb, calcularBooking, agrupar, num, CONFIG_DEFAULT };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.IngresosEngine = API;
})(typeof self !== "undefined" ? self : this);
