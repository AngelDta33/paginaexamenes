// Respalda TODOS los datos de la app (Firestore + cuentas de Firebase Auth) a
// archivos JSON locales, en una carpeta por fecha. No toca nada de la app en
// sí — vive aparte, no se sube a Netlify ni se ejecuta en el navegador.
//
// Uso manual:      npm run respaldar
// Uso programado:  ver respaldo/mx.ccuma.paginaexamenes.respaldo.plist
//
// Requiere una service account key de Firebase (Project settings → Service
// accounts → Generate new private key en la consola de Firebase). Guárdala
// FUERA de este repo — por defecto se busca en:
//   ~/.secrets/ccuma-firebase-adminsdk.json
// o en la ruta que apunte la variable de entorno RESPALDO_SERVICE_ACCOUNT.
// Esa key da acceso total de administrador a Firestore y Auth: si algún día
// se filtra, hay que revocarla desde la consola de Firebase de inmediato.
//
// Además de guardar en local, sube una copia a un repositorio PRIVADO de
// GitHub dedicado solo a esto (aparte del repo de la app, a propósito — si
// algo le pasa a la cuenta de Google/Firebase, el respaldo no debe vivir en
// la misma canasta). CARPETA_RESPALDOS debe ser, además de una carpeta común,
// un repo git ya inicializado con "origin" apuntando a ese repositorio (ver
// las instrucciones que se dieron al configurar esto la primera vez). El
// archivo con password hashes (auth-usuarios.SENSIBLE.json) nunca se sube:
// el .gitignore de ese repo lo excluye. Si git falla (sin red, remoto mal
// configurado, etc.) el respaldo local se hace igual y solo se avisa.

