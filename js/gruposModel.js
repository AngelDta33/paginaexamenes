// Modelo de datos de Grupos: defaults, ids, cálculo de promedio y validación de rubros.

import { uid } from './model.js';

export const ESTADOS_ASISTENCIA = ['presente', 'falta', 'retardo', 'justificada'];

export const ETIQUETAS_ESTADO_ASISTENCIA = {
  presente: 'Presente',
  falta: 'Falta',
  retardo: 'Retardo',
  justificada: 'Justificada',
};

// sesion = { uid, nombre } de quien lo crea.
export function nuevoGrupo(sesion) {
  const ahora = new Date().toISOString();
  return {
    id: uid('grupo'),
    profesorId: sesion ? sesion.uid : null,
    profesorNombre: sesion ? sesion.nombre : '',
    nombre: '',
    materia: '',
    grado: '',
    grupo: '',
    cicloEscolar: '',
    createdAt: ahora,
    updatedAt: ahora,
    alumnos: [],
    rubros: [],
    calificaciones: {},
  };
}

export function nuevoAlumno(nombre) {
  return { id: uid('al'), nombre: nombre.trim(), activo: true };
}

export function nuevoRubro(nombre = '', porcentaje = 0) {
  return { id: uid('rub'), nombre, porcentaje };
}

export function calificacionAlumno(grupo, alumnoId) {
  return grupo.calificaciones[alumnoId] || { valores: {}, extra: 0 };
}

export function sumaPorcentajes(grupo) {
  return (grupo.rubros || []).reduce((acc, r) => acc + (Number(r.porcentaje) || 0), 0);
}

export function validarRubros(grupo) {
  const avisos = [];
  if ((grupo.rubros || []).length === 0) return avisos;
  const suma = sumaPorcentajes(grupo);
  if (Math.abs(suma - 100) > 0.01) {
    avisos.push({ mensaje: `Los porcentajes de los rubros suman ${suma}%, deberían sumar 100%.` });
  }
  return avisos;
}

// promedio = Σ(valor_rubro × porcentaje/100) + extra ; escala 0-10.
// Rubros sin calificación capturada no cuentan (ni en el numerador ni en el denominador
// de porcentaje usado), para que el promedio parcial de mitad de ciclo tenga sentido.
export function calcularPromedio(grupo, alumnoId) {
  const cal = calificacionAlumno(grupo, alumnoId);
  let suma = 0;
  let porcentajeCapturado = 0;
  for (const rubro of grupo.rubros || []) {
    const valor = cal.valores[rubro.id];
    if (valor === null || valor === undefined || valor === '') continue;
    suma += (Number(valor) || 0) * (Number(rubro.porcentaje) || 0) / 100;
    porcentajeCapturado += Number(rubro.porcentaje) || 0;
  }
  const extra = Number(cal.extra) || 0;
  if (porcentajeCapturado === 0) return extra > 0 ? extra : null;
  // Suma acumulada de lo ya capturado (no se proyecta ni se rescala) — a mitad de
  // ciclo el promedio simplemente va creciendo conforme se capturan más rubros.
  return Math.round((suma + extra) * 100) / 100;
}

export function idAsistencia(grupoId, fechaISO) {
  return `${grupoId}_${fechaISO}`;
}

export function nuevaAsistencia(grupoId, fechaISO) {
  return { grupoId, fecha: fechaISO, registros: {}, updatedAt: new Date().toISOString() };
}

export function fechaHoyISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function fechaCortaMX(iso) {
  const [anio, mes, dia] = iso.split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${dia} ${meses[parseInt(mes, 10) - 1]}`;
}
