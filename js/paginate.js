// Motor de paginación: arma las hojas (del tamaño de papel elegido en el examen) con el
// mismo render para pantalla e impresión, para que encabezados (completo en pág. 1, mini en
// pág. 2+) y numeración centrada sean exactos.

import { el, clear } from './dom.js';
import {
  numerarReactivos, subtotalSeccion, puntosDeclarados,
  ENCABEZADO_INGLES_DEFECTO, ENCABEZADO_OFICIAL_DEFECTO,
} from './model.js';
import { renderPreguntaBloques, renderLecturaBloques } from './questionTypes.js';
import { precargarImagenes, atributosTamano } from './imagenes.js';
import { ETIQUETAS_TRIMESTRE } from './programasModel.js';

const PX_POR_CM = 96 / 2.54;
const PADDING_CM = 1.8;
const MIN_RESTANTE_PARA_TITULO_CM = 4;

// Colchón que se le resta al alto útil de la hoja al empaquetar los bloques. La
// medición previa y el render final nunca coinciden al milímetro (redondeo a
// píxeles enteros, márgenes que colapsan entre bloques hermanos, diferencias de
// hinting de fuentes entre pantalla e impresora), y sin colchón un bloque que
// "cabe justo" termina desbordándose y lo recorta el overflow:hidden de .page.
const MARGEN_SEGURIDAD_CM = 0.25;

// Tamaños de hoja disponibles. El error que reportaban los maestros —hojas en
// blanco de más y contenido cortado en el PDF pero no en la vista previa— pasaba
// cuando el papel elegido en el diálogo de impresión no era el mismo con el que
// se armó la vista previa: la hoja de 33.02cm no cabía en una carta o A4, así que
// cada página se partía en dos (una con el contenido cortado y otra casi vacía).
// Con esto el maestro elige el papel, la vista previa se arma con esa medida y
// preview.js emite el @page correspondiente, así que siempre coinciden.
export const TAMANOS_PAPEL = {
  oficio: { etiqueta: 'Oficio / Folio (21.59 × 33.02 cm)', ancho: 21.59, alto: 33.02 },
  carta: { etiqueta: 'Carta (21.59 × 27.94 cm)', ancho: 21.59, alto: 27.94 },
  a4: { etiqueta: 'A4 (21 × 29.7 cm)', ancho: 21, alto: 29.7 },
};

export const PAPEL_POR_DEFECTO = 'oficio';

export function papelDeExamen(examen) {
  return TAMANOS_PAPEL[examen && examen.tamanoPapel] || TAMANOS_PAPEL[PAPEL_POR_DEFECTO];
}

// Todas las imágenes que van a aparecer en la hoja — hay que precargarlas antes
// de medir nada (ver js/imagenes.js).
function urlsDeImagenes(examen, config) {
  const urls = [config && config.logoDataUrl];
  for (const seccion of (examen && examen.secciones) || []) {
    for (const pregunta of seccion.preguntas || []) {
      urls.push(pregunta.imagen);
      for (const sub of pregunta.subpreguntas || []) urls.push(sub.imagen);
    }
  }
  return urls.filter(Boolean);
}

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

// El ciclo escolar se guarda en el examen para poder renovarlo sin tocar la
// configuración de la escuela (un examen reciclado del año pasado solo cambia
// aquí); si el examen no trae ninguno, se cae al de "Datos de la escuela".
export function cicloDeExamen(examen, config) {
  return (examen.meta && examen.meta.cicloEscolar) || (config && config.cicloEscolar) || '';
}

// Punto II del formato oficial: "Colocar el tipo de examen según corresponda
// (centrado)" — ejemplo: "EXAMEN PRIMER TRIMESTRE 2026-2027" / "TIPO A ó B".
function renderTituloExamenCentrado(examen, config, modoClave) {
  const trimestre = ETIQUETAS_TRIMESTRE[examen.meta.trimestre];
  const ciclo = cicloDeExamen(examen, config);
  const partes = ['EXAMEN'];
  if (trimestre) partes.push(trimestre);
  if (ciclo) partes.push(ciclo);
  return el('div', { class: 'titulo-examen-centrado' }, [
    el('div', {}, partes.join(' ')),
    el('div', {}, `TIPO ${examen.tipoExamen || 'A'}${modoClave ? ' — CLAVE DE RESPUESTAS' : ''}`),
  ]);
}

