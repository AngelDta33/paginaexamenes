// Arma la vista previa (y lo que se imprime) a partir del motor de paginación.

import { el, clear } from './dom.js';
import { renderPaginas, papelDeExamen } from './paginate.js';

// renderPaginas es asíncrono (precarga las imágenes antes de medir), así que dos
// repintados seguidos —el maestro escribiendo— pueden terminar en desorden y
// dejar en pantalla el resultado del viejo. Cada contenedor lleva el número de
// repintado más reciente y solo ese se pinta.
const ultimoRepintado = new WeakMap();

export async function pintarVistaPrevia(contenedor, examen, config, modoClave = false) {
  const token = (ultimoRepintado.get(contenedor) || 0) + 1;
  ultimoRepintado.set(contenedor, token);

  // Las medidas de la hoja viven en variables CSS sobre el contenedor para que
  // page.css (.page) y el @page de la impresión salgan siempre del mismo dato.
  const papel = papelDeExamen(examen);
  contenedor.style.setProperty('--pagina-ancho', `${papel.ancho}cm`);
  contenedor.style.setProperty('--pagina-alto', `${papel.alto}cm`);

  const paginas = await renderPaginas(examen, config, modoClave);
  if (ultimoRepintado.get(contenedor) !== token) return; // llegó tarde: ya hay un repintado más nuevo

  clear(contenedor);
  paginas.forEach((pagina) => contenedor.appendChild(pagina));
}

// @page no acepta variables CSS, así que el tamaño de papel se inyecta como una
// hoja de estilo propia justo antes de imprimir. Si no coincide con el tamaño con
// el que se armó la vista previa, cada hoja se parte en dos al imprimir: una con
// el contenido cortado y otra casi en blanco.
function fijarTamanoPapelImpresion(papel) {
  let estilo = document.getElementById('estilo-papel-impresion');
  if (!estilo) {
    estilo = el('style', { id: 'estilo-papel-impresion' });
    document.head.appendChild(estilo);
  }
  estilo.textContent = `@media print { @page { size: ${papel.ancho}cm ${papel.alto}cm; margin: 0; } }`;
}

export function imprimir(examen, modoClave = false) {
  const contenedor = document.querySelector('.hoja-contenedor');
  if (!contenedor) return;

  fijarTamanoPapelImpresion(papelDeExamen(examen));

  const tituloOriginal = document.title;
  const sufijo = modoClave ? 'CLAVE' : 'Examen';
  document.title = `${sufijo}_${examen.meta.materia || 'materia'}_${examen.meta.grado || ''}${examen.meta.grupo || ''}_Tipo${examen.tipoExamen}`.replace(/\s+/g, '_');

  // Se saca la hoja del formulario y se cuelga directo de <body> mientras dura la
  // impresión. Antes se dejaba en su lugar y se ocultaba lo demás con
  // visibility:hidden, pero un elemento invisible SIGUE ocupando su espacio en el
  // layout: todo el editor seguía midiendo lo que mide y ese espacio se convertía
  // en páginas en blanco al final del PDF. Colgándola de <body> (y ocultando los
  // hermanos con display:none, ver page.css) no queda nada más que paginar, y de
  // paso la hoja deja de depender del position:sticky del panel de vista previa.
  const ancla = document.createComment('hoja-contenedor');
  const padre = contenedor.parentNode;
  padre.insertBefore(ancla, contenedor);
  const raiz = el('div', { class: 'raiz-impresion' }, [contenedor]);
  document.body.appendChild(raiz);
  const eraCompacta = contenedor.classList.contains('vista-compacta');
  contenedor.classList.remove('vista-compacta'); // el zoom de pantalla no va al papel

  let restaurado = false;
  function restaurar() {
    if (restaurado) return; // afterprint y el finally de abajo pueden llegar los dos
    restaurado = true;
    if (eraCompacta) contenedor.classList.add('vista-compacta');
    padre.insertBefore(contenedor, ancla);
    ancla.remove();
    raiz.remove();
    document.title = tituloOriginal;
  }

  // window.print() bloquea hasta que se cierra el diálogo en los navegadores de
  // escritorio; el afterprint queda como respaldo por si algún navegador no lo hace.
  window.addEventListener('afterprint', restaurar, { once: true });
  try {
    window.print();
  } finally {
    restaurar();
  }
}
