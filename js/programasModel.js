// Modelo de datos del "Programa de actividades académicas" (formato fijo de
// Dirección Técnica de Secundaria) — defaults e ids.

import { uid } from './model.js';

export const ETIQUETAS_TRIMESTRE = { 1: 'PRIMER TRIMESTRE', 2: 'SEGUNDO TRIMESTRE', 3: 'TERCER TRIMESTRE' };

// Interlineado del temario (fechas, contenidos y orientaciones). Se mide como en
// Word ("Múltiple"): 1 es una línea sencilla de Arial, que mide ~1.15 veces el
// tamaño de la letra. Vale 1 mientras el maestro no elija otro en el editor
// (interlineadoElegido): los programas que guardaron el 0.7 que hubo antes por
// defecto vuelven solos a 1.
export const INTERLINEADO_TEMARIO_POR_DEFECTO = 1;
export const TAMANO_TEMARIO_PT = 9.5;
const ALTO_LINEA_SENCILLA = 1.15;

// En la tabla de criterios, "Porcentaje" y "Porcentaje obtenido" solo necesitan
// el ancho de su título; todo lo demás es para el nombre del criterio. Debe
// coincidir con el ancho en css/programa.css (.tabla-criterios).
export const ANCHO_COLUMNA_PORCENTAJE_CM = 2;

// Texto de una columna del temario tal como se acomoda en la hoja: sin los
// renglones vacíos (Enter de más) del final, que no se ven pero sí ocupan alto.
// Los del principio y de en medio se respetan: sirven para alinear las columnas.
export function textoTemario(texto) {
  return String(texto || '').replace(/\s+$/, '');
}

export function interlineadoTemario(programa) {
  const v = Number(programa && programa.interlineadoTemario);
  const valido = Number.isFinite(v) && v >= 0.5 && v <= 3;
  return programa && programa.interlineadoElegido && valido ? v : INTERLINEADO_TEMARIO_POR_DEFECTO;
}

// Tamaño de letra de cada espacio del temario, a elegir en el editor. Sin
// elegir (o en programas guardados antes de que existiera) vale lo de siempre:
// 9.5 pt el texto y 9 pt la tabla de criterios.
export const COLUMNAS_TEMARIO = ['fechas', 'contenidos', 'orientaciones', 'criterios'];
export const TAMANOS_LETRA_TEMARIO = [7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12];
const TAMANO_CRITERIOS_PT = 9;

export function tamanoLetraTemario(programa, columna) {
  const v = Number(programa && programa.tamanosLetraTemario && programa.tamanosLetraTemario[columna]);
  if (TAMANOS_LETRA_TEMARIO.includes(v)) return v;
  return columna === 'criterios' ? TAMANO_CRITERIOS_PT : TAMANO_TEMARIO_PT;
}

// Alto exacto de cada renglón de una columna del temario, en píxeles: con un
// alto fijo el texto se puede repartir en varias hojas cortando siempre entre
// renglones. Cada columna usa el de su propio tamaño de letra.
export function altoLineaTemarioPx(programa, columna = 'contenidos') {
  return tamanoLetraTemario(programa, columna) * (96 / 72) * ALTO_LINEA_SENCILLA * interlineadoTemario(programa);
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
