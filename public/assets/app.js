// App Staybaires - vanilla JS, sin build. Habla con las Netlify Functions
// bajo /api/* (ver redirect en netlify.toml).

const API = "/api";
const ICONS = {
  hoy: "🏠", calendario: "📅", tareas: "✅", empleadas: "👥", pagos: "💵",
  insumos: "📦", lavanderia: "🧺", mispagos: "💵",
};
const TITLES = {
  hoy: "Hoy", calendario: "Calendario", tareas: "Tareas", empleadas: "Colaboradores",
  pagos: "Pagos", insumos: "Insumos", lavanderia: "Lavanderia", mispagos: "Mis pagos",
};
// Tipos de tarea que se cargan a mano (no vienen de los calendarios). Para
// sumar uno nuevo en el futuro, agregarlo a esta lista.
const TIPOS_MANUAL = ["Inspección", "Limpieza extra"];

let SESSION = safeParse(localStorage.getItem("sb-session"));
let CONFIG = null;
let CURRENT_TAB = null;
let CACHE = {};
// Estado del Calendario: vista "lista" (default) o "mes", mes visible y dia
// seleccionado en la vista mensual. La vista elegida se recuerda en el dispositivo.
let CALVIEW = localStorage.getItem("sb-calview") === "mes" ? "mes" : "lista";
let CALMONTH = null; // "YYYY-MM"
let CALSELDAY = null; // "YYYY-MM-DD"
// Estado de Pagos: rango de la liquidacion y sub-vista (liquidacion / ajustes).
let PAGOS_FROM = null;
let PAGOS_TO = null;
let PAGOS_VIEW = "liquidacion";
let FERIADOS_EDIT = [];

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text}`.trim());
  }
  return res.json();
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

function fmtDateHeader(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d); // construccion en hora local, evita el corrimiento de un dia por UTC
  return `${DIAS_SEMANA[dateObj.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

// Susana ademas de limpiar coordina: puede ver el calendario completo y
// decidir quien limpia cada depto, no solo Esteban (admin).
function canManageTasks() {
  return SESSION.role === "admin" || SESSION.employeeId === "susana";
}

function fmtMoney(n) {
  return "$" + Number(n || 0).toLocaleString("es-AR");
}

function platformBadge(platform) {
  const map = { airbnb: ["coral", "Airbnb"], booking: ["blue", "Booking"], vrbo: ["teal", "Vrbo"] };
  const [cls, label] = map[platform] || ["blue", platform || "?"];
  return `<span class="badge ${cls}">${label}</span>`;
}

// En el Calendario, verde = llegada del huesped, azul = salida (que es
// cuando hay que limpiar). Es un color por tipo de evento, no por plataforma.
function eventTypeBadge(type) {
  if (type === "checkin") return `<span class="badge green">Check-in</span>`;
  return `<span class="badge blue">Check-out</span>`;
}

function statusBadge(status) {
  if (status === "hecha") return `<span class="badge green">Hecha</span>`;
  if (status === "sin_asignar") return `<span class="badge red">Sin asignar</span>`;
  return `<span class="badge amber">Pendiente</span>`;
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

async function loadConfig() {
  if (!CONFIG) CONFIG = await fetchJSON(`${API}/config`);
  return CONFIG;
}

function employeeName(id) {
  const emp = (CONFIG.employees || []).find((e) => e.id === id);
  return emp ? emp.nombre : id;
}

// ---------- Login ----------

function loginEntryHTML(emp) {
  if (emp.requiresPassword) {
    return `
      <div class="login-entry" data-entry="${emp.id}">
        <div style="display:flex; gap:6px;">
          <input type="password" placeholder="Clave de ${emp.nombre}" data-pass-input="${emp.id}" style="flex:1; border:1px solid var(--border); border-radius:var(--radius); padding:8px 10px; font-size:14px;" />
          <button class="btn-primary" data-pass-submit="${emp.id}">Entrar</button>
        </div>
        <p class="card-sub" style="color:var(--red-fg); display:none;" data-pass-error="${emp.id}"></p>
      </div>`;
  }
  return `<button class="name-btn" data-login-direct="${emp.id}">${emp.nombre} <span>&rarr;</span></button>`;
}

function renderLogin() {
  const app = document.getElementById("app");
  const employees = CONFIG.employees || [];
  const admin = employees.find((e) => e.rol === "admin");
  const cleaners = employees.filter((e) => e.rol === "empleada").sort((a, b) => (a.id === "susana" ? -1 : 1));
  const lavanderia = employees.filter((e) => e.rol === "lavanderia");

  app.innerHTML = `
    <div class="login-wrap">
      <div class="brand">STAY<span class="blue">BAIRES</span></div>
      <p class="muted">Elegi con que perfil entras</p>

      ${admin ? `<div class="role-card"><h3>Admin</h3>${loginEntryHTML(admin)}</div>` : ""}
      <div class="role-card">
        <h3>Colaboradores de limpieza</h3>
        ${cleaners.map(loginEntryHTML).join("")}
      </div>
      ${lavanderia.length ? `<div class="role-card"><h3>Lavanderia</h3>${lavanderia.map(loginEntryHTML).join("")}</div>` : ""}
    </div>
  `;

  function afterAuth(emp, authData) {
    login({ role: authData.rol, employeeId: authData.employeeId, name: authData.nombre });
  }

  async function attemptAuth(emp, password) {
    try {
      const res = await fetchJSON(`${API}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.id, password: password || "" }),
      });
      afterAuth(emp, res);
    } catch (err) {
      const errEl = app.querySelector(`[data-pass-error="${emp.id}"]`);
      if (errEl) {
        errEl.textContent = "Clave incorrecta, proba de nuevo";
        errEl.style.display = "block";
      } else {
        toast("No se pudo entrar: " + err.message);
      }
    }
  }

  app.querySelectorAll("[data-login-direct]").forEach((btn) => {
    btn.onclick = () => {
      const emp = employees.find((e) => e.id === btn.getAttribute("data-login-direct"));
      attemptAuth(emp, "");
    };
  });

  app.querySelectorAll("[data-pass-submit]").forEach((btn) => {
    const id = btn.getAttribute("data-pass-submit");
    const emp = employees.find((e) => e.id === id);
    const input = app.querySelector(`[data-pass-input="${id}"]`);
    const submit = () => attemptAuth(emp, input.value);
    btn.onclick = submit;
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") submit();
    });
  });
}

function login(session) {
  SESSION = session;
  localStorage.setItem("sb-session", JSON.stringify(session));
  CURRENT_TAB = tabsForSession()[0];
  renderApp();
}

function logout() {
  SESSION = null;
  localStorage.removeItem("sb-session");
  render();
}

// ---------- App shell ----------

function tabsForSession() {
  const roleConf = CONFIG.roles[SESSION.role];
  const tabs = roleConf.tabs.slice();
  if (canManageTasks() && !tabs.includes("calendario")) tabs.unshift("calendario");
  // "Hoy" siempre primero, es la pantalla de inicio de todos los roles.
  if (tabs.includes("hoy")) {
    tabs.splice(tabs.indexOf("hoy"), 1);
    tabs.unshift("hoy");
  }
  return tabs;
}

function renderApp() {
  const app = document.getElementById("app");
  const roleConf = CONFIG.roles[SESSION.role];
  const tabs = tabsForSession();
  if (!tabs.includes(CURRENT_TAB)) CURRENT_TAB = tabs[0];

  app.innerHTML = `
    <div class="header">
      <div class="brand">STAY<span class="blue">BAIRES</span></div>
      <button class="who" data-logout>${SESSION.name} · ${roleConf.label} ⎋</button>
    </div>
    <div class="screen-title-bar">
      <h1 id="screen-title">${TITLES[CURRENT_TAB]}</h1>
      <span class="scope" id="scope-label"></span>
    </div>
    <main id="main"></main>
    <nav class="nav" id="bottom-nav"></nav>
  `;

  app.querySelector("[data-logout]").onclick = logout;
  renderNav(tabs);
  renderTab(CURRENT_TAB);
}

function renderNav(tabs) {
  const nav = document.getElementById("bottom-nav");
  nav.innerHTML = tabs
    .map((t) => `<button class="${t === CURRENT_TAB ? "active" : ""}" data-tab="${t}"><span class="icon">${ICONS[t]}</span>${TITLES[t]}</button>`)
    .join("");
  nav.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      CURRENT_TAB = btn.getAttribute("data-tab");
      document.getElementById("screen-title").textContent = TITLES[CURRENT_TAB];
      nav.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTab(CURRENT_TAB);
    };
  });
}

function setMain(html) {
  document.getElementById("main").innerHTML = html;
}
function setScope(text) {
  document.getElementById("scope-label").textContent = text;
}

function renderTab(tab) {
  // Hoy y Calendario usan su propio titular grande (estilo Airbnb), asi que
  // les ocultamos la barra de titulo generica del shell.
  const bar = document.querySelector(".screen-title-bar");
  if (bar) bar.style.display = tab === "hoy" || tab === "calendario" ? "none" : "";
  setMain(`<div class="empty-state">Cargando...</div>`);
  const handlers = {
    hoy: renderHoy,
    calendario: renderCalendario,
    tareas: renderTareas,
    empleadas: renderEmpleadas,
    pagos: renderPagos,
    mispagos: renderMisPagos,
    insumos: renderInsumos,
    lavanderia: renderLavanderia,
  };
  (handlers[tab] || (() => setMain("")))();
}

// ---------- Hoy (inicio) ----------

// Fecha de hoy en hora local (no UTC), para que "hoy" no se corra de dia
// a la noche en Argentina (UTC-3).
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function renderHoy() {
  try {
    const hoy = todayISO();
    setScope(fmtDateHeader(hoy));
    const manage = canManageTasks();

    // Lavanderia (Lujan): su inicio son sus pedidos pendientes.
    if (SESSION.role === "lavanderia") {
      const pedidos = await fetchJSON(`${API}/lavanderia`);
      const pend = pedidos.filter((p) => p.status !== "completado");
      setMain(`
        <p class="muted">Hola ${SESSION.name} · ${fmtDateHeader(hoy)}</p>
        <div class="stat" style="margin-bottom:12px;"><p class="label">Pedidos pendientes</p><p class="value ${pend.length ? "warn" : ""}">${pend.length}</p></div>
        ${
          pend.length === 0
            ? `<div class="empty-state">No tenes pedidos pendientes.</div>`
            : pend
                .map(
                  (p) => `
          <div class="card" style="margin-bottom:8px;">
            <div class="card-row">
              <div>
                <p class="card-title">${p.tipo === "retiro" ? "Retirar" : "Entregar"} · ${p.propertyName || "-"}</p>
                <p class="card-sub">${fmtDate(p.fecha)}</p>
              </div>
              <span class="badge amber">Pendiente</span>
            </div>
          </div>`
                )
                .join("")
        }
      `);
      return;
    }

    const payload = await getTasks();
    const { idx, urgentIds } = buildDayIndex(payload);
    const cleaners = (CONFIG.employees || []).filter((e) => e.rol === "empleada");
    const ctx = { puedeAsignar: manage, esAdmin: SESSION.role === "admin", cleaners, urgentIds };

    const limpiezasHoy = payload.tasks.filter((t) => t.date === hoy);
    const checkinsHoy = (payload.checkins || []).filter((c) => c.date === hoy);
    const misLimpiezas = manage ? limpiezasHoy : limpiezasHoy.filter((t) => t.assignedTo === SESSION.employeeId);

    // Progreso del dia: cuantas limpiezas ya estan hechas.
    const totalL = misLimpiezas.length;
    const hechasL = misLimpiezas.filter((t) => t.status === "hecha").length;
    const pct = totalL ? Math.round((hechasL / totalL) * 100) : 0;
    const headline = totalL === 0 ? "Hoy no hay limpiezas" : `${manage ? "Hoy tenés" : "Tenés"} ${totalL} limpieza${totalL !== 1 ? "s" : ""}`;
    const progresoHTML = totalL
      ? `<div class="ab-progress"><div class="h"><span>Progreso del día</span><span><b>${hechasL}</b> de ${totalL} hechas</span></div><div class="ab-track"><div class="ab-fill" style="width:${pct}%;"></div></div></div>`
      : "";

    let extras = "";
    if (manage) {
      const [insumos, pedidos] = await Promise.all([fetchJSON(`${API}/insumos`), fetchJSON(`${API}/lavanderia`)]);
      const bajos = insumos.filter((i) => i.stockActual < i.stockMinimo);
      const lavPend = pedidos.filter((p) => p.status !== "completado");
      extras = `
        <p class="ab-section">Resumen</p>
        <div class="stat-grid" style="margin-top:10px;">
          <div class="stat"><p class="label">Insumos bajos</p><p class="value ${bajos.length ? "warn" : ""}">${bajos.length}</p></div>
          <div class="stat"><p class="label">Lavanderia pendiente</p><p class="value">${lavPend.length}</p></div>
        </div>`;
    }

    setMain(`
      <div class="ab-greeting">Hola ${SESSION.name} · ${fmtDateHeader(hoy)}</div>
      <h1 class="ab-headline">${headline}</h1>
      ${progresoHTML}
      ${totalL === 0 ? "" : misLimpiezas.map((t) => eventCardHTML(t, ctx)).join("")}
      ${
        manage
          ? `<p class="ab-section">Check-ins de hoy</p>
        ${checkinsHoy.length === 0 ? `<div class="empty-state">No hay llegadas hoy.</div>` : checkinsHoy.map((c) => eventCardHTML(c, ctx)).join("")}`
          : ""
      }
      ${extras}
    `);

    attachCardHandlers(renderHoy);
  } catch (err) {
    setMain(`<div class="empty-state">Error cargando el inicio: ${err.message}</div>`);
  }
}

// ---------- Calendario ----------

async function getTasks(force) {
  if (!CACHE.tasksPayload || force) {
    CACHE.tasksPayload = await fetchJSON(`${API}/tasks${force ? "?refresh=1" : ""}`);
  }
  return CACHE.tasksPayload;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function isoPlusDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Lunes de la semana a la que pertenece una fecha (semana arranca lunes).
function mondayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // lunes = 0
  dt.setDate(dt.getDate() - dow);
  return dt;
}

// Numero de semana ISO 8601 (la semana 1 es la que contiene el primer jueves
// del anio). Sirve para el encabezado "Semana NN" en la lista.
function isoWeekNum(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow + 3); // jueves de esta semana
  const primerJueves = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const pjDow = (primerJueves.getUTCDay() + 6) % 7;
  primerJueves.setUTCDate(primerJueves.getUTCDate() - pjDow + 3);
  return 1 + Math.round((dt - primerJueves) / (7 * 24 * 3600 * 1000));
}

function fmtDayMonth(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}

function addMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

// Indexa checkouts (limpiezas) y checkins por fecha, y marca como "urgente"
// los checkouts que tienen ademas un checkin ese mismo dia en el mismo depto
// (sale un huesped y entra otro: hay que limpiar con prioridad).
function buildDayIndex(payload) {
  const idx = new Map();
  const get = (d) => {
    if (!idx.has(d)) idx.set(d, { outs: [], ins: [] });
    return idx.get(d);
  };
  for (const t of payload.tasks) get(t.date).outs.push(t);
  for (const c of payload.checkins || []) get(c.date).ins.push(c);
  const urgentIds = new Set();
  for (const [, info] of idx) {
    const inCodes = new Set(info.ins.map((c) => c.propertyCode));
    for (const t of info.outs) if (inCodes.has(t.propertyCode)) urgentIds.add(t.id);
  }
  return { idx, urgentIds };
}

function firstEventDayOfMonth(idx, ym) {
  const dias = Array.from(idx.keys())
    .filter((d) => d.startsWith(ym))
    .sort();
  return dias[0] || null;
}

// Formulario (modal) para crear una tarea manual. Solo lo abre el admin.
// `onCreated` se llama despues de crear, para redibujar la pantalla actual.
function openNuevaTareaForm(onCreated) {
  const props = CONFIG.properties || [];
  const cleaners = (CONFIG.employees || []).filter((e) => e.rol === "empleada");
  const hoy = todayISO();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>Nueva tarea</h3>
      <label>Tipo</label>
      <select id="nt-tipo">${TIPOS_MANUAL.map((t) => `<option>${t}</option>`).join("")}</select>
      <label>Fecha</label>
      <input type="date" id="nt-date" value="${hoy}" />
      <label>Propiedad</label>
      <select id="nt-prop">${props.map((p) => `<option value="${p.codigo}">${p.nombre} — ${p.direccion || p.barrio}</option>`).join("")}</select>
      <label>Asignar a</label>
      <select id="nt-asig">${cleaners.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join("")}</select>
      <label>Valor / pago</label>
      <input type="number" id="nt-valor" inputmode="numeric" placeholder="0" />
      <label>Nota (opcional)</label>
      <input type="text" id="nt-nota" placeholder="Ej: revisar aire acondicionado" />
      <div class="modal-actions">
        <button class="btn-secondary" id="nt-cancel">Cancelar</button>
        <button class="btn-primary" id="nt-save">Crear</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.querySelector("#nt-cancel").onclick = close;
  overlay.querySelector("#nt-save").onclick = async () => {
    const body = {
      tipo: overlay.querySelector("#nt-tipo").value,
      date: overlay.querySelector("#nt-date").value,
      propertyCode: overlay.querySelector("#nt-prop").value,
      assignedTo: overlay.querySelector("#nt-asig").value,
      valor: Number(overlay.querySelector("#nt-valor").value) || 0,
      notes: overlay.querySelector("#nt-nota").value.trim() || null,
    };
    if (!body.date) return toast("Elegí una fecha");
    try {
      await fetchJSON(`${API}/manual-tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      CACHE.tasksPayload = null;
      close();
      toast("Tarea creada");
      onCreated();
    } catch (err) {
      toast("No se pudo crear: " + err.message);
    }
  };
}

function platformName(p) {
  return { airbnb: "Airbnb", booking: "Booking", vrbo: "Vrbo" }[p] || p || "";
}
// Color del avatar segun la colaboradora (fondo claro + texto del mismo tono).
function avatarColors(id) {
  return { susana: ["#e8e4fb", "#534ab7"], mari: ["#e1f5ee", "#0f6e56"], random: ["#faeeda", "#854f0b"] }[id] || ["#eef2f6", "#5b6472"];
}

// Tarjeta de un evento (checkout, checkin o tarea manual), estilo lista.
// Compartida por Hoy, la lista del calendario y el detalle mensual. El card
// es clickeable para marcar que ya se hizo (checkout/manual usan "status";
// checkin usa "done").
function eventCardHTML(t, ctx) {
  const isCheckin = t.type === "checkin";
  const isManual = t.source === "manual";
  const asignable = !isCheckin;
  const urgent = !isCheckin && !isManual && ctx.urgentIds.has(t.id);
  const done = isCheckin ? t.done === true : t.status === "hecha";
  const titulo = t.direccion || t.propertyName;
  const cleaner = employeeName(t.assignedTo);

  const sub = isCheckin
    ? `Llega huésped · ${platformName(t.platform)}`
    : `${t.propertyName}${isManual && t.notes ? ` · ${t.notes}` : ""} · ${cleaner}`;

  let statusCls, statusTxt;
  if (done) [statusCls, statusTxt] = ["green", "✓ Hecho"];
  else if (isManual) [statusCls, statusTxt] = ["violet", t.tipo];
  else if (isCheckin) [statusCls, statusTxt] = ["green", "Check-in"];
  else if (urgent) [statusCls, statusTxt] = ["red", "Check-out/in · entra hoy"];
  else [statusCls, statusTxt] = ["blue", "Check-out"];

  const [abg, afg] = avatarColors(t.assignedTo);
  const media = isCheckin
    ? `<div class="ev-media"><div class="ev-thumb">🏠</div></div>`
    : `<div class="ev-media"><div class="ev-avatar" style="background:${abg}; color:${afg};">${(cleaner || "?").charAt(0)}</div><div class="ev-thumb mini">🏠</div></div>`;

  return `
    <div class="ev-card cal-card${done ? " done" : ""}" data-cal-card="${t.id}" data-cal-type="${isCheckin ? "checkin" : "checkout"}" data-cal-done="${done ? "1" : "0"}">
      <div class="ev-main">
        <div class="ev-title">${titulo}</div>
        <div class="ev-sub">${sub}</div>
        <div class="ev-status ${statusCls}">${statusTxt}</div>
        ${
          asignable && ctx.puedeAsignar
            ? `<div class="ev-reassign">
                <select class="badge-select" data-reassign-cal="${t.id}">
                  ${ctx.cleaners.map((c) => `<option value="${c.id}" ${c.id === t.assignedTo ? "selected" : ""}>${c.nombre}</option>`).join("")}
                </select>
                ${isManual && ctx.esAdmin ? `<button class="link-danger" data-del-manual="${t.id}">Eliminar</button>` : ""}
              </div>`
            : ""
        }
      </div>
      ${media}
    </div>`;
}

function calListaHTML(payload, ctx) {
  const today = todayISO();
  const hasta = isoPlusDays(today, 45);
  const combinado = [...payload.tasks, ...(payload.checkins || [])].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === "checkin" ? -1 : 1)
  );
  const upcoming = combinado.filter((t) => t.date >= today && t.date <= hasta);
  if (upcoming.length === 0) return `<div class="empty-state">No hay check-ins ni check-outs en los proximos 45 dias.</div>`;

  // Dos niveles: encabezado de semana del anio (lunes a domingo) y, dentro,
  // encabezado por dia con sus tarjetas.
  let html = "";
  let semanaActual = null;
  let diaActual = null;
  for (const t of upcoming) {
    const lunes = mondayOf(t.date);
    const claveSemana = toISO(lunes);
    if (claveSemana !== semanaActual) {
      semanaActual = claveSemana;
      diaActual = null;
      const domingo = new Date(lunes);
      domingo.setDate(domingo.getDate() + 6);
      html += `<p class="ab-week">Semana ${isoWeekNum(t.date)} · ${fmtDayMonth(lunes)} al ${fmtDayMonth(domingo)}</p>`;
    }
    if (t.date !== diaActual) {
      diaActual = t.date;
      html += `<p class="ab-day ${t.date === today ? "today" : ""}">${t.date === today ? "Hoy · " : ""}${fmtDateHeader(t.date)}</p>`;
    }
    html += eventCardHTML(t, ctx);
  }
  return html;
}

function calMesHTML(idx, ctx) {
  const today = todayISO();
  if (!CALMONTH) CALMONTH = today.slice(0, 7);
  if (!CALSELDAY || CALSELDAY.slice(0, 7) !== CALMONTH) {
    CALSELDAY = today.slice(0, 7) === CALMONTH ? today : firstEventDayOfMonth(idx, CALMONTH) || `${CALMONTH}-01`;
  }

  const [Y, M] = CALMONTH.split("-").map(Number);
  const startCol = (new Date(Y, M - 1, 1).getDay() + 6) % 7; // lunes = 0
  const diasMes = new Date(Y, M, 0).getDate();
  const diasPrev = new Date(Y, M - 1, 0).getDate();

  const cells = [];
  for (let i = startCol - 1; i >= 0; i--) cells.push({ day: diasPrev - i, iso: null });
  for (let d = 1; d <= diasMes; d++) cells.push({ day: d, iso: `${CALMONTH}-${String(d).padStart(2, "0")}` });
  let nd = 1;
  while (cells.length % 7 !== 0) cells.push({ day: nd++, iso: null });

  const wk = ["L", "M", "M", "J", "V", "S", "D"].map((w) => `<span>${w}</span>`).join("");
  const grid = cells
    .map((c) => {
      if (!c.iso) return `<div class="cal-cell mut">${c.day}</div>`;
      const info = idx.get(c.iso) || { outs: [], ins: [] };
      const urgent = info.outs.some((t) => ctx.urgentIds.has(t.id));
      let dot = "";
      if (urgent) dot = `<span class="cal-dot red">!</span>`;
      else if (info.outs.length) dot = `<span class="cal-dot blue">${info.outs.length}</span>`;
      else if (info.ins.length) dot = `<span class="cal-dot green">${info.ins.length}</span>`;
      const cls = ["cal-cell"];
      if (c.iso === today) cls.push("today");
      if (c.iso === CALSELDAY) cls.push("sel");
      return `<div class="${cls.join(" ")}" data-calday="${c.iso}">${c.day}${dot}</div>`;
    })
    .join("");

  const info = idx.get(CALSELDAY) || { outs: [], ins: [] };
  const nOuts = info.outs.length;
  const detalle =
    info.outs.length || info.ins.length
      ? [...info.outs, ...info.ins].map((t) => eventCardHTML(t, ctx)).join("")
      : `<div class="empty-state">Sin check-ins ni check-outs ese dia.</div>`;

  return `
    <div class="cal-monthnav">
      <button data-calnav="prev" aria-label="Mes anterior">‹</button>
      <span>${monthLabel(CALMONTH)}</span>
      <button data-calnav="next" aria-label="Mes siguiente">›</button>
    </div>
    <div class="cal-weekhead">${wk}</div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-legend">
      <span><i class="blue"></i>Check-out</span>
      <span><i class="green"></i>Check-in</span>
      <span><i class="red"></i>Check-out/in</span>
    </div>
    <p class="ab-day" style="margin-top:16px;">${fmtDateHeader(CALSELDAY)}${nOuts ? ` · ${nOuts} limpieza${nOuts > 1 ? "s" : ""}` : ""}</p>
    ${detalle}`;
}

async function renderCalendario() {
  try {
    const payload = await getTasks();
    setScope(`${(CONFIG.properties || []).length} propiedades`);
    const cleaners = (CONFIG.employees || []).filter((e) => e.rol === "empleada");
    const { idx, urgentIds } = buildDayIndex(payload);
    const ctx = { puedeAsignar: canManageTasks(), esAdmin: SESSION.role === "admin", cleaners, urgentIds };

    const syncInfo = payload.lastSync ? `Ultimo sync: ${new Date(payload.lastSync).toLocaleString("es-AR")}` : "Todavia no sincronizo";

    const errores = payload.syncErrors && payload.syncErrors.length ? payload.syncErrors : [];
    const erroresHTML = errores.length
      ? `<div class="card" style="border-color:var(--red-fg); margin-bottom:10px;">
          <p class="card-sub" style="color:var(--red-fg); margin:0 0 6px;">Hubo problemas leyendo ${errores.length} calendario(s):</p>
          ${errores
            .map((e) => {
              const prop = (CONFIG.properties || []).find((p) => p.codigo === e.codigo);
              return `<p class="card-sub" style="margin:2px 0;">${prop ? prop.nombre : e.codigo}: ${e.errors.join(", ")}</p>`;
            })
            .join("")}
        </div>`
      : "";

    const body = CALVIEW === "mes" ? calMesHTML(idx, ctx) : calListaHTML(payload, ctx);

    setMain(`
      <div class="ab-toolbar">
        <div class="ab-toggle">
          <button class="${CALVIEW === "lista" ? "on" : ""}" data-calview="lista">Lista</button>
          <button class="${CALVIEW === "mes" ? "on" : ""}" data-calview="mes">Mes</button>
        </div>
        <button class="ab-iconbtn" data-refresh aria-label="Actualizar">⟳</button>
      </div>
      <h1 class="ab-headline">Calendario</h1>
      <div class="ab-sub">${syncInfo} · sync automático diario</div>
      ${SESSION.role === "admin" ? `<div style="margin:14px 0 4px;"><button class="btn-primary" data-nueva-tarea>+ Nueva tarea</button></div>` : ""}
      ${erroresHTML}
      ${body}
    `);

    if (SESSION.role === "admin") {
      document.querySelector("[data-nueva-tarea]").onclick = () => openNuevaTareaForm(renderCalendario);
    }

    document.querySelector("[data-refresh]").onclick = async () => {
      setMain(`<div class="empty-state">Sincronizando calendarios...</div>`);
      try {
        await getTasks(true);
        toast("Calendarios actualizados");
      } catch (err) {
        toast("No se pudo sincronizar: " + err.message);
      }
      renderCalendario();
    };

    document.querySelectorAll("[data-calview]").forEach((btn) => {
      btn.onclick = () => {
        CALVIEW = btn.getAttribute("data-calview");
        localStorage.setItem("sb-calview", CALVIEW);
        renderCalendario();
      };
    });

    document.querySelectorAll("[data-calnav]").forEach((btn) => {
      btn.onclick = () => {
        CALMONTH = addMonth(CALMONTH || todayISO().slice(0, 7), btn.getAttribute("data-calnav") === "prev" ? -1 : 1);
        CALSELDAY = null;
        renderCalendario();
      };
    });

    document.querySelectorAll("[data-calday]").forEach((cell) => {
      cell.onclick = () => {
        CALSELDAY = cell.getAttribute("data-calday");
        renderCalendario();
      };
    });

    attachCardHandlers(renderCalendario);
  } catch (err) {
    setMain(`<div class="empty-state">Error cargando el calendario: ${err.message}</div>`);
  }
}

// Conecta los handlers de las tarjetas de eventos (reasignar y marcar
// hecho/pendiente). Lo usan el Calendario y la pantalla Hoy, que comparten
// eventCardHTML. `rerender` es la funcion que redibuja la pantalla actual.
function attachCardHandlers(rerender) {
  document.querySelectorAll("[data-reassign-cal]").forEach((sel) => {
    sel.onchange = async () => {
      const id = sel.getAttribute("data-reassign-cal");
      await fetchJSON(`${API}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, assignedTo: sel.value }),
      });
      CACHE.tasksPayload = null;
      toast("Asignado a " + employeeName(sel.value));
      rerender();
    };
  });

  // Eliminar una tarea manual (solo boton "Eliminar", solo admin).
  document.querySelectorAll("[data-del-manual]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-del-manual");
      if (!confirm("¿Eliminar esta tarea?")) return;
      try {
        await fetchJSON(`${API}/manual-tasks`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        CACHE.tasksPayload = null;
        toast("Tarea eliminada");
        rerender();
      } catch (err) {
        toast("No se pudo eliminar: " + err.message);
      }
    };
  });

  // Tocar el card marca (o desmarca) que ese check ya se hizo. No dispara
  // cuando el toque fue sobre el selector de reasignacion ni el boton borrar.
  document.querySelectorAll("[data-cal-card]").forEach((card) => {
    card.addEventListener("click", async (e) => {
      if (e.target.closest("select") || e.target.closest("[data-del-manual]")) return;
      const id = card.getAttribute("data-cal-card");
      const esCheckout = card.getAttribute("data-cal-type") === "checkout";
      const done = card.getAttribute("data-cal-done") === "1";
      const body = esCheckout ? { id, status: done ? "pendiente" : "hecha" } : { id, done: !done };
      try {
        await fetchJSON(`${API}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        CACHE.tasksPayload = null;
        toast(done ? "Marcado como pendiente" : "Marcado como hecho");
        rerender();
      } catch (err) {
        toast("No se pudo actualizar: " + err.message);
      }
    });
  });
}

// ---------- Tareas ----------

async function renderTareas() {
  try {
    const payload = await getTasks();
    let tasks = payload.tasks;
    if (!canManageTasks()) {
      tasks = tasks.filter((t) => t.assignedTo === SESSION.employeeId);
      setScope(`Tus tareas`);
    } else {
      setScope(`${tasks.length} tareas`);
    }

    const cleaners = (CONFIG.employees || []).filter((e) => e.rol === "empleada");

    setMain(`
      ${SESSION.role === "admin" ? `<div class="refresh-row"><button class="btn-primary" data-nueva-tarea>+ Nueva tarea</button></div>` : ""}
      ${canManageTasks() ? `<p class="muted">Todas las tareas quedan asignadas a Susana por defecto. Reasigná a Mari o Gisel cuando corresponda.</p>` : ""}
      ${
        tasks.length === 0
          ? `<div class="empty-state">No hay tareas todavia.</div>`
          : tasks
              .map((t) => {
                const assignedLabel = employeeName(t.assignedTo);
                return `
        <div class="card" data-task="${t.id}">
          <div class="card-row">
            <div>
              <p class="card-title">${t.direccion || t.propertyName}</p>
              <p class="card-sub">${t.direccion ? t.propertyName : t.barrio}</p>
              <p class="card-sub">${assignedLabel} · ${fmtDate(t.date)}${t.source === "manual" ? ` · ${t.tipo}` : ""}</p>
            </div>
            ${t.source === "manual" && t.status !== "hecha" ? `<span class="badge violet">${t.tipo}</span>` : statusBadge(t.status)}
          </div>
          <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
            ${
              t.status !== "hecha"
                ? `<button class="btn-secondary" data-mark-done="${t.id}">Marcar hecha</button>`
                : ""
            }
            ${
              canManageTasks()
                ? `<select class="badge-select" data-reassign="${t.id}">
                    ${cleaners.map((c) => `<option value="${c.id}" ${c.id === t.assignedTo ? "selected" : ""}>${c.nombre}</option>`).join("")}
                  </select>`
                : ""
            }
          </div>
        </div>`;
              })
              .join("")
      }
    `);

    if (SESSION.role === "admin") {
      document.querySelector("[data-nueva-tarea]").onclick = () => openNuevaTareaForm(renderTareas);
    }

    document.querySelectorAll("[data-mark-done]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-mark-done");
        const body = { id, status: "hecha" };
        await fetchJSON(`${API}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        CACHE.tasksPayload = null;
        toast("Tarea marcada como hecha");
        renderTareas();
      };
    });

    document.querySelectorAll("[data-reassign]").forEach((sel) => {
      sel.onchange = async () => {
        const id = sel.getAttribute("data-reassign");
        await fetchJSON(`${API}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, assignedTo: sel.value }),
        });
        CACHE.tasksPayload = null;
        toast("Reasignado a " + employeeName(sel.value));
        renderTareas();
      };
    });
  } catch (err) {
    setMain(`<div class="empty-state">Error cargando tareas: ${err.message}</div>`);
  }
}

