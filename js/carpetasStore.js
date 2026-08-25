// Persistencia en Firestore de las carpetas para organizar exámenes — mismo
// patrón de privacidad por maestro que gruposStore.js/programasStore.js.

import {
  collection, doc, getDocs, setDoc, deleteDoc, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './auth.js';

const COL_CARPETAS = 'carpetas';

export async function listarCarpetas(sesion) {
  const col = collection(db, COL_CARPETAS);
  const consulta = sesion.rol === 'maestro' ? query(col, where('profesorId', '==', sesion.uid)) : query(col);
  const snap = await getDocs(consulta);
  const carpetas = snap.docs.map((d) => d.data());
  carpetas.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  return carpetas;
}

export async function guardarCarpeta(carpeta) {
  await setDoc(doc(db, COL_CARPETAS, carpeta.id), carpeta);
}

export async function eliminarCarpeta(id) {
  await deleteDoc(doc(db, COL_CARPETAS, id));
}
