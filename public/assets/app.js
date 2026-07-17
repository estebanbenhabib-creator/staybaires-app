// App Staybaires - vanilla JS, sin build. Habla con las Netlify Functions
// bajo /api/* (ver redirect en netlify.toml).

const API = "/api";
const ICONS = {
  hoy: "🏠", calendario: "📅", tareas: "✅", empleadas: "👥", pagos: "💵",
  insumos: "📦", lavanderia: "🧺", mispagos: "💵",
};
const TITLES = {
  hoy: "Hoy", calendario: "Calendario", tareas: "Tareas", empleadas: "Empleadas",
  pagos: "Pagos", insumos: "Insumos", lavanderia: "Lavanderia", mispagos: "Mis pagos",
};

let SESSION = safeParse(localStorage.getItem("sb-session"));
let CONFIG = null;
let CURRENT_TAB = null;
let CACHE = {};

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
  return `<button class="name-btn" data-login-direct="${emp.id}">${emp.nombre}${emp.esRotativa ? " (rotativa)" : ""} <span>&rarr;</span></button>`;
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
        <h3>Empleada de limpieza</h3>
        ${cleaners.map(loginEntryHTML).join("")}
      </div>
      ${lavanderia.length ? `<div class="role-card"><h3>Lavanderia</h3>${lavanderia.map(loginEntryHTML).join("")}</div>` : ""}
    </div>
  `;

  function afterAuth(emp, authData) {
    if (emp.esRotativa) {
      const nombreReal = prompt("Como te llamas hoy? (para que quede registrado en las tareas)");
      login({ role: authData.rol, employeeId: authData.employeeId, name: authData.nombre, nombreReal: nombreReal || "" });
    } else {
      login({ role: authData.rol, employeeId: authData.employeeId, name: authData.nombre });
    }
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
    const limpiezasHoy = payload.tasks.filter((t) => t.date === hoy);
    const checkinsHoy = (payload.checkins || []).filter((c) => c.date === hoy);
    // Un depto con check-out Y check-in el mismo dia = limpieza urgente (entra
    // huesped nuevo hoy mismo). Lo marcamos para que salte a la vista.
    const entranHoy = new Set(checkinsHoy.map((c) => c.propertyCode));

    const misLimpiezas = manage ? limpiezasHoy : limpiezasHoy.filter((t) => t.assignedTo === SESSION.employeeId);

    const cleanCard = (t) => {
      const sameDay = entranHoy.has(t.propertyCode);
      const assignedLabel = t.assignedTo === "random" && t.assignedName ? `Random (${t.assignedName})` : employeeName(t.assignedTo);
      return `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-row">
          <div>
            <p class="card-title">${t.propertyName}</p>
            <p class="card-sub">${t.direccion || t.barrio}</p>
            ${manage ? `<p class="card-sub">${assignedLabel}</p>` : ""}
          </div>
          ${sameDay ? `<span class="badge red">Entra hoy</span>` : statusBadge(t.status)}
        </div>
        ${sameDay ? `<p class="card-sub" style="color:var(--red-fg); margin-top:6px;">⚡ Entra un huesped hoy: limpiar con prioridad.</p>` : ""}
      </div>`;
    };

    let extras = "";
    if (manage) {
      const [insumos, pedidos] = await Promise.all([fetchJSON(`${API}/insumos`), fetchJSON(`${API}/lavanderia`)]);
      const bajos = insumos.filter((i) => i.stockActual < i.stockMinimo);
      const lavPend = pedidos.filter((p) => p.status !== "completado");
      extras = `
        <div class="stat-grid">
          <div class="stat"><p class="label">Insumos bajos</p><p class="value ${bajos.length ? "warn" : ""}">${bajos.length}</p></div>
          <div class="stat"><p class="label">Lavanderia pendiente</p><p class="value">${lavPend.length}</p></div>
        </div>`;
    }

    setMain(`
      <p class="muted">Hola ${SESSION.name} · ${fmtDateHeader(hoy)}</p>
      ${extras}
      <p class="section-label">${manage ? "Limpiezas de hoy" : "Tus limpiezas de hoy"} (${misLimpiezas.length})</p>
      ${misLimpiezas.length === 0 ? `<div class="empty-state">No hay limpiezas para hoy.</div>` : misLimpiezas.map(cleanCard).join("")}
      ${
        manage
          ? `<p class="section-label">Check-ins de hoy (${checkinsHoy.length})</p>
        ${
          checkinsHoy.length === 0
            ? `<div class="empty-state">No hay llegadas hoy.</div>`
            : checkinsHoy
                .map(
                  (c) => `
          <div class="card" style="margin-bottom:8px;">
            <div class="card-row">
              <div><p class="card-title">${c.propertyName}</p><p class="card-sub">${c.direccion || c.barrio}</p></div>
              ${platformBadge(c.platform)}
            </div>
          </div>`
                )
                .join("")
        }`
          : ""
      }
    `);
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

async function renderCalendario() {
  try {
    const payload = await getTasks();
    const today = new Date().toISOString().slice(0, 10);
    const horizonte = new Date();
    horizonte.setDate(horizonte.getDate() + 45);
    const horizonteISO = horizonte.toISOString().slice(0, 10);

    const combinado = [...payload.tasks, ...(payload.checkins || [])].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === "checkin" ? -1 : 1));
    const upcoming = combinado.filter((t) => t.date >= today && t.date <= horizonteISO);
    setScope(`${(CONFIG.properties || []).length} propiedades`);

    const syncInfo = payload.lastSync
      ? `Ultimo sync: ${new Date(payload.lastSync).toLocaleString("es-AR")}`
      : "Todavia no sincronizo";

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

    const cleaners = (CONFIG.employees || []).filter((e) => e.rol === "empleada");
    const puedeAsignar = canManageTasks();

    // agrupar por fecha, ya vienen ordenadas por fecha desde el backend
    const grupos = [];
    let grupoActual = null;
    for (const t of upcoming) {
      if (!grupoActual || grupoActual.date !== t.date) {
        grupoActual = { date: t.date, items: [] };
        grupos.push(grupoActual);
      }
      grupoActual.items.push(t);
    }

    setMain(`
      <p class="muted">${syncInfo} · sync automatico diario de Airbnb / Booking / Vrbo</p>
      <div class="refresh-row"><button class="btn-secondary" data-refresh>Actualizar ahora</button></div>
      ${erroresHTML}
      ${
        grupos.length === 0
          ? `<div class="empty-state">No hay check-ins ni check-outs en los proximos 45 dias.</div>`
          : grupos
              .map(
                (g) => `
        <p style="font-size:13px; font-weight:600; margin:16px 0 8px; color:var(--text-secondary);">${fmtDateHeader(g.date)}</p>
        ${g.items
          .map((t) => {
            const esCheckout = t.type !== "checkin";
            const assignedLabel = esCheckout
              ? t.assignedTo === "random" && t.assignedName
                ? `Random (${t.assignedName})`
                : employeeName(t.assignedTo)
              : `Llega huesped · ${platformBadge(t.platform)}`;
            return `
        <div class="card" style="margin-bottom:8px;">
          <div class="card-row">
            <div>
              <p class="card-title">${t.propertyName}</p>
              <p class="card-sub">${t.direccion || t.barrio}</p>
              <p class="card-sub">${assignedLabel}</p>
            </div>
            ${eventTypeBadge(t.type)}
          </div>
          ${
            esCheckout && puedeAsignar
              ? `<div style="margin-top:8px;">
                  <select class="badge-select" data-reassign-cal="${t.id}">
                    ${cleaners.map((c) => `<option value="${c.id}" ${c.id === t.assignedTo ? "selected" : ""}>${c.nombre}</option>`).join("")}
                  </select>
                </div>`
              : ""
          }
        </div>`;
          })
          .join("")}`
              )
              .join("")
      }
    `);

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
        renderCalendario();
      };
    });
  } catch (err) {
    setMain(`<div class="empty-state">Error cargando el calendario: ${err.message}</div>`);
  }
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
      ${canManageTasks() ? `<p class="muted">Orden de asignacion automatica: Susana &rarr; Mari &rarr; Random</p>` : ""}
      ${
        tasks.length === 0
          ? `<div class="empty-state">No hay tareas todavia.</div>`
          : tasks
              .map((t) => {
                const assignedLabel = t.assignedTo === "random" && t.assignedName ? `Random (${t.assignedName})` : employeeName(t.assignedTo);
                return `
        <div class="card" data-task="${t.id}">
          <div class="card-row">
            <div>
              <p class="card-title">${t.propertyName}</p>
              <p class="card-sub">${t.direccion || t.barrio}</p>
              <p class="card-sub">${assignedLabel} · ${fmtDate(t.date)}</p>
            </div>
            ${statusBadge(t.status)}
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

    document.querySelectorAll("[data-mark-done]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-mark-done");
        const body = { id, status: "hecha" };
        if (SESSION.role === "empleada" && SESSION.employeeId === "random" && SESSION.nombreReal) {
          body.assignedName = SESSION.nombreReal;
        }
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
    const [payload, paymentsData] = await Promise.all([getTasks(), fetchJSON(`${API}/payments`)]);
    setScope(`${CONFIG.employees.length} personas`);
    const jerarquiaLabel = { principal: "Principal", secundaria: "Secundaria", rotativa: "Rotativa" };
    const jerarquiaBadge = { principal: "blue", secundaria: "teal", rotativa: "amber" };

    const cleaners = CONFIG.employees.filter((e) => e.rol === "empleada");
    const lavanderia = CONFIG.employees.filter((e) => e.rol === "lavanderia");

    function summaryFor(id) {
      return paymentsData.summary.find((s) => s.employeeId === id);
    }

    setMain(`
      ${cleaners
        .map((e) => {
          const s = summaryFor(e.id);
          return `
        <div class="card">
          <div class="card-row">
            <div>
              <p class="card-title">${e.nombre}</p>
              <p class="card-sub">Limpieza · $${e.tarifaPorDia?.toLocaleString("es-AR") || "-"}/dia</p>
            </div>
            <span class="badge ${jerarquiaBadge[e.jerarquia] || "blue"}">${jerarquiaLabel[e.jerarquia] || ""}</span>
          </div>
          <p class="card-sub" style="margin-top:8px;">${s ? `${s.totalDias} dias trabajados · ${fmtMoney(s.totalPago)}` : "Sin datos de pago todavia"}</p>
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

// ---------- Pagos (admin) ----------

async function renderPagos() {
  try {
    const data = await fetchJSON(`${API}/payments`);
    setScope("Este periodo");
    setMain(`
      <p class="muted">Pago fijo por dia trabajado, no por depto</p>
      ${data.summary
        .map(
          (s) => `
        <div class="card">
          <div class="card-row">
            <span class="card-title">${s.nombre}</span>
            <span class="card-title">${fmtMoney(s.totalPago)}</span>
          </div>
          <p class="card-sub">${s.totalDias} dias x ${fmtMoney(s.tarifaPorDia)}</p>
        </div>`
        )
        .join("")}
    `);
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