// ---------- Empleadas ----------

async function renderEmpleadas() {
  try {
    const desde = todayISO().slice(0, 8) + "01";
    const paymentsData = await fetchJSON(`${API}/payments?from=${desde}&to=${todayISO()}`);
    setScope(`${CONFIG.employees.length} personas`);
    const jerarquiaLabel = { principal: "Principal", secundaria: "Secundaria", rotativa: "Rotativa" };
    const jerarquiaBadge = { principal: "blue", secundaria: "teal", rotativa: "amber" };

    const cleaners = CONFIG.employees.filter((e) => e.rol === "empleada");
    const lavanderia = CONFIG.employees.filter((e) => e.rol === "lavanderia");
    const summaryFor = (id) => paymentsData.summary.find((s) => s.employeeId === id);

    setMain(`
      <p class="muted">Días trabajados y total de este mes</p>
      ${cleaners
        .map((e) => {
          const s = summaryFor(e.id);
          return `
        <div class="card">
          <div class="card-row">
            <div>
              <p class="card-title">${e.nombre}</p>
              <p class="card-sub">Limpieza · $${e.tarifaPorDia?.toLocaleString("es-AR") || "-"}/dia base</p>
            </div>
            <span class="badge ${jerarquiaBadge[e.jerarquia] || "blue"}">${jerarquiaLabel[e.jerarquia] || ""}</span>
          </div>
          <p class="card-sub" style="margin-top:8px;">${s ? `${s.totalDias} días trabajados · ${fmtMoney(s.total)}` : "Sin datos todavia"}</p>
        </div>`;
        })
        .join("")}
      ${lavanderia
        .map(
          (e) => `
        <div class="card">
          <div class="card-row">
            <div>
              <p class="card-title">${e.nombre}</p>
              <p class="card-sub">Lavanderia · por transferencia</p>
            </div>
          </div>
        </div>`
        )
        .join("")}
    `);
  } catch (err) {
    setMain(`<div class="empty-state">Error: ${err.message}</div>`);
  }
}

