// App Staybaires - vanilla JS, sin build. Habla con las Netlify Functions
// bajo /api/* (ver redirect en netlify.toml).

const API = "/api";
const ICONS = {
  calendario: "📅", tareas: "✅", empleadas: "👥", pagos: "💵",
  insumos: "📦", lavanderia: "🧺", mispagos: "💵",
};
const TITLES = {
  calendario: "Calendario", tareas: "Tareas", empleadas: "Empleadas",
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

function fmtMoney(n) {
  return "$" + Number(n || 0).toLocaleString("es-AR");
}

function platformBadge(platform) {
  const map = { airbnb: ["coral", "Airbnb"], booking: ["blue", "Booking"], vrbo: ["teal", "Vrbo"] };
  const [cls, label] = map[platform] || ["blue", platform || "?"];
  return `<span class="badge ${cls}">${label}</span>`;
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

function renderLogin() {
  const app = document.getElementById("app");
  const cleaners = (CONFIG.employees || []).filter((e) => e.rol === "empleada").sort((a, b) => (a.id === "susana" ? -1 : 1));
  app.innerHTML = `
    <div class="login-wrap">
      <div class="brand">STAY<span class="blue">BAIRES</span></div>
      <p class="muted">Elegi con que perfil entras</p>

      <div class="role-card">
        <h3>Admin</h3>
        <button class="name-btn" data-login-admin>Esteban <span>&rarr;</span></button>
      </div>

      <div class="role-card">
        <h3>Empleada de limpieza</h3>
        ${cleaners.map((c) => `<button class="name-btn" data-login-empleada="${c.id}">${c.nombre}${c.esRotativa ? " (rotativa)" : ""} <span>&rarr;</span></button>`).join("")}
      </div>

      <div class="role-card">
        <h3>Lavanderia</h3>
        <button class="name-btn" data-login-lavanderia>Lujan <span>&rarr;</span></button>
      </div>
    </div>
  `;

  app.querySelector("[data-login-admin]").onclick = () => login({ role: "admin", employeeId: "esteban", name: "Esteban" });
  app.querySelectorAll("[data-login-empleada]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-login-empleada");
      const emp = cleaners.find((c) => c.id === id);
      if (emp.esRotativa) {
        const nombreReal = prompt("Como te llamas hoy? (para que quede registrado en las tareas)");
        login({ role: "empleada", employeeId: id, name: emp.nombre, nombreReal: nombreReal || "" });
      } else {
        login({ role: "empleada", employeeId: id, name: emp.nombre });
      }
    };
  });
  app.querySelector("[data-login-lavanderia]").onclick = () => login({ role: "lavanderia", employeeId: "lujan", name: "Lujan" });
}

function login(session) {
  SESSION = session;
  localStorage.setItem("sb-session", JSON.stringify(session));
  CURRENT_TAB = CONFIG.roles[session.role].tabs[0];
  renderApp();
}

function logout() {
  SESSION = null;
  localStorage.removeItem("sb-session");
  render();
}

// ---------- App shell ----------

function renderApp() {
  const app = document.getElementById("app");
  const roleConf = CONFIG.roles[SESSION.role];
  const tabs = roleConf.tabs;
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
    const upcoming = payload.tasks.filter((t) => t.date >= today).slice(0, 20);
    setScope(`${(CONFIG.properties || []).length} propiedades`);

    const syncInfo = payload.lastSync
      ? `Ultimo sync: ${new Date(payload.lastSync).toLocaleString("es-AR")}`
      : "Todavia no sincronizo";

    setMain(`
      <p class="muted">${syncInfo} · sync automatico diario de Airbnb / Booking / Vrbo</p>
      <div class="refresh-row"><button class="btn-secondary" data-refresh>Actualizar ahora</button></div>
      ${
        upcoming.length === 0
          ? `<div class="empty-state">No hay checkouts proximos cargados todavia.</div>`
          : upcoming
              .map(
                (t) => `
        <div class="card">
          <div class="card-row">
            <div>
              <p class="card-title">${t.propertyName}</p>
              <p class="card-sub">${t.barrio} · checkout ${fmtDate(t.date)}</p>
            </div>
            ${platformBadge(t.platform)}
          </div>
        </div>`
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
  } catch (err) {
    setMain(`<div class="empty-state">Error cargando el calendario: ${err.message}</div>`);
  }
}

// ---------- Tareas ----------

async function renderTareas() {
  try {
    const payload = await getTasks();
    let tasks = payload.tasks;
    if (SESSION.role === "empleada") {
      tasks = tasks.filter((t) => t.assignedTo === SESSION.employeeId);
      setScope(`Tus tareas`);
    } else {
      setScope(`${tasks.length} tareas`);
    }

    const cleaners = (CONFIG.employees || []).filter((e) => e.rol === "empleada");

    setMain(`
      ${SESSION.role === "admin" ? `<p class="muted">Orden de asignacion automatica: Susana &rarr; Mari &rarr; Random</p>` : ""}
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
              SESSION.role === "admin"
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
