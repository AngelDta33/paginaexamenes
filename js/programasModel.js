// Modelo de datos del "Programa de actividades académicas" (formato fijo de
// Dirección Técnica de Secundaria) — defaults e ids.

import { uid } from './model.js';

export const ETIQUETAS_TRIMESTRE = { 1: 'PRIMER TRIMESTRE', 2: 'SEGUNDO TRIMESTRE', 3: 'TERCER TRIMESTRE' };

// Interlineado del temario (fechas, contenidos y orientaciones). Se mide como en
// Word ("Múltiple"): 1 es una línea sencilla de Arial, que mide ~1.15 veces el
// tamaño de la letra; 0.7 es un temario compacto para que quepa en una hoja.
export const INTERLINEADO_TEMARIO_POR_DEFECTO = 0.7;
export const TAMANO_TEMARIO_PT = 9.5;
const ALTO_LINEA_SENCILLA = 1.15;

export function interlineadoTemario(programa) {
  const v = Number(programa && programa.interlineadoTemario);
  return Number.isFinite(v) && v >= 0.5 && v <= 3 ? v : INTERLINEADO_TEMARIO_POR_DEFECTO;
}

// Alto exacto de cada renglón del temario, en píxeles: con un alto fijo el texto
// se puede repartir en varias hojas cortando siempre entre renglones.
export function altoLineaTemarioPx(programa) {
  return TAMANO_TEMARIO_PT * (96 / 72) * ALTO_LINEA_SENCILLA * interlineadoTemario(programa);
}

// Número de filas de criterios con las que arranca un programa nuevo — el
// formato en Word trae 6 renglones en blanco listos para llenar.
const FILAS_CRITERIOS_INICIALES = 6;

function nuevoCriterio() {
  return { id: uid('crit'), nombre: '', porcentaje: '' };
}

// sesion = { uid, nombre } de quien lo crea — se guarda como dueño del programa.
export function nuevoPrograma(sesion) {
  const ahora = new Date().toISOString();
  return {
    id: uid('prog'),
    createdAt: ahora,
    updatedAt: ahora,
    profesorId: sesion ? sesion.uid : null,
    profesorNombre: sesion ? sesion.nombre : '',
    // Quién hizo el último cambio — se actualiza al guardar (ver programas.js).
    editadoPorId: sesion ? sesion.uid : null,
    editadoPorNombre: sesion ? sesion.nombre : '',
    disciplina: '',
    campoFormativo: '',
    trimestre: '1', // '1' | '2' | '3'
    // Tamaño de hoja (siempre horizontal) con el que se arma la vista previa y
    // se imprime, igual que en los exámenes — ver papelDePrograma en
    // js/programas.js. Los programas guardados antes de que existiera este
    // campo caen solos en carta, que era el fijo de antes.
    tamanoPapel: 'carta',
    cicloEscolar: '',
    profesor: '',
    grupos: '',
    fechasTrimestre: '',
    procesosDesarrollo: '',
    interlineadoTemario: INTERLINEADO_TEMARIO_POR_DEFECTO,
    orientacionesDidacticas: '',
    criterios: Array.from({ length: FILAS_CRITERIOS_INICIALES }, nuevoCriterio),
    evaluacionObtenida: '',
    observaciones: '',
    // Nombres al pie de la hoja. elaboro en null significa "usar el nombre del
    // profesor": se llena solo y sigue ese campo hasta que el maestro escribe
    // algo distinto (ver nombreElaboro). Los programas guardados antes de que
    // existieran estos campos tampoco lo traen y caen igual en null.
    elaboro: null,
    coordinadora: '',
  };
}

export function nombreElaboro(programa) {
  return typeof programa.elaboro === 'string' ? programa.elaboro : (programa.profesor || '');
}

// Copia completa de un programa (para armar el de otra materia a partir de uno
// ya llenado): mismo contenido, id nuevo y a nombre de quien lo duplica.
export function duplicarPrograma(programa, sesion) {
  const ahora = new Date().toISOString();
  return {
    ...JSON.parse(JSON.stringify(programa)),
    id: uid('prog'),
    createdAt: ahora,
    updatedAt: ahora,
    profesorId: sesion ? sesion.uid : null,
    profesorNombre: sesion ? sesion.nombre : '',
    editadoPorId: sesion ? sesion.uid : null,
    editadoPorNombre: sesion ? sesion.nombre : '',
    criterios: (programa.criterios || []).map((c) => ({ ...c, id: uid('crit') })),
  };
}

export function nuevoCriterioPrograma() {
  return nuevoCriterio();
}

export function totalPorcentajeCriterios(programa) {
  return (programa.criterios || []).reduce((acc, c) => acc + (Number(c.porcentaje) || 0), 0);
}