// ---------- Pagos / Liquidacion (admin) ----------

function payRow(label, monto) {
  return `<div class="pay-row"><span>${label}</span><span>${fmtMoney(monto)}</span></div>`;
}

// Solo la calle (lo que va antes de la primera coma de la direccion).
function calleDepto(d) {
  return (d.direccion ? d.direccion.split(",")[0].trim() : "") || d.nombre || "Depto";
}
// Nombre de la tarea + departamento: "Inspección · Avenida Corrientes 2164"
// (las limpiezas de check-out no tienen tipo, van como "Limpieza").
function deptoLabel(d) {
  return `${d.tipo || "Limpieza"} · ${calleDepto(d)}`;
}
function esItemSuper(concepto) {
  return /super/i.test(concepto);
}
function payItemRow(it) {
  return `<div class="pay-row"><span>${it.concepto} <button class="link-danger" data-del-item="${it.id}" style="padding:0 4px;">✕</button></span><span>${fmtMoney(it.monto)}</span></div>`;
}

// Orden del detalle: (A) cada depto (tarea + calle) + valor (limpiezas e
// inspecciones; el precio de las manuales se puede editar), (B) extras (plus +
// items que no son supermercado), (C) supermercado, (D) viaticos, y el total.
function payCardHTML(s) {
  const rows = [];
  for (const d of s.deptosDetalle) {
    if (d.manual) {
      rows.push(
        `<div class="pay-row"><span>${deptoLabel(d)}</span><span>${fmtMoney(d.monto)} <button class="link-edit" data-edit-valor="${d.id}" data-valor="${d.monto}">✎</button></span></div>`
      );
    } else {
      rows.push(payRow(deptoLabel(d), d.monto));
    }
  }
  if (s.plusDomingo) rows.push(payRow(`Plus domingo (${s.domingos})`, s.plusDomingo));
  if (s.plusFeriado) rows.push(payRow(`Plus feriado (${s.feriados})`, s.plusFeriado));
  for (const it of s.items) if (!esItemSuper(it.concepto)) rows.push(payItemRow(it));
  for (const it of s.items) if (esItemSuper(it.concepto)) rows.push(payItemRow(it));
  if (s.totalDias) rows.push(payRow(`Viático: ${s.totalDias} día${s.totalDias !== 1 ? "s" : ""} × ${fmtMoney(s.viaticoDia)}`, s.viatico));
  return `
    <div class="card">
      <div class="card-row"><span class="card-title">${s.nombre}</span><span class="card-title">${fmtMoney(s.total)}</span></div>
      <div class="pay-breakdown">${rows.join("") || `<div class="pay-row"><span>Sin actividad</span><span>${fmtMoney(0)}</span></div>`}</div>
      <div class="pay-actions">
        <button class="btn-secondary" data-add-item="${s.employeeId}">+ Agregar ítem</button>
        <button class="btn-primary" data-wa="${s.employeeId}">Enviar por WhatsApp</button>
      </div>
    </div>`;
}