import {
  readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const execFileAsync = promisify(execFile);

// --- Configuración (ajusta estas rutas/valores a tu gusto) -----------------

const RUTA_SERVICE_ACCOUNT = process.env.RESPALDO_SERVICE_ACCOUNT
  || path.join(os.homedir(), '.secrets', 'ccuma-firebase-adminsdk.json');

const CARPETA_RESPALDOS = process.env.RESPALDO_DESTINO
  || path.join(os.homedir(), 'Backups', 'paginaexamenes');

// Solo poda LOCAL — el repo de GitHub conserva TODO el historial para
// siempre (podar aquí solo borra del disco, nunca genera un commit de
// borrado; ver subirAGitHub). 30 días de copia local alcanza de sobra para
// revisar algo reciente sin ir hasta GitHub.
const DIAS_A_CONSERVAR = 30;

// Ruta absoluta a propósito: el LaunchAgent corre con un PATH mínimo que no
// incluye /opt/homebrew/bin/usr/local/bin, así que "git" a secas podría no
// encontrarse ahí aunque funcione bien corriendo el script a mano.
const GIT_BIN = process.env.RESPALDO_GIT_BIN || '/usr/bin/git';

const COLECCIONES = [
  'examenes', 'usuarios', 'usuariosEliminados', 'grupos',
  'programas', 'carpetas', 'asistencias', 'configuracion',
];

// -----------------------------------------------------------------------

function hoyISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function cargarCredenciales() {
  let contenido;
  try {
    contenido = readFileSync(RUTA_SERVICE_ACCOUNT, 'utf8');
  } catch (err) {
    throw new Error(`No se pudo leer la service account key en ${RUTA_SERVICE_ACCOUNT}. Descárgala desde la consola de Firebase (Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada) y guárdala en esa ruta, o define RESPALDO_SERVICE_ACCOUNT con la ruta correcta.\nDetalle: ${err.message}`);
  }
  return JSON.parse(contenido);
}

async function respaldarColeccion(db, nombre) {
  const snap = await db.collection(nombre).get();
  const documentos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return documentos;
}

// listUsers pagina de a 1000 — con el tamaño de plantilla de esta escuela
// alcanza una sola vuelta, pero se recorre completo por si crece.
async function respaldarUsuariosAuth(auth) {
  const usuarios = [];
  let token;
  do {
    const pagina = await auth.listUsers(1000, token);
    usuarios.push(...pagina.users.map((u) => u.toJSON()));
    token = pagina.pageToken;
  } while (token);
  return usuarios;
}

// No debe tumbar todo el respaldo si falla: el respaldo LOCAL ya se hizo y es
// lo más importante. Si CARPETA_RESPALDOS no es un repo git, no tiene
// "origin", o no hay red, se avisa fuerte por consola (sale en el log del
// LaunchAgent) pero el proceso termina con éxito de todas formas.
//
// Se agrega SOLO la carpeta del día (nunca "git add -A"): así, cuando
// podarRespaldosViejos() borra carpetas viejas del disco más abajo, esos
// borrados jamás se vuelven un commit — GitHub se queda con el historial
// completo aunque el disco local solo conserve los últimos 30 días.
async function subirAGitHub(carpetaDeHoy, fecha) {
  const opciones = { cwd: CARPETA_RESPALDOS };
  try {
    await execFileAsync(GIT_BIN, ['add', fecha], opciones);
    const { stdout: estado } = await execFileAsync(GIT_BIN, ['diff', '--cached', '--name-only'], opciones);
    if (!estado.trim()) {
      console.log('Sin cambios que subir a GitHub (ya se había respaldado hoy).');
      return true;
    }
    await execFileAsync(GIT_BIN, ['commit', '-m', `Respaldo ${fecha}`], opciones);
    await execFileAsync(GIT_BIN, ['push', 'origin', 'main'], opciones);
    console.log(`Copia externa subida al repo privado de GitHub (${fecha}).`);
    return true;
  } catch (err) {
    console.error(`⚠ No se pudo subir la copia externa a GitHub. El respaldo local SÍ se hizo bien, pero revisa la conexión o que ${CARPETA_RESPALDOS} tenga "origin" bien configurado (\`git -C ${CARPETA_RESPALDOS} remote -v\`).\nDetalle: ${err.message}`);
    return false;
  }
}

function podarRespaldosViejos() {
  let carpetas;
  try {
    carpetas = readdirSync(CARPETA_RESPALDOS, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return; // primera corrida, la carpeta ni existe todavía
  }
  const limite = new Date();
  limite.setDate(limite.getDate() - DIAS_A_CONSERVAR);
  const limiteISO = limite.toISOString().slice(0, 10);
  for (const nombre of carpetas) {
    if (nombre < limiteISO) {
      rmSync(path.join(CARPETA_RESPALDOS, nombre), { recursive: true, force: true });
      console.log(`Respaldo viejo eliminado: ${nombre} (más de ${DIAS_A_CONSERVAR} días)`);
    }
  }
}

async function main() {
  const credenciales = cargarCredenciales();
  initializeApp({ credential: cert(credenciales) });
  const db = getFirestore();
  const auth = getAuth();

  const carpetaDeHoy = path.join(CARPETA_RESPALDOS, hoyISO());
  mkdirSync(carpetaDeHoy, { recursive: true });

  const resumen = { fecha: new Date().toISOString(), conteos: {} };

  for (const nombre of COLECCIONES) {
    const documentos = await respaldarColeccion(db, nombre);
    writeFileSync(path.join(carpetaDeHoy, `${nombre}.json`), JSON.stringify(documentos, null, 2));
    resumen.conteos[nombre] = documentos.length;
    console.log(`${nombre}: ${documentos.length} documentos`);
  }

  // Aparte y con nombre distinto porque, a diferencia de todo lo anterior,
  // este archivo trae passwordHash/passwordSalt de cada cuenta — sirve para
  // restaurar las cuentas tal cual (importUsers), pero hay que tratarlo con
  // más cuidado que el resto de los respaldos.
  const usuariosAuth = await respaldarUsuariosAuth(auth);
  writeFileSync(path.join(carpetaDeHoy, 'auth-usuarios.SENSIBLE.json'), JSON.stringify(usuariosAuth, null, 2));
  resumen.conteos.authUsuarios = usuariosAuth.length;
  console.log(`auth-usuarios: ${usuariosAuth.length} cuentas`);

  writeFileSync(path.join(carpetaDeHoy, 'resumen.json'), JSON.stringify(resumen, null, 2));

  const subioExterno = await subirAGitHub(carpetaDeHoy, hoyISO());
  resumen.subidoAGitHub = subioExterno;
  writeFileSync(path.join(carpetaDeHoy, 'resumen.json'), JSON.stringify(resumen, null, 2));

  podarRespaldosViejos();

  console.log(`\nRespaldo completo en: ${carpetaDeHoy}`);
}

main().catch((err) => {
  console.error('Falló el respaldo:', err.message);
  process.exit(1);
});
