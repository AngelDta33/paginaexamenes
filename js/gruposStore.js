// Persistencia en Firestore de grupos (roster + rúbrica + calificaciones) y asistencias (por día).

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './auth.js';
import { idAsistencia, nuevaAsistencia } from './gruposModel.js';

const COL_GRUPOS = 'grupos';
const COL_ASISTENCIAS = 'asistencias';

export async function listarGrupos(sesion) {
  const consulta = query(collection(db, COL_GRUPOS), where('profesorId', '==', sesion.uid));
  const snap = await getDocs(consulta);
  const grupos = snap.docs.map((d) => d.data());
  grupos.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return grupos;
}

export async function obtenerGrupo(id) {
  const snap = await getDoc(doc(db, COL_GRUPOS, id));
  return snap.exists() ? snap.data() : null;
}

export async function guardarGrupo(grupo) {
  grupo.updatedAt = new Date().toISOString();
  await setDoc(doc(db, COL_GRUPOS, grupo.id), grupo);
}

export async function eliminarGrupo(id) {
  await deleteDoc(doc(db, COL_GRUPOS, id));
}

export async function listarAsistencias(grupoId) {
  const consulta = query(collection(db, COL_ASISTENCIAS), where('grupoId', '==', grupoId));
  const snap = await getDocs(consulta);
  const dias = snap.docs.map((d) => d.data());
  dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return dias;
}

export async function obtenerOCrearAsistencia(grupoId, fechaISO) {
  const ref = doc(db, COL_ASISTENCIAS, idAsistencia(grupoId, fechaISO));
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : nuevaAsistencia(grupoId, fechaISO);
}

export async function guardarAsistencia(asistencia) {
  asistencia.updatedAt = new Date().toISOString();
  await setDoc(doc(db, COL_ASISTENCIAS, idAsistencia(asistencia.grupoId, asistencia.fecha)), asistencia);
}