function buildWaMessage(s, from, to) {
  const L = [`*Liquidación ${s.nombre}* — ${fmtDate(from)} al ${fmtDate(to)}`];
  for (const d of s.deptosDetalle) L.push(`${deptoLabel(d)}: ${fmtMoney(d.monto)}`);
  if (s.plusDomingo) L.push(`Plus domingo (${s.domingos}): ${fmtMoney(s.plusDomingo)}`);
  if (s.plusFeriado) L.push(`Plus feriado (${s.feriados}): ${fmtMoney(s.plusFeriado)}`);
  for (const it of s.items) if (!esItemSuper(it.concepto)) L.push(`${it.concepto}: ${fmtMoney(it.monto)}`);
  for (const it of s.items) if (esItemSuper(it.concepto)) L.push(`${it.concepto}: ${fmtMoney(it.monto)}`);
  if (s.totalDias) L.push(`Viático: ${s.totalDias} día${s.totalDias !== 1 ? "s" : ""} × ${fmtMoney(s.viaticoDia)} = ${fmtMoney(s.viatico)}`);
  L.push("");
  L.push(`*TOTAL: ${fmtMoney(s.total)}*`);
  return L.join("\n");
}

// Editar el precio de una tarea manual desde la liquidacion.
function openEditValorForm(id, actual, onDone) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar precio</h3>
      <label>Valor / pago</label>
      <input type="number" id="ev-valor" inputmode="numeric" value="${actual}" />
      <div class="modal-actions">
        <button class="btn-secondary" id="ev-cancel">Cancelar</button>
        <button class="btn-primary" id="ev-save">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.querySelector("#ev-cancel").onclick = close;
  overlay.querySelector("#ev-save").onclick = async () => {
    const valor = Number(overlay.querySelector("#ev-valor").value) || 0;
    try {
      await fetchJSON(`${API}/manual-tasks`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, valor }) });
      CACHE.tasksPayload = null;
      close();
      toast("Precio actualizado");
      onDone();
    } catch (err) {
      toast("No se pudo actualizar: " + err.message);
    }
  };
}

