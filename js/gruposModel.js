// Modelo de datos de Grupos: defaults, ids, cálculo de promedio y validación de rubros.

import { uid } from './model.js';

// Estados activos del pase de lista (sin "retardo": se quitó a pedido de la escuela).
// Los mapas de abajo conservan "retardo" para que grupos viejos con ese estado
// sigan mostrándose y calculando bien, aunque ya no se pueda asignar de nuevo.
export const ESTADOS_ASISTENCIA = ['presente', 'falta', 'justificada'];

export const ETIQUETAS_ESTADO_ASISTENCIA = {
  presente: 'Presente',
  falta: 'Falta',
  retardo: 'Retardo',
  justificada: 'Justificada',
};

export const INICIALES_ESTADO_ASISTENCIA = {
  presente: 'P', falta: 'F', retardo: 'R', justificada: 'J',
};

// Puntos que vale cada tipo de asistencia al calcular el promedio de asistencia
// (escala 0-1 por día). El maestro los puede cambiar por grupo.
export const VALORES_ASISTENCIA_POR_DEFECTO = {
  presente: 1, falta: 0, retardo: 0.5, justificada: 0.5,
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
    valoresAsistencia: { ...VALORES_ASISTENCIA_POR_DEFECTO },
  };
}

export function nuevoAlumno(nombre) {
  return { id: uid('al'), nombre: nombre.trim(), activo: true };
}

export function nuevoRubro(nombre = '', porcentaje = 0) {
  return { id: uid('rub'), nombre, porcentaje };
}

// Rubro especial: su calificación no se captura a mano, se calcula sola a partir
// del pase de lista (ver promedioAsistenciaAlumno).
export function nuevoRubroAsistencia(porcentaje = 0) {
  return {
    id: uid('rub'), nombre: 'Asistencia', porcentaje, tipoEspecial: 'asistencia',
  };
}

export function esRubroAsistencia(rubro) {
  return rubro.tipoEspecial === 'asistencia';
}

// Las 5 rúbricas estándar de la escuela (se generan con un botón). El porcentaje es
// un reparto sugerido que suma 100; el maestro lo puede cambiar cuando quiera.
export const RUBROS_ESTANDAR = [
  { nombre: 'Examen', porcentaje: 40 },
  { nombre: 'Tareas', porcentaje: 20 },
  { nombre: 'Actividades', porcentaje: 20 },
  { nombre: 'Proyectos', porcentaje: 10 },
  { nombre: 'Participación', porcentaje: 10 },
];

export function crearRubrosEstandar() {
  return RUBROS_ESTANDAR.map((r) => nuevoRubro(r.nombre, r.porcentaje));
}

// Una "evaluación" es una captura dentro de un rubro (ej. cada examen dentro del
// rubro "Examen"), con su propio porcentaje — igual que los rubros de la rúbrica.
// Su porcentaje se reparte solo entre el 100% junto con las demás evaluaciones del
// mismo rubro (ver redistribuirPorcentajesEvaluaciones) hasta que el maestro lo
// edite a mano, momento en el que queda fijo (porcentajeManual: true).
// totalAciertos (opcional): si se captura, la evaluación se califica por número de
// aciertos y el programa saca la calificación en base 10 automáticamente
// (calificación = aciertos / totalAciertos × 10). Si se deja vacío, se captura la
// calificación 0-10 directamente, como siempre.
export function nuevaEvaluacion(nombre, descripcion, fecha, totalAciertos = null) {
  return {
    id: uid('ev'), nombre, descripcion, fecha, porcentaje: 0, porcentajeManual: false,
    totalAciertos: totalAciertos && Number(totalAciertos) > 0 ? Number(totalAciertos) : null,
  };
}

// Evaluaciones guardadas antes de que existiera "porcentajeManual" no lo tienen —
// se asume que ya estaba fijado a mano si tiene un porcentaje distinto de 0 (esa
// era la única forma de ponerlo antes de este reparto automático).
function porcentajeEsManual(ev) {
  return ev.porcentajeManual === true || (ev.porcentajeManual === undefined && Number(ev.porcentaje) > 0);
}

// Reparte el 100% entre las evaluaciones de un rubro cuyo porcentaje no haya sido
// fijado a mano por el maestro, dejando intactas las que sí — se llama al agregar,
// eliminar, o justo después de que el maestro edite una a mano (para acomodar el
// resto). Si todas están fijadas a mano no hace nada (la suma la valida
// validarEvaluaciones aparte).
export function redistribuirPorcentajesEvaluaciones(rubro) {
  const evaluaciones = rubro.evaluaciones || [];
  const automaticas = evaluaciones.filter((ev) => !porcentajeEsManual(ev));
  if (automaticas.length === 0) return;
  const sumaManual = evaluaciones
    .filter((ev) => porcentajeEsManual(ev))
    .reduce((acc, ev) => acc + (Number(ev.porcentaje) || 0), 0);
  const restante = Math.max(0, 100 - sumaManual);
  const base = Math.floor((restante / automaticas.length) * 100) / 100;
  automaticas.forEach((ev, i) => {
    ev.porcentaje = i === automaticas.length - 1
      ? Math.round((restante - base * (automaticas.length - 1)) * 100) / 100
      : base;
  });
}

