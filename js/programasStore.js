// Persistencia en Firestore de los programas de actividades académicas — mismo
// patrón de privacidad por maestro que gruposStore.js.

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './auth.js';

const COL_PROGRAMAS = 'programas';

// El maestro solo ve los suyos; revisor/administrador ven todos (solo consulta).
export async function listarProgramas(sesion) {
  const col = collection(db, COL_PROGRAMAS);
  const consulta = sesion.rol === 'maestro' ? query(col, where('profesorId', '==', sesion.uid)) : query(col);
  const snap = await getDocs(consulta);
  const programas = snap.docs.map((d) => d.data());
  programas.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return programas;
}

export async function obtenerPrograma(id) {
  const snap = await getDoc(doc(db, COL_PROGRAMAS, id));
  return snap.exists() ? snap.data() : null;
}

export async function guardarPrograma(programa) {
  programa.updatedAt = new Date().toISOString();
  await setDoc(doc(db, COL_PROGRAMAS, programa.id), programa);
}

export async function eliminarPrograma(id) {
  await deleteDoc(doc(db, COL_PROGRAMAS, id));
}