function openItemForm(employeeId, onDone) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const conceptos = ["Reembolso supermercado", "Artículos de limpieza", "Plus muy sucio", "Viático extra", "Otro"];
  overlay.innerHTML = `
    <div class="modal">
      <h3>Agregar ítem</h3>
      <label>Concepto</label>
      <select id="it-concepto">${conceptos.map((c) => `<option>${c}</option>`).join("")}</select>
      <label>Detalle (opcional)</label>
      <input type="text" id="it-detalle" placeholder="Ej: Migueletes 1268" />
      <label>Monto</label>
      <input type="number" id="it-monto" inputmode="numeric" placeholder="0" />
      <label>Fecha</label>
      <input type="date" id="it-date" value="${PAGOS_TO || todayISO()}" />
      <div class="modal-actions">
        <button class="btn-secondary" id="it-cancel">Cancelar</button>
        <button class="btn-primary" id="it-save">Agregar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.querySelector("#it-cancel").onclick = close;
  overlay.querySelector("#it-save").onclick = async () => {
    const base = overlay.querySelector("#it-concepto").value;
    const det = overlay.querySelector("#it-detalle").value.trim();
    const monto = Number(overlay.querySelector("#it-monto").value);
    const date = overlay.querySelector("#it-date").value;
    if (!monto || !date) return toast("Completá monto y fecha");
    const concepto = det ? `${base} (${det})` : base;
    try {
      await fetchJSON(`${API}/pay-items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, date, concepto, monto }) });
      close();
      toast("Ítem agregado");
      onDone();
    } catch (err) {
      toast("No se pudo agregar: " + err.message);
    }
  };
}

