// Motor de paginación: arma páginas tamaño Carta con el mismo render para pantalla e impresión,
// para que encabezados (completo en pág. 1, mini en pág. 2+) y numeración centrada sean exactos.

import { el, clear } from './dom.js';
import { numerarReactivos, subtotalSeccion, totalExamen } from './model.js';
import { renderPreguntaBloques, renderLecturaBloques } from './questionTypes.js';

const PX_POR_CM = 96 / 2.54;
const PAGINA_ANCHO_CM = 21.59; // oficio/folio 8.5×13"
const PAGINA_ALTO_CM = 33.02;
const PADDING_CM = 1.8;
const MIN_RESTANTE_PARA_TITULO_CM = 4;

function cm(valor) {
  return `${valor}cm`;
}

function renderTituloSeccion(seccion, indice) {
  const partes = [];
  if (seccion.titulo) partes.push(el('h3', { class: 'titulo-seccion' }, seccion.titulo));
  if (seccion.instrucciones) partes.push(el('p', { class: 'instrucciones-seccion' }, seccion.instrucciones));
  return el('div', { class: 'bloque-titulo-seccion' }, partes);
}

function renderFirma() {
  return el('div', { class: 'bloque-firma' }, [
    el('div', { class: 'linea-firma' }),
    el('div', { class: 'etiqueta-firma' }, 'Firma del padre, madre o tutor'),
  ]);
}

const ORDINALES_TRIMESTRE = { 1: 'PRIMER', 2: 'SEGUNDO', 3: 'TERCER' };

// Punto II del formato oficial: "Colocar el tipo de examen según corresponda
// (centrado)" — ejemplo: "EXAMEN PRIMER TRIMESTRE 2026-2027" / "TIPO A ó B".
function renderTituloExamenCentrado(examen, config) {
  const ordinal = ORDINALES_TRIMESTRE[Number(examen.meta.trimestre)];
  const partes = ['EXAMEN'];
  if (ordinal) partes.push(`${ordinal} TRIMESTRE`);
  if (config.cicloEscolar) partes.push(config.cicloEscolar);
  return el('div', { class: 'titulo-examen-centrado' }, [
    el('div', {}, partes.join(' ')),
    el('div', {}, `TIPO ${examen.tipoExamen || 'A'}`),
  ]);
}

function renderEncabezadoCompleto(examen, config, modoClave) {
  const { meta } = examen;
  const total = totalExamen(examen);
  const filas = el('div', { class: 'encabezado-datos' }, [
    el('span', {}, `Grado: ${meta.grado || '____'}`),
    el('span', {}, `Grupo: ${meta.grupo || '____'}`),
    el('span', {}, 'N.L.: ______'),
    el('span', {}, `Materia: ${meta.materia || '____'}`),
    el('span', {}, `Trimestre: ${meta.trimestre || '____'}`),
    el('span', {}, `Examen Tipo ${examen.tipoExamen || 'A'}`),
    el('span', {}, `Fecha: ${meta.fecha || '____'}`),
  ]);
  const filaAlumno = el('div', { class: 'encabezado-alumno' }, [
    el('span', {}, 'Nombre del alumno: ______________________________________________'),
  ]);
  const filaProfesor = el('div', { class: 'encabezado-datos' }, [
    el('span', {}, `Profesor(a): ${meta.profesor || '____'}`),
    el('span', {}, `No. de reactivos: ${Object.keys(numerarReactivos(examen)).length}`),
    el('span', {}, `Total de puntos: ${total}`),
    el('span', {}, `Valor del examen: ${meta.valorExamen}`),
  ]);
  const filaCalificacion = el('div', { class: 'encabezado-datos' }, [
    el('span', {}, 'Puntos obtenidos: ______________'),
    el('span', {}, 'Porcentaje: ______________'),
  ]);
  return el('div', { class: 'encabezado-completo' }, [
    el('div', { class: 'encabezado-escuela' }, [
      config.logoDataUrl ? el('img', { class: 'logo-escuela', src: config.logoDataUrl }) : null,
      el('div', { class: 'nombre-escuela-ciclo' }, [
        el('div', { class: 'nombre-escuela' }, config.nombreEscuela || ''),
        config.cicloEscolar ? el('div', { class: 'ciclo-escolar' }, `Ciclo escolar ${config.cicloEscolar}`) : null,
      ]),
      el('div', { class: 'titulo-tipo-doc' }, modoClave ? 'CLAVE DE RESPUESTAS' : 'EXAMEN'),
    ]),
    filas,
    filaAlumno,
    filaProfesor,
    filaCalificacion,
    renderTituloExamenCentrado(examen, config),
    examen.instruccionesGenerales ? el('div', { class: 'instrucciones-generales' }, examen.instruccionesGenerales) : null,
  ]);
}

// Punto VI del formato oficial: en páginas 2+ va, en la esquina superior
// derecha, la materia y el grado — y, según el ejemplo, el tipo de examen en
// una segunda línea (ej. "ESP 1°" / "TIPO A o B").
function renderEncabezadoMini(examen, modoClave) {
  return el('div', { class: 'encabezado-mini' }, [
    el('div', { class: 'encabezado-mini-materia' }, [
      `${examen.meta.materia || ''} ${examen.meta.grado || ''}${examen.meta.grupo || ''}`.trim(),
      modoClave ? el('span', { class: 'etiqueta-clave-mini' }, ' — CLAVE') : null,
    ]),
    el('div', { class: 'encabezado-mini-tipo' }, `TIPO ${examen.tipoExamen || 'A'}`),
  ]);
}

