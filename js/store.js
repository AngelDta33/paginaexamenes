// Persistencia en Firestore: exámenes (colección "examenes"), configuración de la escuela
// (documento compartido "configuracion/escuela") y export/import de respaldo en .json.

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './auth.js';

const COL_EXAMENES = 'examenes';

// sesion = { uid, rol, ... } — el maestro solo ve lo suyo; revisor/administrador ven todo.
export async function listarExamenes(sesion) {
  const col = collection(db, COL_EXAMENES);
  const consulta = sesion.rol === 'maestro' ? query(col, where('profesorId', '==', sesion.uid)) : query(col);
  const snap = await getDocs(consulta);
  const examenes = snap.docs.map((d) => d.data());
  examenes.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return examenes;
}

export async function obtenerExamen(id) {
  const snap = await getDoc(doc(db, COL_EXAMENES, id));
  return snap.exists() ? snap.data() : null;
}

export async function guardarExamen(examen) {
  examen.updatedAt = new Date().toISOString();
  await setDoc(doc(db, COL_EXAMENES, examen.id), examen);
}

export async function eliminarExamen(id) {
  await deleteDoc(doc(db, COL_EXAMENES, id));
}

export async function obtenerConfig() {
  const snap = await getDoc(doc(db, 'configuracion', 'escuela'));
  return snap.exists() ? snap.data() : { nombreEscuela: '', logoDataUrl: null, cicloEscolar: '' };
}

export async function guardarConfig(config) {
  await setDoc(doc(db, 'configuracion', 'escuela'), config);
}

export function exportarExamenJSON(examen) {
  const blob = new Blob([JSON.stringify(examen, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const nombre = `${examen.meta.materia || 'examen'}_${examen.meta.grado || ''}${examen.meta.grupo || ''}_Tipo${examen.tipoExamen}`.replace(/\s+/g, '_');
  a.href = url;
  a.download = `${nombre}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importarExamenJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const examen = JSON.parse(reader.result);
        if (!examen.id || !examen.meta) throw new Error('El archivo no tiene el formato esperado.');
        resolve(examen);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