async function renderPagos() {
  if (PAGOS_VIEW === "ajustes") return renderPagosAjustes();
  try {
    const hoy = todayISO();
    // Por defecto se abre en el pago del dia (Esteban paga por dia en general).
    if (!PAGOS_FROM) {
      PAGOS_FROM = hoy;
      PAGOS_TO = hoy;
    }
    setScope("Liquidación");
    const data = await fetchJSON(`${API}/payments?from=${PAGOS_FROM}&to=${PAGOS_TO}`);
    const config = data.config || {};

    const rangoSemana = PAGOS_FROM === toISO(mondayOf(hoy)) && PAGOS_TO === hoy;
    const rangoMes = PAGOS_FROM === hoy.slice(0, 8) + "01" && PAGOS_TO === hoy;
    const rangoHoy = PAGOS_FROM === hoy && PAGOS_TO === hoy;

    setMain(`
      <div class="pay-presets">
        <button class="btn-secondary ${rangoHoy ? "on" : ""}" data-preset="hoy">Hoy</button>
        <button class="btn-secondary ${rangoSemana ? "on" : ""}" data-preset="semana">Esta semana</button>
        <button class="btn-secondary ${rangoMes ? "on" : ""}" data-preset="mes">Este mes</button>
        <button class="btn-secondary" data-ajustes>⚙ Ajustes</button>
      </div>
      <div class="pay-dates">
        <label>Desde<input type="date" id="pg-from" value="${PAGOS_FROM}" /></label>
        <label>Hasta<input type="date" id="pg-to" value="${PAGOS_TO}" /></label>
      </div>
      ${data.summary.every((s) => s.total === 0) ? `<p class="muted">No hay tareas hechas en este rango. Las tareas se pagan cuando están marcadas como hechas.</p>` : ""}
      ${data.summary.map(payCardHTML).join("")}
    `);

    const setRange = (f, t) => {
      PAGOS_FROM = f;
      PAGOS_TO = t;
      renderPagos();
    };
    document.getElementById("pg-from").onchange = (e) => setRange(e.target.value, PAGOS_TO);
    document.getElementById("pg-to").onchange = (e) => setRange(PAGOS_FROM, e.target.value);
    document.querySelector('[data-preset="hoy"]').onclick = () => setRange(hoy, hoy);
    document.querySelector('[data-preset="semana"]').onclick = () => setRange(toISO(mondayOf(hoy)), hoy);
    document.querySelector('[data-preset="mes"]').onclick = () => setRange(hoy.slice(0, 8) + "01", hoy);
    document.querySelector("[data-ajustes]").onclick = () => { PAGOS_VIEW = "ajustes"; renderPagos(); };

    document.querySelectorAll("[data-add-item]").forEach((btn) => {
      btn.onclick = () => openItemForm(btn.getAttribute("data-add-item"), renderPagos);
    });
    document.querySelectorAll("[data-del-item]").forEach((btn) => {
      btn.onclick = async () => {
        await fetchJSON(`${API}/pay-items`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: btn.getAttribute("data-del-item") }) });
        toast("Ítem eliminado");
        renderPagos();
      };
    });
    document.querySelectorAll("[data-edit-valor]").forEach((btn) => {
      btn.onclick = () => openEditValorForm(btn.getAttribute("data-edit-valor"), Number(btn.getAttribute("data-valor")), renderPagos);
    });
    document.querySelectorAll("[data-wa]").forEach((btn) => {
      btn.onclick = () => {
        const s = data.summary.find((x) => x.employeeId === btn.getAttribute("data-wa"));
        const tel = (config.telefonos && config.telefonos[s.employeeId] || "").replace(/\D/g, "");
        const msg = buildWaMessage(s, PAGOS_FROM, PAGOS_TO);
        if (!tel) {
          toast("Cargá el teléfono de " + s.nombre + " en Ajustes");
          return;
        }
        window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, "_blank");
      };
    });
  } catch (err) {
    setMain(`<div class="empty-state">Error: ${err.message}</div>`);
  }
}

