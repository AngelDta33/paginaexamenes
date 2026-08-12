// Arma la vista previa (y lo que se imprime) a partir del motor de paginación.

import { clear } from './dom.js';
import { renderPaginas } from './paginate.js';

export function pintarVistaPrevia(contenedor, examen, config, modoClave = false) {
  clear(contenedor);
  const paginas = renderPaginas(examen, config, modoClave);
  paginas.forEach((pagina) => contenedor.appendChild(pagina));
}

export function imprimir(examen, modoClave = false) {
  const tituloOriginal = document.title;
  const sufijo = modoClave ? 'CLAVE' : 'Examen';
  document.title = `${sufijo}_${examen.meta.materia || 'materia'}_${examen.meta.grado || ''}${examen.meta.grupo || ''}_Tipo${examen.tipoExamen}`.replace(/\s+/g, '_');
  window.print();
  document.title = tituloOriginal;
}