function renderPie(numPagina, totalPaginas) {
  return el('div', { class: 'pie-pagina' }, `Página ${numPagina} de ${totalPaginas}`);
}

function construirBloques(examen, modoClave) {
  const numeros = numerarReactivos(examen);
  const bloques = [];
  for (const seccion of examen.secciones || []) {
    if (seccion.titulo || seccion.instrucciones) {
      bloques.push({ tipo: 'titulo-seccion', el: renderTituloSeccion(seccion) });
    }
    if (subtotalSeccion(seccion) > 0 && (seccion.preguntas || []).length > 0) {
      // el subtotal se agrega visualmente después de las preguntas de la sección (ver abajo)
    }
    for (const p of seccion.preguntas || []) {
      if (p.tipo === 'lectura_comprension') {
        bloques.push(...renderLecturaBloques(p));
        for (const sp of p.subpreguntas || []) {
          bloques.push(...renderPreguntaBloques(sp, numeros[sp.id], modoClave));
        }
      } else {
        bloques.push(...renderPreguntaBloques(p, numeros[p.id], modoClave));
      }
    }
    if ((seccion.preguntas || []).length > 0) {
      bloques.push({ tipo: 'subtotal-seccion', el: el('div', { class: 'subtotal-seccion' }, `Subtotal: ${subtotalSeccion(seccion)} pts`) });
    }
  }
  bloques.push({ tipo: 'firma', el: renderFirma() });
  return bloques;
}

function medirAlto(elemento, contenedorMedicion) {
  contenedorMedicion.appendChild(elemento);
  // getBoundingClientRect() no incluye los márgenes externos del elemento — hay que
  // sumarlos a mano, si no, el empaquetado subestima el espacio real que ocupa cada
  // bloque (el margin-bottom entre reactivos, por ejemplo) y termina desbordando la hoja.
  const estilos = getComputedStyle(elemento);
  const alto = elemento.getBoundingClientRect().height
    + parseFloat(estilos.marginTop || 0)
    + parseFloat(estilos.marginBottom || 0);
  contenedorMedicion.removeChild(elemento);
  return alto;
}

export function renderPaginas(examen, config, modoClave = false) {
  const anchoContenidoCm = PAGINA_ANCHO_CM - PADDING_CM * 2;
  const altoUtilPaginaCm = PAGINA_ALTO_CM - PADDING_CM * 2;
  const altoUtilPaginaPx = altoUtilPaginaCm * PX_POR_CM;
  const altoPiePx = 0.9 * PX_POR_CM;
  const minRestanteTituloPx = MIN_RESTANTE_PARA_TITULO_CM * PX_POR_CM;

  const medicion = el('div', {
    class: 'medicion-oculta',
    // Misma tipografía que .page (page.css) — si no coincide, lo medido aquí no
    // predice la altura real y el contenido se desborda y se recorta en la hoja.
    style: `position:absolute; visibility:hidden; left:-9999px; top:0; width:${cm(anchoContenidoCm)}; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.5;`,
  });
  document.body.appendChild(medicion);

  const headerCompleto = renderEncabezadoCompleto(examen, config, modoClave);
  const altoHeaderCompleto = medirAlto(headerCompleto, medicion);
  const headerMiniMuestra = renderEncabezadoMini(examen, modoClave);
  const altoHeaderMini = medirAlto(headerMiniMuestra, medicion);

  const bloques = construirBloques(examen, modoClave);
  const alturas = bloques.map((b) => medirAlto(b.el, medicion));

  document.body.removeChild(medicion);

  // --- Empaquetado voraz ---
  const paginas = []; // cada una: { bloques: [...], esPrimera }
  let paginaActual = [];
  let altoAcumulado = 0;

  function alturaDisponible(indicePagina) {
    const altoHeader = indicePagina === 0 ? altoHeaderCompleto : altoHeaderMini;
    return altoUtilPaginaPx - altoHeader - altoPiePx;
  }

  function cerrarPagina() {
    if (paginaActual.length > 0) paginas.push(paginaActual);
    paginaActual = [];
    altoAcumulado = 0;
  }

  bloques.forEach((bloque, i) => {
    const altoBloque = alturas[i];
    const disponible = alturaDisponible(paginas.length);
    const cabeEnPaginaActual = altoAcumulado + altoBloque <= disponible;
    const esTituloYQuedaPoco = bloque.tipo === 'titulo-seccion' && (disponible - (altoAcumulado + altoBloque)) < minRestanteTituloPx;

    if (paginaActual.length > 0 && (!cabeEnPaginaActual || esTituloYQuedaPoco)) {
      cerrarPagina();
    }
    paginaActual.push(bloque);
    altoAcumulado += altoBloque;
  });
  cerrarPagina();
  if (paginas.length === 0) paginas.push([]);

  const totalPaginas = paginas.length;

  return paginas.map((bloquesPagina, i) => {
    const cuerpo = el('div', { class: 'page-body' }, bloquesPagina.map((b) => b.el));
    return el('div', { class: 'page' }, [
      el('div', { class: 'page-header' }, [i === 0 ? renderEncabezadoCompleto(examen, config, modoClave) : renderEncabezadoMini(examen, modoClave)]),
      cuerpo,
      el('div', { class: 'page-footer' }, [renderPie(i + 1, totalPaginas)]),
    ]);
  });
}
