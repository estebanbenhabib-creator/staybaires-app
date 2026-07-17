// Capa de persistencia compartida usando Netlify Blobs (viene incluido con
// cualquier sitio en Netlify, no requiere crear cuenta en otro servicio).
// Guardamos todo como JSON bajo claves fijas dentro del store "staybaires".
//
// Si el dia de manana esto se muda a Supabase, este es el unico archivo que
// habria que reemplazar: las functions solo llaman a get()/set() de aca.

const { getStore } = require("@netlify/blobs");
const fs = require("fs");
const path = require("path");
const os = require("os");

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

// --- Fallback local (solo `netlify dev`) --------------------------------
// En local, `netlify dev` no provee contexto de Netlify Blobs salvo que el
// sitio este linkeado con `netlify login`. Para poder correr la app de punta
// a punta sin tocar los datos reales de produccion, cuando estamos en dev
// (NETLIFY_DEV === "true") y no hay credenciales de Blobs a mano, persistimos
// en un directorio local `.dev-blobs/` (gitignoreado). En produccion esta
// rama nunca se ejecuta: NETLIFY_DEV no esta seteado y se usa Blobs real.
function useLocalFsStore() {
  return process.env.NETLIFY_DEV === "true" && !(process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN);
}

// Ruta ABSOLUTA y estable, compartida por todas las functions. Ojo: no se
// puede usar __dirname porque `netlify dev` bundlea cada function con esbuild
// en su propio directorio temporal, asi que cada una veria un .dev-blobs
// distinto y no compartirian estado (payments no veria lo que escribio sync).
const LOCAL_DIR = path.join(os.tmpdir(), "staybaires-dev-blobs");

function localPath(key) {
  return path.join(LOCAL_DIR, `${encodeURIComponent(key)}.json`);
}

function localGet(key, fallback) {
  try {
    const raw = fs.readFileSync(localPath(key), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function localSet(key, value) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(localPath(key), JSON.stringify(value, null, 2));
}
// ------------------------------------------------------------------------

async function getJSON(key, fallback) {
  if (useLocalFsStore()) return localGet(key, fallback);
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
  if (useLocalFsStore()) return localSet(key, value);
  const s = store();
  await s.setJSON(key, value);
}

module.exports = { getJSON, setJSON };
