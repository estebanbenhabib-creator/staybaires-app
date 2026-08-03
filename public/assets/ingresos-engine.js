// Motor de calculo de ingresos netos por departamento. Puro (sin DOM ni red)
// para poder testearlo con node. Lo usa la pantalla "Ingresos" (app.js) sobre
// las filas que devuelve el lector de planillas (SheetJS), y tambien los tests.
//
// Dos etapas separadas a proposito:
//   1) parseArchivos(airbnbRows, bookingRows) -> reservas CRUDAS (lo que se
//      guarda por mes; no depende de ninguna config).
//   2) computeIngresos(reservasCrudas, cfg)   -> aplica el reparto usando el
//      mapeo unidad->depto y la marca propio/tercero. Asi, cambiar el mapeo
//      recalcula todo sin volver a subir los archivos.
//
// Fuentes:
//  - Airbnb: export "Ganancias/Transacciones". Filas: "Reserva" (host directo),
//    "Cobro como coanfitrion" (el monto ya es la parte de Esteban),
//    "Payout" (se ignora), "Ajuste" (se suma al grupo por codigo). El pago de
//    Airbnb YA viene neto de la comision de Airbnb.
//  - Booking: export de reservas. Total Payment (100%), Commission (comision de
//    Booking). Esteban cobra directo al huesped; Booking no trae limpieza.
//
// Formulas (validadas con Esteban; el 15% va sobre la base YA sin limpieza):
//  Airbnb co-anfitrion         -> vos = monto liquidado;           dueño = 0
//  Airbnb host directo, propio -> vos = deposito;                  dueño = 0
//  Airbnb host directo, tercero-> dueño = (deposito - limpieza) * 0.85 * 0.92
//  Booking propio              -> vos = total - comisionBooking;   dueño = 0
//  Booking tercero             -> dueño = (total - comisionBooking - limpieza) * 0.85

