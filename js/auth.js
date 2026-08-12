// Sesión, roles y guardas de ruta. Un solo lugar que sabe hablar con Firebase Auth + Firestore.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const ROLES = ['maestro', 'revisor', 'administrador'];

async function obtenerPerfil(uid) {
  const snap = await getDoc(doc(db, 'usuarios', uid));
  return snap.exists() ? snap.data() : null;
}

// callback recibe null (sin sesión) o { uid, email, nombre, rol, activo }
export function observarSesion(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) { callback(null); return; }
    const perfil = await obtenerPerfil(user.uid);
    if (!perfil) {
      // Cuenta de Auth sin documento en usuarios/ (no debería pasar salvo mal bootstrap)
      callback({ uid: user.uid, email: user.email, nombre: user.email, rol: null, activo: false });
      return;
    }
    callback({ uid: user.uid, email: user.email, ...perfil });
  });
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