// Membrete oficial del formato normal (punto I): caja con borde, logo de la
// escuela a la izquierda y las siete líneas de la dependencia a la derecha.
function renderMembreteOficial(config) {
  const texto = config.encabezadoOficial || ENCABEZADO_OFICIAL_DEFECTO;
  return el('div', { class: 'membrete-oficial' }, [
    config.logoDataUrl ? el('img', { class: 'logo-escuela', src: config.logoDataUrl, ...atributosTamano(config.logoDataUrl) }) : null,
    el('div', { class: 'membrete-oficial-texto' }, texto.split('\n').map((linea) => el('div', {}, linea))),
  ]);
}

// Un campo del encabezado oficial: la etiqueta y su raya. El valor va escrito
// sobre la raya; los campos que se llenan a mano después de aplicar el examen
// (N.L., puntos obtenidos, porcentaje) se pasan vacíos y solo dejan la raya.
function campoLinea(etiqueta, valor, clase) {
  const texto = valor == null ? '' : String(valor);
  return el('span', { class: `campo-linea ${clase || ''}`.trim() }, [
    el('span', { class: 'etiqueta-campo' }, etiqueta),
    // Los campos vacíos llevan un espacio duro y no cadena vacía: un elemento
    // sin texto no tiene línea base propia, y la raya se iba de altura respecto
    // a su etiqueta en vez de quedar al ras.
    el('span', { class: 'valor-campo' }, texto || '\u00A0'),
  ]);
}

// Caja de datos del punto I, con las cuatro filas del formato oficial.
function renderCajaDatosOficial(examen) {
  const { meta } = examen;
  const numReactivos = Object.keys(numerarReactivos(examen)).length;
  return el('div', { class: 'caja-datos-oficial' }, [
    el('div', { class: 'fila-datos-oficial' }, [
      campoLinea('Nombre del alumno(a):', '', 'campo-ancho'),
      campoLinea('Grado:', meta.grado, 'campo-corto'),
      campoLinea('Grupo:', meta.grupo, 'campo-corto'),
      campoLinea('N.L.', '', 'campo-corto'),
    ]),
    el('div', { class: 'fila-datos-oficial' }, [
      campoLinea('Nombre del profesor(a):', meta.profesor, 'campo-ancho'),
      campoLinea('Disciplina:', meta.materia, 'campo-ancho'),
    ]),
    el('div', { class: 'fila-datos-oficial' }, [
      campoLinea('Fecha:', '', 'campo-fecha'),
      campoLinea('No. de reactivos:', numReactivos, 'campo-corto'),
      campoLinea('Total de puntos:', puntosDeclarados(examen), 'campo-corto'),
      campoLinea('Valor del examen:', meta.valorExamen, 'campo-medio'),
    ]),
    el('div', { class: 'fila-datos-oficial fila-datos-calificacion' }, [
      campoLinea('Puntos obtenidos:', '', 'campo-medio'),
      campoLinea('Porcentaje:', '', 'campo-medio'),
    ]),
  ]);
}

// Membrete oficial fijo (Gobierno del Estado de México…) que llevan los
// exámenes de inglés en vez del logo/nombre de la escuela.
function renderEncabezadoOficialIngles(config) {
  const texto = config.encabezadoIngles || ENCABEZADO_INGLES_DEFECTO;
  return el('div', { class: 'membrete-ingles' }, texto.split('\n').map((linea) => el('div', {}, linea)));
}

// Título libre centrado de los exámenes de inglés (ver meta.tituloIngles en
// model.js) + "TYPE A/B" en su propia línea, igual que en los formatos
// originales del maestro.
function renderTituloIngles(examen, modoClave) {
  const lineas = (examen.meta.tituloIngles || '').split('\n').filter((l) => l.trim());
  return el('div', { class: 'titulo-examen-centrado' }, [
    ...lineas.map((linea) => el('div', {}, linea)),
    el('div', {}, `TYPE ${examen.tipoExamen || 'A'}${modoClave ? ' — ANSWER KEY' : ''}`),
  ]);
}