(function (root) {
  "use strict";

  const CONFIG_DEFAULT = {
    // Mapeo de unidad (nombre de anuncio Airbnb / Property Name de Booking) a
    // { codigo, propio }. Lo edita la pantalla de config (Fase 2). Vacio = nada
    // asociado todavia.
    mapeo: {},
    // Fallback para marcar PROPIO cuando una unidad no esta en el mapeo (para no
    // romper los numeros antes de configurar). San Benito, Dorrego.
    propioAirbnb: ["cañitas", "chacarita"],
    propioBooking: ["dorrego", "san benito"],
    limpiezaBooking: 30, // el export de Booking no trae limpieza; tarifa fija (USD)
    // Para el neto (Fase 3): valor que se le paga a la chica por limpiar cada
    // depto (ARS, de pay-config) y cotizacion ARS por USD. Con eso se resta el
    // costo de limpieza de cada reserva. Sin cotizacion (0), el costo es 0.
    valorDepto: {},
    cotizacion: 0,
    // Alquileres de larga estadia (renta fija mensual, no vienen de las
    // plataformas). Cada uno: { codigo, tipo: "propio"|"comision",
    // montoMensual, comisionPct, activo }. Se suman a cada mes.
    rentasFijas: [],
  };

  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v == null ? "" : v).trim().replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  function contieneAlguna(texto, claves) {
    const t = (texto || "").toLowerCase();
    return (claves || []).some((k) => t.includes(k));
  }
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // ---- PARSEO (reservas crudas, sin reparto) ----
  function parseAirbnb(rows) {
    const grupos = new Map();
    for (const r of rows) {
      const tipo = String(r["Tipo"] || "").trim();
      const cod = String(r["Código de confirmación"] || r["Codigo de confirmación"] || "").trim();
      if (tipo === "Payout" || !cod) continue;
      if (!grupos.has(cod)) {
        grupos.set(cod, { plataforma: "airbnb", codigoReserva: cod, unidad: "", tipoAirbnb: null, deposito: 0, limpieza: 0, inicio: "", fin: "", huesped: "" });
      }
      const g = grupos.get(cod);
      g.unidad = String(r["Anuncio"] || "").trim() || g.unidad;
      g.deposito += num(r["Monto"]);
      if (tipo !== "Ajuste") {
        g.tipoAirbnb = tipo === "Cobro como coanfitrión" || tipo === "Cobro como coanfitrion" ? "coanfitrion" : "reserva";
        g.limpieza = Math.max(g.limpieza, num(r["Tarifa de limpieza"]));
        g.inicio = String(r["Fecha de inicio"] || "").trim();
        g.fin = String(r["Fecha de finalización"] || "").trim();
        g.huesped = String(r["Huésped"] || "").trim();
      }
    }
    for (const g of grupos.values()) g.deposito = round2(g.deposito);
    return Array.from(grupos.values());
  }

  function parseBooking(rows) {
    const out = [];
    for (const r of rows) {
      const nombre = String(r["Property Name"] || "").trim();
      const total = num(r["Total Payment"]);
      if (!nombre && !total) continue;
      out.push({
        plataforma: "booking",
        codigoReserva: String(r["Reservation Number"] || "").replace(/\.0$/, ""),
        unidad: nombre,
        location: String(r["Location"] || "").trim().replace(/\s+/g, " "),
        total,
        comision: num(r["Commission"]),
        inicio: String(r["Arrival"] || "").trim(),
        fin: String(r["Departure"] || "").trim(),
        huesped: String(r["Booker Name"] || "").trim(),
      });
    }
    return out;
  }

  function parseArchivos(airbnbRows, bookingRows) {
    return [
      ...(airbnbRows ? parseAirbnb(airbnbRows) : []),
      ...(bookingRows ? parseBooking(bookingRows) : []),
    ];
  }

  // ---- REPARTO de una reserva cruda segun el mapeo ----
  function repartir(r, cfg) {
    const m = cfg.mapeo[r.unidad];
    const codigo = m && m.codigo ? m.codigo : null;
    let vos, dueno, modalidad, ingreso;
    if (r.plataforma === "airbnb") {
      ingreso = r.deposito;
      const propio = m ? !!m.propio : contieneAlguna(r.unidad, cfg.propioAirbnb);
      if (r.tipoAirbnb === "coanfitrion") {
        modalidad = "coanfitrion";
        vos = r.deposito;
        dueno = 0;
      } else if (propio) {
        modalidad = "propio";
        vos = r.deposito;
        dueno = 0;
      } else {
        modalidad = "host_tercero";
        dueno = (r.deposito - r.limpieza) * 0.85 * 0.92;
        vos = r.deposito - dueno;
      }
    } else {
      ingreso = r.total;
      const propio = m ? !!m.propio : contieneAlguna(r.unidad + " " + (r.location || ""), cfg.propioBooking);
      const saldo = r.total - r.comision;
      if (propio) {
        modalidad = "propio";
        vos = saldo;
        dueno = 0;
      } else {
        modalidad = "tercero";
        dueno = (saldo - cfg.limpiezaBooking) * 0.85;
        vos = saldo - dueno;
      }
    }
    // Costo de limpieza de esta reserva (una limpieza por reserva): el valor del
    // depto en ARS pasado a USD. Solo si el depto esta asociado y hay cotizacion.
    const valorArs = codigo && cfg.valorDepto ? Number(cfg.valorDepto[codigo]) || 0 : 0;
    const costoLimpieza = cfg.cotizacion > 0 ? round2(valorArs / cfg.cotizacion) : 0;
    const neto = round2(vos - costoLimpieza);
    return { ...r, codigo, modalidad, ingreso: round2(ingreso), vos: round2(vos), dueno: round2(dueno), costoLimpieza, neto };
  }

  function agrupar(reservas) {
    const map = new Map();
    for (const r of reservas) {
      const key = r.codigo ? "depto:" + r.codigo : r.plataforma + "||" + r.unidad;
      if (!map.has(key)) {
        map.set(key, { codigo: r.codigo || null, unidad: r.unidad, plataforma: r.plataforma, asociado: !!r.codigo, n: 0, ingreso: 0, vos: 0, dueno: 0, costoLimpieza: 0, neto: 0, modalidades: [], reservas: [] });
      }
      const g = map.get(key);
      g.n += 1;
      g.ingreso += r.ingreso;
      g.vos += r.vos;
      g.dueno += r.dueno;
      g.costoLimpieza += r.costoLimpieza;
      g.neto += r.neto;
      // modalidades presentes en el depto (unicas, en orden de aparicion)
      if (r.modalidad && !g.modalidades.includes(r.modalidad)) g.modalidades.push(r.modalidad);
      g.reservas.push(r);
      // si un depto junta Airbnb+Booking, marcamos plataforma mixta
      if (g.plataforma !== r.plataforma) g.plataforma = "mix";
    }
    const out = Array.from(map.values()).map((g) => ({ ...g, ingreso: round2(g.ingreso), vos: round2(g.vos), dueno: round2(g.dueno), costoLimpieza: round2(g.costoLimpieza), neto: round2(g.neto) }));
    out.sort((a, b) => b.vos - a.vos);
    return out;
  }

  // Lista de unidades unicas detectadas (para la pantalla de config).
  function unidadesDetectadas(reservasCrudas) {
    const map = new Map();
    for (const r of reservasCrudas) {
      if (!map.has(r.unidad)) map.set(r.unidad, { unidad: r.unidad, plataforma: r.plataforma, location: r.location || "", n: 0 });
      map.get(r.unidad).n += 1;
      if (r.plataforma === "booking" && r.location) map.get(r.unidad).location = r.location;
    }
    return Array.from(map.values()).sort((a, b) => a.unidad.localeCompare(b.unidad));
  }

  // Entrada principal: reservas CRUDAS (de parseArchivos) + config -> resultado.
  function computeIngresos(reservasCrudas, cfgOverride) {
    const cfg = Object.assign({}, CONFIG_DEFAULT, cfgOverride || {});
    cfg.mapeo = (cfgOverride && cfgOverride.mapeo) || {};
    const reservas = (reservasCrudas || []).map((r) => repartir(r, cfg));
    // Rentas fijas de larga estadia: se suman como una "reserva" mensual por
    // depto. Propio -> gana el 100%; comision -> gana el % y el resto al dueño.
    for (const f of cfg.rentasFijas || []) {
      if (f.activo === false) continue;
      const monto = Number(f.montoMensual) || 0;
      if (!monto) continue;
      let vos, dueno;
      if (f.tipo === "comision") {
        const pct = Number(f.comisionPct) || 0;
        vos = round2((monto * pct) / 100);
        dueno = round2(monto - vos);
      } else {
        vos = monto;
        dueno = 0;
      }
      reservas.push({
        plataforma: "larga",
        codigo: f.codigo || null,
        unidad: "Larga estadía",
        modalidad: f.tipo === "comision" ? "larga_comision" : "larga_propio",
        ingreso: monto,
        limpieza: 0,
        vos,
        dueno,
        costoLimpieza: 0,
        neto: vos,
        esFija: true,
      });
    }
    // Extras por extension de estadia (cobrados por fuera de las plataformas):
    // 100% ganancia de Esteban, sin dueño ni costo de limpieza. Se pasan ya
    // filtrados por mes.
    for (const e of cfg.extras || []) {
      const monto = Number(e.montoUsd) || 0;
      if (!monto) continue;
      reservas.push({
        plataforma: "extra",
        codigo: e.codigo || null,
        unidad: "Extensión",
        modalidad: "extension",
        ingreso: monto,
        limpieza: 0,
        vos: monto,
        dueno: 0,
        costoLimpieza: 0,
        neto: monto,
        esExtra: true,
      });
    }
    const grupos = agrupar(reservas);
    const totales = reservas.reduce(
      (a, r) => { a.ingreso += r.ingreso; a.vos += r.vos; a.dueno += r.dueno; a.costoLimpieza += r.costoLimpieza; a.neto += r.neto; return a; },
      { ingreso: 0, vos: 0, dueno: 0, costoLimpieza: 0, neto: 0, n: reservas.length }
    );
    totales.ingreso = round2(totales.ingreso);
    totales.vos = round2(totales.vos);
    totales.dueno = round2(totales.dueno);
    totales.costoLimpieza = round2(totales.costoLimpieza);
    totales.neto = round2(totales.neto);
    const sinAsociar = grupos.filter((g) => !g.asociado);
    return { reservas, grupos, totales, sinAsociar, unidades: unidadesDetectadas(reservasCrudas || []) };
  }

  const API = { parseArchivos, parseAirbnb, parseBooking, computeIngresos, repartir, agrupar, unidadesDetectadas, num, CONFIG_DEFAULT };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.IngresosEngine = API;
})(typeof self !== "undefined" ? self : this);