// Convierte el valor crudo capturado para un alumno en una evaluación a la
// calificación 0-10 que se usa para promediar: si la evaluación se califica por
// aciertos (totalAciertos), reescala aciertos → base 10; si no, el valor ya ES la
// calificación. Devuelve null cuando no hay nada capturado.
export function notaDeEvaluacion(ev, valorCrudo) {
  if (valorCrudo === null || valorCrudo === undefined || valorCrudo === '') return null;
  const n = Number(valorCrudo);
  if (!Number.isFinite(n)) return null;
  const total = Number(ev.totalAciertos) || 0;
  if (total > 0) return Math.max(0, Math.min(10, (n / total) * 10));
  return n;
}

export function tieneEvaluaciones(rubro) {
  return (rubro.evaluaciones || []).length > 0;
}

export function sumaPorcentajesEvaluaciones(rubro) {
  return (rubro.evaluaciones || []).reduce((acc, ev) => acc + (Number(ev.porcentaje) || 0), 0);
}

export function validarEvaluaciones(rubro) {
  const avisos = [];
  if (!tieneEvaluaciones(rubro)) return avisos;
  const suma = sumaPorcentajesEvaluaciones(rubro);
  if (Math.abs(suma - 100) > 0.01) {
    avisos.push({ mensaje: `Los porcentajes suman ${suma}%, deberían sumar 100%.` });
  }
  return avisos;
}

