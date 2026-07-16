// Capa de persistencia compartida usando Netlify Blobs (viene incluido con
// cualquier sitio en Netlify, no requiere crear cuenta en otro servicio).
// Guardamos todo como JSON bajo claves fijas dentro del store "staybaires".
//
// Si el dia de manana esto se muda a Supabase, este es el unico archivo que
// habria que reemplazar: las functions solo llaman a get()/set() de aca.

const { getStore } = require("@netlify/blobs");

function store() {
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
