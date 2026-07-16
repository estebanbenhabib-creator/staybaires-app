// Capa de persistencia compartida usando Netlify Blobs (viene incluido con
// cualquier sitio en Netlify, no requiere crear cuenta en otro servicio).
// Guardamos todo como JSON bajo claves fijas dentro del store "staybaires".
//
// Si el dia de manana esto se muda a Supabase, este es el unico archivo que
// habria que reemplazar: las functions solo llaman a get()/set() de aca.

const { getStore } = require("@netlify/blobs");

// El auto-detect de Netlify Blobs a veces no encuentra el contexto del sitio
// (pasa en algunos deploys) y tira "environment has not been configured".
// Si existen estas dos variables de entorno, las usamos a mano; si no,
// probamos el modo automatico como antes.
function store() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: "staybaires", siteID, token });
  }
  return getStore("staybaires");
}

async function getJSON(key, fallback) {
  try {
    const s = store();
    const value = await s.get(key, { type: "json" });
    return value === null || value === undefined ? fallback : value;
  } catch (err) {
    console.error(`store.getJSON(${key}) fallo:`, err.message);
    return fallback;
  }
}

async function setJSON(key, value) {
  const s = store();
  await s.setJSON(key, value);
}

module.exports = { getJSON, setJSON };
