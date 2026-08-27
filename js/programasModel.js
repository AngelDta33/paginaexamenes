// Modelo de datos del "Programa de actividades académicas" (formato fijo de
// Dirección Técnica de Secundaria) — defaults e ids.

import { uid } from './model.js';

export const ETIQUETAS_TRIMESTRE = { 1: 'PRIMER TRIMESTRE', 2: 'SEGUNDO TRIMESTRE', 3: 'TERCER TRIMESTRE' };

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
    orientacionesDidacticas: '',
    criterios: Array.from({ length: FILAS_CRITERIOS_INICIALES }, nuevoCriterio),
    evaluacionObtenida: '',
    observaciones: '',
  };
}

export function nuevoCriterioPrograma() {
  return nuevoCriterio();
}

export function totalPorcentajeCriterios(programa) {
  return (programa.criterios || []).reduce((acc, c) => acc + (Number(c.porcentaje) || 0), 0);
}