async function renderPagosAjustes() {
  try {
    setScope("Ajustes de pago");
    const cfg = await fetchJSON(`${API}/pay-config`);
    FERIADOS_EDIT = [...(cfg.feriados || [])];
    const cleaners = CONFIG.employees.filter((e) => e.rol === "empleada");
    const props = CONFIG.properties || [];

    const render = () => {
      setMain(`
        <div class="refresh-row"><button class="btn-secondary" data-volver>‹ Volver</button></div>

        <p class="section-label">Viático por día (por colaboradora)</p>
        <div class="card">
          ${cleaners
            .map(
              (e) => `<label class="aj-label">${e.nombre}</label>
              <input type="number" data-viatico="${e.id}" value="${cfg.viaticoDia && cfg.viaticoDia[e.id] != null ? cfg.viaticoDia[e.id] : e.tarifaPorDia || 0}" />`
            )
            .join("")}
        </div>

        <p class="section-label">Plus</p>
        <div class="card">
          <label class="aj-label">Plus por domingo</label>
          <input type="number" id="aj-domingo" value="${cfg.plusDomingo || 0}" />
          <label class="aj-label">Plus por feriado</label>
          <input type="number" id="aj-feriado" value="${cfg.plusFeriado || 0}" />
        </div>

        <p class="section-label">Teléfono para WhatsApp</p>
        <div class="card">
          ${cleaners
            .map(
              (e) => `<label class="aj-label">${e.nombre}</label>
              <input type="tel" data-tel="${e.id}" value="${(cfg.telefonos && cfg.telefonos[e.id]) || ""}" placeholder="Ej: 5491130171397" />`
            )
            .join("")}
        </div>

        <p class="section-label">Feriados</p>
        <div class="card">
          <div class="chips">${FERIADOS_EDIT.map((f) => `<span class="chip">${fmtDate(f)} <button data-del-feriado="${f}">✕</button></span>`).join("") || `<span class="card-sub">Ninguno cargado</span>`}</div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <input type="date" id="aj-feriado-nuevo" style="flex:1;" />
            <button class="btn-secondary" data-add-feriado>Agregar</button>
          </div>
        </div>

        <p class="section-label">Valor de limpieza por depto</p>
        <div class="card">
          ${props
            .map(
              (p) => `<label class="aj-label">${p.nombre} — ${p.direccion || p.barrio}</label>
              <input type="number" data-depto="${p.codigo}" value="${(cfg.valorDepto && cfg.valorDepto[p.codigo]) || 0}" />`
            )
            .join("")}
        </div>

        <div class="refresh-row"><button class="btn-primary" data-guardar>Guardar ajustes</button></div>
      `);

      document.querySelector("[data-volver]").onclick = () => { PAGOS_VIEW = "liquidacion"; renderPagos(); };
      document.querySelector("[data-add-feriado]").onclick = () => {
        const v = document.getElementById("aj-feriado-nuevo").value;
        if (v && !FERIADOS_EDIT.includes(v)) FERIADOS_EDIT.push(v);
        FERIADOS_EDIT.sort();
        render();
      };
      document.querySelectorAll("[data-del-feriado]").forEach((b) => {
        b.onclick = () => {
          FERIADOS_EDIT = FERIADOS_EDIT.filter((f) => f !== b.getAttribute("data-del-feriado"));
          render();
        };
      });
      document.querySelector("[data-guardar]").onclick = async () => {
        const telefonos = {};
        document.querySelectorAll("[data-tel]").forEach((i) => (telefonos[i.getAttribute("data-tel")] = i.value.trim()));
        const valorDepto = {};
        document.querySelectorAll("[data-depto]").forEach((i) => (valorDepto[i.getAttribute("data-depto")] = Number(i.value) || 0));
        const viaticoDia = {};
        document.querySelectorAll("[data-viatico]").forEach((i) => (viaticoDia[i.getAttribute("data-viatico")] = Number(i.value) || 0));
        const body = {
          viaticoDia,
          plusDomingo: Number(document.getElementById("aj-domingo").value) || 0,
          plusFeriado: Number(document.getElementById("aj-feriado").value) || 0,
          feriados: FERIADOS_EDIT,
          telefonos,
          valorDepto,
        };
        try {
          await fetchJSON(`${API}/pay-config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          toast("Ajustes guardados");
          PAGOS_VIEW = "liquidacion";
          renderPagos();
        } catch (err) {
          toast("No se pudo guardar: " + err.message);
        }
      };
    };
    render();
  } catch (err) {
    setMain(`<div class="empty-state">Error: ${err.message}</div>`);
  }
}

async function renderMisPagos() {
  try {
    const pedidos = await fetchJSON(`${API}/lavanderia`);
    const propios = pedidos.filter((p) => p.status === "completado");
    setScope("Tus pedidos");
    setMain(`
      <p class="muted">Los montos de lavanderia se siguen registrando por transferencia aparte. Aca queda el conteo de pedidos.</p>
      <div class="stat"><p class="label">Pedidos completados</p><p class="value">${propios.length}</p></div>
    `);
  } catch (err) {
    setMain(`<div class="empty-state">Error: ${err.message}</div>`);
  }
}

// ---------- Insumos ----------

async function renderInsumos() {
  try {
    const items = await fetchJSON(`${API}/insumos`);
    setScope(`${items.length} items`);
    setMain(`
      ${items
        .map((i) => {
          const estado = i.stockActual <= i.stockMinimo / 2 ? ["red", "Bajo"] : i.stockActual < i.stockMinimo ? ["amber", "Medio"] : ["green", "Ok"];
          return `
        <div class="card">
          <div class="card-row">
            <div>
              <p class="card-title">${i.producto}</p>
              <p class="card-sub">${i.ubicacion || i.categoria}</p>
            </div>
            <span class="badge ${estado[0]}">${estado[1]}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:10px;">
            <input type="number" min="0" value="${i.stockActual}" data-stock-input="${i.id}" style="width:70px; border:1px solid var(--border); border-radius:var(--radius); padding:6px 8px;" />
            <button class="btn-secondary" data-save-stock="${i.id}">Guardar stock</button>
          </div>
        </div>`;
        })
        .join("")}
    `);

    document.querySelectorAll("[data-save-stock]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-save-stock");
        const item = items.find((i) => i.id === id);
        const input = document.querySelector(`[data-stock-input="${id}"]`);
        await fetchJSON(`${API}/insumos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...item, stockActual: Number(input.value) }),
        });
        toast("Stock actualizado");
        renderInsumos();
      };
    });
  } catch (err) {
    setMain(`<div class="empty-state">Error: ${err.message}</div>`);
  }
}

