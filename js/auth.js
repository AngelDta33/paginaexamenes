// Sesión, roles y guardas de ruta. Un solo lugar que sabe hablar con Firebase Auth + Firestore.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, collection, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const ROLES = ['maestro', 'revisor', 'administrador'];

async function obtenerPerfil(uid) {
  const snap = await getDoc(doc(db, 'usuarios', uid));
  return snap.exists() ? snap.data() : null;
}

function armarSesion(user, perfil) {
  if (!perfil) {
    // Cuenta de Auth sin documento en usuarios/ (no debería pasar salvo mal bootstrap)
    return { uid: user.uid, email: user.email, nombre: user.email, rol: null, activo: false };
  }
  return { uid: user.uid, email: user.email, ...perfil };
}

// Se vuelve a llamar en cada disparo de onAuthStateChanged (login, logout,
// refresco de token cada ~1h) — no cuando un administrador cambia el
// documento de otro usuario ya logueado: eso no dispara ningún evento de
// Auth, así que a alguien que reactivan mientras su pestaña ya estaba abierta
// en "Tu cuenta no tiene acceso" no le alcanza con esperar — necesita volver a
// intentar (ver reintentarSesion, que usa esto mismo bajo el botón "Reintentar").
let tokenSesion = 0;
export function observarSesion(callback) {
  return onAuthStateChanged(auth, async (user) => {
    const token = ++tokenSesion;
    if (!user) { if (token === tokenSesion) callback(null); return; }
    const perfil = await obtenerPerfil(user.uid);
    // Dos disparos de onAuthStateChanged pueden superponerse (ej. el login dispara
    // uno y, casi al mismo tiempo, un refresco de token dispara otro) y la red
    // puede resolver sus getDoc en cualquier orden — sin este freno, la consulta
    // más vieja podía llegar después y pisar con datos obsoletos (ej. activo:false)
    // la sesión que ya se había actualizado correctamente.
    if (token !== tokenSesion) return;
    callback(armarSesion(user, perfil));
  });
}

// Vuelve a consultar el perfil del usuario ya logueado sin pasar por Auth (no
// hay evento de onAuthStateChanged que dispare esto solo) — para el botón
// "Reintentar" de la pantalla "Tu cuenta no tiene acceso": si un administrador
// reactivó la cuenta mientras esa pestaña seguía abierta, esto es lo único que
// vuelve a leer el activo:true sin pedirle a la persona que cierre sesión y
// vuelva a entrar (ni que sepa que tiene que recargar la página a mano).
export async function reintentarSesion() {
  const user = auth.currentUser;
  if (!user) return null;
  const perfil = await obtenerPerfil(user.uid);
  return armarSesion(user, perfil);
}

export async function iniciarSesion(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user.uid;
}

export function cerrarSesion() {
  return signOut(auth);
}

// Autoservicio: cualquier usuario logueado puede reemplazar su propia contraseña
// (temporal o no) sin depender de que llegue un correo.
export function cambiarContrasena(nuevaContrasena) {
  if (!auth.currentUser) return Promise.reject(new Error('No hay sesión activa.'));
  return updatePassword(auth.currentUser, nuevaContrasena);
}

export function esRevisorOAdmin(sesion) {
  return !!sesion && (sesion.rol === 'revisor' || sesion.rol === 'administrador');
}

// Mapa uid → rol de todas las cuentas. Lo usa el filtro "Grupos de profesores" de
// la lista de grupos: ahora que revisores y administradores también llevan sus
// propios grupos, "de un profesor" ya no es lo mismo que "no es mío", y el
// documento del grupo solo guarda profesorId/profesorNombre, no el rol de quien
// lo creó (guardarlo ahí lo dejaría congelado en el momento del alta, además de
// que los grupos que ya existen no lo traen). Cualquier cuenta autenticada puede
// leer usuarios/ — ver firestore.rules.
export async function rolesPorUsuario() {
  const snap = await getDocs(collection(db, 'usuarios'));
  const roles = new Map();
  snap.docs.forEach((d) => roles.set(d.id, (d.data() || {}).rol || null));
  return roles;
}