// Instrucción general (punto III). El formato la pide siempre y con su etiqueta
// al frente, en negritas.
function renderInstruccionesGenerales(examen, esIngles) {
  if (!examen.instruccionesGenerales) return null;
  if (esIngles) return el('div', { class: 'instrucciones-generales' }, examen.instruccionesGenerales);
  return el('div', { class: 'instrucciones-generales' }, [
    el('span', { class: 'etiqueta-instrucciones' }, 'Instrucciones Generales: '),
    examen.instruccionesGenerales,
  ]);
}

function renderEncabezadoIngles(examen, config, modoClave) {
  const { meta } = examen;
  const filas = el('div', { class: 'encabezado-datos' }, [
    el('span', {}, `Grado: ${meta.grado || '____'}`),
    el('span', {}, `Grupo: ${meta.grupo || '____'}`),
    el('span', {}, 'N.L.: ______'),
    el('span', {}, `Asignatura: ${meta.materia || '____'}`),
    el('span', {}, `Fecha: ${meta.fecha || '____'}`),
  ]);
  const filaAlumno = el('div', { class: 'encabezado-alumno' }, [
    el('span', {}, 'Nombre del alumno (a): ______________________________________________'),
  ]);
  const filaProfesor = el('div', { class: 'encabezado-datos' }, [
    el('span', {}, `Profesor(a): ${meta.profesor || '____'}`),
    el('span', {}, `No. de reactivos: ${Object.keys(numerarReactivos(examen)).length}`),
    el('span', {}, `Valor del examen: ${meta.valorExamen}%`),
  ]);
  const filaCalificacion = el('div', { class: 'encabezado-datos' }, [
    el('span', {}, 'Puntos obtenidos: ______________'),
    el('span', {}, 'Porcentaje: ______________'),
  ]);
  return el('div', { class: 'encabezado-completo encabezado-ingles' }, [
    renderEncabezadoOficialIngles(config),
    el('div', { class: 'caja-datos-ingles' }, [filas, filaAlumno, filaProfesor, filaCalificacion]),
    renderTituloIngles(examen, modoClave),
    renderInstruccionesGenerales(examen, true),
  ]);
}

function renderEncabezadoCompleto(examen, config, modoClave) {
  if (examen.formato === 'ingles') return renderEncabezadoIngles(examen, config, modoClave);
  // Formato normal: puntos I, II y III de "Elaboración de exámenes" — membrete en
  // caja, caja de datos, título centrado y la instrucción general.
  return el('div', { class: 'encabezado-completo' }, [
    renderMembreteOficial(config),
    renderCajaDatosOficial(examen),
    renderTituloExamenCentrado(examen, config, modoClave),
    renderInstruccionesGenerales(examen, false),
  ]);
}

// Punto VI del formato oficial: en páginas 2+ va, en la esquina superior
// derecha, la materia y el grado — y, según el ejemplo, el tipo de examen en
// una segunda línea (ej. "ESP 1°" / "TIPO A o B").
function renderEncabezadoMini(examen, modoClave) {
  const esIngles = examen.formato === 'ingles';
  return el('div', { class: 'encabezado-mini' }, [
    el('div', { class: 'encabezado-mini-materia' }, [
      esIngles
        ? `${examen.meta.materia || ''} ${examen.meta.grado || ''}${examen.meta.grupo || ''}`.trim()
        : `${examen.meta.materia || ''} ${examen.meta.grado || ''}`.trim(),
      modoClave ? el('span', { class: 'etiqueta-clave-mini' }, esIngles ? ' — ANSWER KEY' : ' — CLAVE') : null,
    ]),
    el('div', { class: 'encabezado-mini-tipo' }, `${esIngles ? 'TYPE' : 'TIPO'} ${examen.tipoExamen || 'A'}`),
  ]);
}

// Punto VI: la numeración va centrada y arriba, con el formato "- 2 -" del
// ejemplo oficial, encima del mini encabezado de materia/grado.
function renderNumeroPagina(numPagina) {
  return el('div', { class: 'numero-pagina' }, `- ${numPagina} -`);
}