// ---------- Lavanderia ----------

async function renderLavanderia() {
  try {
    const pedidos = await fetchJSON(`${API}/lavanderia`);
    setScope(`${pedidos.filter((p) => p.status === "pendiente").length} pendientes`);

    setMain(`
      <p class="muted">Pedidos de retiro / entrega</p>
      ${
        pedidos.length === 0
          ? `<div class="empty-state">No hay pedidos cargados.</div>`
          : pedidos
              .map(
                (p) => `
        <div class="card">
          <div class="card-row">
            <div>
              <p class="card-title">${p.tipo === "retiro" ? "Retirar" : "Entregar"} · ${p.propertyName || "-"}</p>
              <p class="card-sub">${fmtDate(p.fecha)}</p>
            </div>
            <span class="badge ${p.status === "completado" ? "green" : "amber"}">${p.status === "completado" ? "Completado" : "Pendiente"}</span>
          </div>
          ${p.status !== "completado" ? `<button class="btn-secondary" style="margin-top:8px;" data-complete="${p.id}">Marcar completado</button>` : ""}
        </div>`
              )
              .join("")
      }
    `);

    document.querySelectorAll("[data-complete]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-complete");
        await fetchJSON(`${API}/lavanderia`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status: "completado" }),
        });
        toast("Pedido actualizado");
        renderLavanderia();
      };
    });
  } catch (err) {
    setMain(`<div class="empty-state">Error: ${err.message}</div>`);
  }
}

// ---------- Boot ----------

// La sesion se guarda en localStorage (arriba) y se lee al arrancar, asi que
// no hay que volver a elegir el nombre en cada visita. Ademas le pedimos al
// navegador que marque el almacenamiento como "persistente" para que no lo
// borre por falta de espacio o inactividad (importante en la PWA del celular).
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then((yes) => {
    if (!yes) navigator.storage.persist().catch(() => {});
  }).catch(() => {});
}

async function render() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="empty-state">Cargando Staybaires...</div>`;
  try {
    await loadConfig();
  } catch (err) {
    app.innerHTML = `<div class="empty-state">No se pudo conectar con el servidor.<br>${err.message}</div>`;
    return;
  }
  if (!SESSION) renderLogin();
  else renderApp();
}

render();