// Devuelve la calificación del alumno, completando campos que grupos guardados antes
// de que existiera "notasEvaluacion" no tienen — sin crear una entrada nueva en
// grupo.calificaciones si el alumno todavía no tiene ninguna.
export function calificacionAlumno(grupo, alumnoId) {
  const cal = grupo.calificaciones[alumnoId] || { valores: {}, extra: 0 };
  if (!cal.valores) cal.valores = {};
  if (!cal.notasEvaluacion) cal.notasEvaluacion = {};
  return cal;
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

// Calificación (0-10) que le toca a un rubro para un alumno, sin importar de dónde
// viene: asistencia (automático), detallado (promedio ponderado de sus evaluaciones,
// ej. varios exámenes) o manual (lo que el maestro capturó directo en la rúbrica).
// `dias` solo hace falta si hay algún rubro de tipo asistencia.
export function valorRubro(grupo, rubro, alumnoId, dias = []) {
  if (esRubroAsistencia(rubro)) return valorRubroAsistencia(grupo, alumnoId, dias);
  if (tieneEvaluaciones(rubro)) return valorRubroDetallado(grupo, rubro, alumnoId);
  const cal = calificacionAlumno(grupo, alumnoId);
  const v = cal.valores[rubro.id];
  return (v === null || v === undefined || v === '') ? null : Number(v);
}

// Valor (0-10) de un rubro detallado = Σ(nota_evaluación × %evaluación/100), igual
// que el promedio general con sus rubros. Si los % de las evaluaciones suman 100,
// el resultado ya queda en escala 0-10 sin necesidad de reescalar. Evaluaciones sin
// calificar para este alumno no cuentan (ni en la suma ni en el % capturado), para
// que el valor parcial de mitad de ciclo tenga sentido igual que en calcularPromedio.
export function valorRubroDetallado(grupo, rubro, alumnoId) {
  const cal = calificacionAlumno(grupo, alumnoId);
  let suma = 0;
  let porcentajeCapturado = 0;
  for (const ev of rubro.evaluaciones || []) {
    const nota = notaDeEvaluacion(ev, cal.notasEvaluacion[ev.id]);
    if (nota === null) continue;
    suma += nota * (Number(ev.porcentaje) || 0) / 100;
    porcentajeCapturado += Number(ev.porcentaje) || 0;
  }
  if (porcentajeCapturado === 0) return null;
  return suma;
}

// promedio = Σ(valor_rubro × porcentaje/100) + extra ; escala 0-10.
// Rubros sin calificación capturada no cuentan (ni en el numerador ni en el denominador
// de porcentaje usado), para que el promedio parcial de mitad de ciclo tenga sentido.
export function calcularPromedio(grupo, alumnoId, dias = []) {
  const cal = calificacionAlumno(grupo, alumnoId);
  let suma = 0;
  let porcentajeCapturado = 0;
  for (const rubro of grupo.rubros || []) {
    const valor = valorRubro(grupo, rubro, alumnoId, dias);
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

// Calificación (escala 0-10) que le toca al rubro de asistencia — el promedio de
// asistencia (0-1) escalado a 0-10, igual que se muestra en el pase de lista.
export function valorRubroAsistencia(grupo, alumnoId, dias) {
  const prom = promedioAsistenciaAlumno(grupo, alumnoId, dias);
  return prom === null ? null : prom * 10;
}

// Grupos creados antes de que existiera este campo no lo tienen guardado — se
// completa con los valores por defecto para no romperlos.
export function valoresAsistenciaDeGrupo(grupo) {
  return { ...VALORES_ASISTENCIA_POR_DEFECTO, ...(grupo.valoresAsistencia || {}) };
}

// Promedio de asistencia de un alumno (escala 0-1): promedio de los puntos de cada
// día que sí se marcó (los días sin marcar no cuentan, igual que las faltas).
export function promedioAsistenciaAlumno(grupo, alumnoId, dias) {
  const valores = valoresAsistenciaDeGrupo(grupo);
  const estados = [];
  for (const dia of dias) {
    const reg = dia.registros[alumnoId];
    if (reg && reg.estado) estados.push(reg.estado);
  }
  if (estados.length === 0) return null;
  const suma = estados.reduce((acc, e) => acc + (Number(valores[e]) ?? 0), 0);
  return suma / estados.length;
}

export function idAsistencia(grupoId, fechaISO) {
  return `${grupoId}_${fechaISO}`;
}

export function nuevaAsistencia(grupoId, fechaISO) {
  return { grupoId, fecha: fechaISO, registros: {}, updatedAt: new Date().toISOString() };
}

// Siempre con los componentes locales de la fecha, nunca con toISOString(): ese
// convierte a UTC y en México adelanta el día (una clase del lunes se guardaría
// como domingo).
export function fechaISO(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function fechaHoyISO() {
  return fechaISO(new Date());
}

export function fechaCortaMX(iso) {
  const [anio, mes, dia] = iso.split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${dia} ${meses[parseInt(mes, 10) - 1]}`;
}

// --- Calendario del curso (opcional): días de clase, ciclo escolar y, si el
// maestro quiere, trimestres — usado para dividir el pase de lista exportado a
// Excel en una tabla general y una tabla por trimestre. Nada de esto es
// obligatorio: un grupo sin calendario configurado sigue funcionando igual.
export const DIAS_SEMANA_NOMBRES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Grupos creados antes de que existiera este campo no lo tienen guardado.
export function calendarioDeGrupo(grupo) {
  return {
    diasClase: [], inicioCiclo: '', finCiclo: '', trimestres: [],
    ...(grupo.calendario || {}),
  };
}

export function nuevoTrimestre(nombre = '', inicio = '', fin = '') {
  return { id: uid('tri'), nombre, inicio, fin };
}

export const TRIMESTRES_ESTANDAR = ['Primer trimestre', 'Segundo trimestre', 'Tercer trimestre'];

export function crearTrimestresEstandar() {
  return TRIMESTRES_ESTANDAR.map((nombre) => nuevoTrimestre(nombre));
}

// Tope de días que puede generar un calendario de una sentada: un ciclo escolar
// de clases diarias no pasa de ~400. Es solo un seguro contra un "fin de ciclo"
// mal capturado (ej. 2099) que dispararía miles de escrituras.
const MAX_DIAS_GENERADOS = 400;

// Todas las fechas de clase que caen entre el inicio y el fin del ciclo, según
// los días de la semana marcados en el calendario del grupo. Es lo que alimenta
// el botón "Agregar días de clase" del pase de lista.
export function fechasDeClase(calendario) {
  const diasClase = calendario.diasClase || [];
  if (!calendario.inicioCiclo || !calendario.finCiclo || diasClase.length === 0) return [];

  const dias = new Set(diasClase.map(Number));
  const [anioIni, mesIni, diaIni] = calendario.inicioCiclo.split('-').map(Number);
  const [anioFin, mesFin, diaFin] = calendario.finCiclo.split('-').map(Number);
  const cursor = new Date(anioIni, mesIni - 1, diaIni);
  const fin = new Date(anioFin, mesFin - 1, diaFin);

  const fechas = [];
  while (cursor <= fin && fechas.length < MAX_DIAS_GENERADOS) {
    if (dias.has(cursor.getDay())) fechas.push(fechaISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return fechas;
}

// Fechas (ISO) de un arreglo de días de asistencia que caen dentro de un
// trimestre (comparación de strings "YYYY-MM-DD", válida porque son fechas ISO).
export function fechasEnTrimestre(fechas, trimestre) {
  if (!trimestre.inicio || !trimestre.fin) return [];
  return fechas.filter((f) => f >= trimestre.inicio && f <= trimestre.fin);
}
