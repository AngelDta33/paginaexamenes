// Modelo de las carpetas para organizar exámenes — solo agrupan visualmente
// en la lista, no tienen relación con los filtros (materia/tipo/estado/etc).

import { uid } from './model.js';

// sesion = { uid, nombre } de quien la crea — se guarda como dueña de la carpeta.
export function nuevaCarpeta(sesion, nombre) {
  return {
    id: uid('carp'),
    nombre: (nombre || '').trim() || 'Carpeta sin nombre',
    profesorId: sesion ? sesion.uid : null,
    profesorNombre: sesion ? sesion.nombre : '',
    createdAt: new Date().toISOString(),
  };
}