// Los exámenes de inglés conservan su pie de siempre; el formato normal ya no
// lleva pie, porque su numeración se subió al encabezado.
function renderPie(numPagina, totalPaginas) {
  return el('div', { class: 'pie-pagina pie-pagina-ingles' }, `Page ${numPagina} of ${totalPaginas}`);
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
      bloques.push({ tipo: 'subtotal-seccion', el: renderValorSeccion(seccion) });
    }
  }
  // Los formatos de inglés que mandó el maestro no llevan firma del padre/tutor.
  if (examen.formato !== 'ingles') {
    bloques.push({ tipo: 'firma', el: renderFirma() });
  }
  return bloques;
}

function puntos(valor) {
  return `${valor} ${Math.abs(valor) === 1 ? 'punto' : 'puntos'}`;
}

// Punto IV: "Indicar en cada segmento el valor otorgado a cada reactivo y el
// total de cada sección". La línea del valor por reactivo solo tiene sentido
// cuando todos valen lo mismo; si no, se muestra únicamente el total.
function renderValorSeccion(seccion) {
  const valores = (seccion.preguntas || []).map((p) => (
    p.tipo === 'lectura_comprension'
      ? (p.subpreguntas || []).map((sp) => Number(sp.valor) || 0)
      : [Number(p.valor) || 0]
  )).flat();
  const uniforme = valores.length > 0 && valores.every((v) => v === valores[0]);
  return el('div', { class: 'subtotal-seccion' }, [
    uniforme ? el('div', {}, `Valor de cada reactivo: ${puntos(valores[0])}`) : null,
    el('div', {}, `Valor de la sección: ${puntos(subtotalSeccion(seccion))}`),
  ]);
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

export async function renderPaginas(examen, config, modoClave = false) {
  // Antes de medir nada: sin esto las imágenes miden 0 al medirlas y el
  // empaquetado mete de más en cada página (ver js/imagenes.js).
  await precargarImagenes(urlsDeImagenes(examen, config));

  const papel = papelDeExamen(examen);
  const anchoContenidoCm = papel.ancho - PADDING_CM * 2;
  const altoUtilPaginaCm = papel.alto - PADDING_CM * 2 - MARGEN_SEGURIDAD_CM;
  const altoUtilPaginaPx = altoUtilPaginaCm * PX_POR_CM;
  // Solo los exámenes de inglés siguen teniendo pie; en el formato normal ese
  // espacio se recupera para los reactivos.
  const altoPiePx = examen.formato === 'ingles' ? 0.9 * PX_POR_CM : 0;
  const minRestanteTituloPx = MIN_RESTANTE_PARA_TITULO_CM * PX_POR_CM;

  const medicion = el('div', {
    class: 'medicion-oculta',
    // Misma tipografía que .page (page.css) — si no coincide, lo medido aquí no
    // predice la altura real y el contenido se desborda y se recorta en la hoja.
    style: `position:absolute; visibility:hidden; left:-9999px; top:0; width:${cm(anchoContenidoCm)}; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.5;`,
  });
  document.body.appendChild(medicion);

  const esIngles = examen.formato === 'ingles';

  // El encabezado de cada hoja: en el formato normal arranca con la numeración
  // (punto VI) y sigue con el encabezado completo en la página 1 o el mini en
  // las demás. El número se pinta con un dígito de muestra al medir: todas las
  // variantes miden lo mismo de alto.
  function renderHeader(indicePagina, numPagina) {
    return el('div', { class: 'page-header' }, [
      esIngles ? null : renderNumeroPagina(numPagina),
      indicePagina === 0
        ? renderEncabezadoCompleto(examen, config, modoClave)
        : renderEncabezadoMini(examen, modoClave),
    ]);
  }

  const altoHeaderCompleto = medirAlto(renderHeader(0, 1), medicion);
  const altoHeaderMini = medirAlto(renderHeader(1, 1), medicion);

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
      renderHeader(i, i + 1),
      cuerpo,
      esIngles ? el('div', { class: 'page-footer' }, [renderPie(i + 1, totalPaginas)]) : null,
    ]);
  });
}
