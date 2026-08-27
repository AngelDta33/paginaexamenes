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
    mostrarPorcentaje: false,
    columnaPaseDeLista: null,
    paseDeListaOcultos: [],
    umbralDerechoExamen: UMBRAL_DERECHO_EXAMEN_POR_DEFECTO,
  };
}

export function nuevoAlumno(nombre) {
  return { id: uid('al'), nombre: nombre.trim(), activo: true };
}

export function nuevoRubro(nombre = '', porcentaje = 0) {
  return { id: uid('rub'), nombre, porcentaje };
}

// El rubro especial "Asistencia" (calificación calculada sola desde el pase de
// lista) ya no se puede crear: lo reemplazó la columna informativa de pase de
// lista de la rúbrica, que no califica y solo sirve para ver el 80% que da
// derecho a examen (ver columnasPaseDeLista). Esta función se queda para que las
// rúbricas que YA lo tenían lo sigan mostrando y contando en el promedio, igual
// que el estado "retardo" del pase de lista.
export function esRubroAsistencia(rubro) {
  return rubro.tipoEspecial === 'asistencia';
}

// Sin acentos y en minúsculas, para poder comparar nombres escritos a mano.
function normalizarNombre(texto) {
  return (texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Calificar por número de aciertos solo tiene sentido en los exámenes; en los
// demás rubros (tareas, participación, proyectos…) el maestro captura la
// calificación en base 10 directamente. Se decide por el nombre porque es lo
// único que distingue a un rubro de otro: el rubro estándar se llama "Examen" y
// así también entran "Exámenes", "Examen parcial", "Examen diagnóstico", etc.
export function esRubroExamen(rubro) {
  return normalizarNombre(rubro && rubro.nombre).includes('examen');
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

// --- Calificación final ---
// La escuela redondea el .5 hacia arriba SOLO a partir del 6: un 5.9 se queda en
// 5 (el redondeo nunca puede convertir un reprobado en aprobado), mientras que un
// 6.5 sí sube a 7 y un 6.4 baja a 6. Debajo del 6 siempre se trunca; del 6 en
// adelante es el redondeo normal.
//
// Es el ÚNICO lugar del programa donde se redondea: ni los rubros ni el promedio
// se tocan, para que el maestro siga viendo la calificación real antes del
// redondeo y solo la columna "Calificación Final" muestre la que va a boleta.
export function calificacionFinal(promedio) {
  if (promedio === null || promedio === undefined || promedio === '') return null;
  const n = Number(promedio);
  if (!Number.isFinite(n)) return null;
  return n < 6 ? Math.floor(n) : Math.round(n);
}

// --- Escala de despliegue: base 10 o porcentaje ---
// Todo se guarda SIEMPRE en base 10 (0-10). El recuadro "Mostrar como porcentaje"
// del grupo solo cambia cómo se ve y cómo se captura: un 8.5 se muestra "85%" y
// el maestro escribe 85 en vez de 8.5. Nunca cambia lo guardado, así que se puede
// prender y apagar cuantas veces quiera sin recalcular ni migrar nada.
export function usaPorcentaje(grupo) {
  return !!(grupo && grupo.mostrarPorcentaje);
}

// Texto de una calificación base 10 (o null) en la escala activa. `decimales` es
// el detalle que se quiere en base 10; en porcentaje se muestra uno menos, porque
// multiplicar por 10 ya corre el punto un lugar (8.75 → "87.5%", 8.5 → "85%").
export function formatearNota(valor, porcentaje, decimales = 2) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  if (!porcentaje) return n.toFixed(decimales);
  return `${(n * 10).toFixed(Math.max(0, decimales - 1))}%`;
}

// base 10 → el número que se muestra dentro de un <input> de captura, y de
// regreso, para que el maestro escriba en la misma escala que ve en la tabla.
export function notaAEscala(valor, porcentaje) {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return porcentaje ? Math.round(n * 1000) / 100 : n;
}

export function escalaANota(valor, porcentaje) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = parseFloat(valor);
  if (!Number.isFinite(n)) return null;
  return porcentaje ? Math.round((n / 10) * 1000) / 1000 : n;
}

// Tope y paso del <input> de calificación según la escala activa.
export function atributosInputNota(porcentaje) {
  return porcentaje ? { max: '100', step: '1' } : { max: '10', step: '0.1' };
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

// --- Columna(s) informativas de "Pase de lista" en la rúbrica ---
// NO cuentan para el promedio ni son un rubro: son una ayuda para ver de un
// vistazo qué alumno llega al 80% de asistencia y por lo tanto tiene derecho a
// examen. El maestro elige entre verlas por trimestre o una sola del ciclo
// completo (grupo.columnaPaseDeLista = 'trimestral' | 'ciclo' | null).
//
// Siempre se expresan en porcentaje, aunque el grupo esté en base 10: el umbral
// que le importa al maestro es "80% de asistencia", no "8 de 10".
//
// El 80% es el mínimo de la escuela, pero se puede cambiar por grupo desde el
// engranaje del modal de pase de lista: hay materias que piden otro porcentaje.
export const UMBRAL_DERECHO_EXAMEN_POR_DEFECTO = 80;

// Grupos creados antes de que existiera este campo no lo tienen guardado.
export function umbralDerechoExamen(grupo) {
  const n = Number(grupo && grupo.umbralDerechoExamen);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : UMBRAL_DERECHO_EXAMEN_POR_DEFECTO;
}

// Columnas que el maestro escondió una por una con su "✕", sin quitar el pase
// de lista completo de la rúbrica: se guardan por id de trimestre para que
// esconder el primer trimestre ya cerrado no se lleve también los otros dos.
// Vuelven a aparecer todas al elegir de nuevo la lista desde el modal.
export function columnasPaseDeListaOcultas(grupo) {
  const ocultas = grupo && grupo.paseDeListaOcultos;
  return Array.isArray(ocultas) ? ocultas : [];
}

export function columnasPaseDeLista(grupo, dias) {
  const modo = grupo && grupo.columnaPaseDeLista;
  if (modo === 'ciclo') return [{ id: 'ciclo', titulo: 'Pase de lista', dias }];
  if (modo !== 'trimestral') return [];
  const ocultas = columnasPaseDeListaOcultas(grupo);
  return trimestresConFechas(grupo).map((trimestre, i) => {
    const fechas = fechasEnTrimestre(dias.map((d) => d.fecha), trimestre);
    return {
      id: trimestre.id,
      titulo: trimestre.nombre || `Trimestre ${i + 1}`,
      dias: dias.filter((d) => fechas.includes(d.fecha)),
    };
  }).filter((col) => !ocultas.includes(col.id));
}

// Trimestres utilizables: los que tienen inicio y fin capturados (sin fechas no
// se puede saber qué días les tocan).
export function trimestresConFechas(grupo) {
  return (calendarioDeGrupo(grupo).trimestres || []).filter((t) => t.inicio && t.fin);
}

// Porcentaje de asistencia (0-100) de un alumno en un conjunto de días, o null si
// no hay ningún día marcado.
export function porcentajeAsistencia(grupo, alumnoId, dias) {
  const prom = promedioAsistenciaAlumno(grupo, alumnoId, dias);
  return prom === null ? null : prom * 100;
}
