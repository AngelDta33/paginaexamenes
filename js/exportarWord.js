// Exporta un examen a Word (.docx) con el mismo contenido que la vista previa /
// PDF: encabezado oficial, secciones, reactivos, clave y firma. Un solo .docx
// sirve igual para Word 2021 y Word 365 — los dos usan el mismo formato (Office
// Open XML), no hay una versión distinta para cada uno.
//
// Lo que no puede ser idéntico al PDF: Word reparte las hojas por su cuenta (la
// paginación de la app no aplica aquí), y las rayas del encabezado se calculan
// midiendo el texto con la fuente del examen, así que pueden variar un poco si
// en la computadora donde se abra no está instalada esa fuente.
//
// Las fórmulas ($$...$$) se convierten a ecuaciones nativas de Word (LaTeX →
// MathML con KaTeX → OMML con mathml2omml), que el maestro puede editar en Word.
// Las librerías se cargan solo al exportar, para no hacer más lenta la app.

import {
  numerarReactivos, reactivosDe, subtotalSeccion, puntosDeclarados, valoresFilasRelacion,
  claveFilaRelacion, ENCABEZADO_OFICIAL_DEFECTO, ENCABEZADO_INGLES_DEFECTO,
} from './model.js';
import { papelDeExamen, estiloDocumentoDeExamen, cicloDeExamen } from './paginate.js';
import { ETIQUETAS_TRIMESTRE } from './programasModel.js';
import {
  shuffleDeterminista, letraOpcion, usaFormatoColumna, anchoDeImagen, offsetDeImagen, margenIzquierdoImagen,
} from './questionTypes.js';

const URL_DOCX = 'https://cdn.jsdelivr.net/npm/docx@9.8.1/+esm';
const URL_MML2OMML = 'https://cdn.jsdelivr.net/npm/mathml2omml@0.5.0/+esm';

let D = null; // la librería docx, cargada al primer uso
let mml2omml = null;

async function cargarLibrerias() {
  if (D) return;
  const [docx, conversor] = await Promise.all([import(URL_DOCX), import(URL_MML2OMML)]);
  D = docx;
  mml2omml = conversor.mml2omml;
}

// --- Unidades: Word mide en twips (1/1440"), los tamaños de letra en medios
// puntos y las imágenes en píxeles de 96 dpi. ---------------------------------
const PX_POR_CM = 96 / 2.54;
const tw = (cm) => Math.round(cm * (1440 / 2.54));
const pxDeCm = (cm) => Math.round(cm * PX_POR_CM);
const borde = (tamanoOctavosPt, color) => ({ style: D.BorderStyle.SINGLE, size: tamanoOctavosPt, color });
const SIN_BORDE = () => ({ style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' });

function primeraFuente(familiaCss) {
  return (familiaCss || 'Arial').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

function redondear(valor) {
  return Math.round(valor * 100) / 100;
}

function puntos(valor) {
  const v = redondear(valor);
  return `${v} ${Math.abs(v) === 1 ? 'punto' : 'puntos'}`;
}

// Mide un texto con la fuente del examen (canvas del navegador) para poder
// calcular dónde termina cada raya del encabezado.
let lienzoMedicion = null;
function anchoTextoCm(texto, pt, familiaCss, negrita = false) {
  lienzoMedicion = lienzoMedicion || document.createElement('canvas');
  const ctx = lienzoMedicion.getContext('2d');
  ctx.font = `${negrita ? 'bold ' : ''}${pt}pt ${familiaCss}`;
  return ctx.measureText(texto).width / PX_POR_CM;
}

// --- Texto con fórmulas --------------------------------------------------------

function ecuacion(latex) {
  try {
    const html = window.katex.renderToString(latex, { output: 'mathml', throwOnError: false });
    const mathml = html.match(/<math[\s\S]*<\/math>/)[0].replace(/<annotation[\s\S]*?<\/annotation>/g, '');
    // fromXmlString devuelve un envoltorio sin nombre: el <m:oMath> es su primer hijo.
    return D.ImportedXmlComponent.fromXmlString(mml2omml(mathml)).root[0];
  } catch (err) {
    return null;
  }
}

// Texto sin fórmulas: los saltos de línea se vuelven saltos de Word y las
// tabulaciones (la sangría que se pone con Tab en la lectura) tabulaciones reales.
function runsPlanos(texto, fmt) {
  return texto.split('\n').map((linea, i) => {
    const children = [];
    linea.split('\t').forEach((parte, j) => {
      if (j > 0) children.push(new D.Tab());
      if (parte) children.push(parte);
    });
    return new D.TextRun({ ...fmt, children, break: i > 0 ? 1 : undefined });
  });
}

function runsDeTexto(texto, fmt = {}) {
  if (!texto) return [];
  const runs = [];
  const regex = /\$\$([^$]+?)\$\$/g;
  let ultimo = 0;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    if (m.index > ultimo) runs.push(...runsPlanos(texto.slice(ultimo, m.index), fmt));
    runs.push(ecuacion(m[1]) || new D.TextRun({ ...fmt, text: `$$${m[1]}$$` }));
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) runs.push(...runsPlanos(texto.slice(ultimo), fmt));
  return runs;
}

// --- Imágenes -------------------------------------------------------------------

function cargarImagen(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer una imagen del examen.'));
    img.src = dataUrl;
  });
}

function bytesDeDataUrl(dataUrl) {
  const binario = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function tipoDeDataUrl(dataUrl) {
  const mime = (dataUrl.match(/^data:image\/([a-z+]+)/i) || [])[1] || 'png';
  if (mime === 'jpeg' || mime === 'jpg') return 'jpg';
  return ['png', 'gif', 'bmp'].includes(mime) ? mime : 'png';
}

// Mismas reglas que el CSS de la hoja: sin "modificar orientación", la imagen va
// a su tamaño natural sin pasar del ancho del texto ni de maxAltoCm; con ella,
// el ancho y la posición que eligió el maestro (ver aplicarAjusteImagen).
function medidasImagen(img, pregunta, anchoContenidoCm, maxAltoCm) {
  const naturalAncho = img.naturalWidth / PX_POR_CM;
  const naturalAlto = img.naturalHeight / PX_POR_CM;
  if (pregunta && pregunta.imagenModificar) {
    const porcentaje = anchoDeImagen(pregunta);
    const anchoCm = anchoContenidoCm * porcentaje / 100;
    return {
      anchoCm, altoCm: anchoCm * naturalAlto / naturalAncho,
      margenIzqCm: anchoContenidoCm * margenIzquierdoImagen(porcentaje, offsetDeImagen(pregunta)) / 100,
    };
  }
  const escala = Math.min(1, anchoContenidoCm / naturalAncho, maxAltoCm / naturalAlto);
  return { anchoCm: naturalAncho * escala, altoCm: naturalAlto * escala, margenIzqCm: 0 };
}

function parrafoDeImagen(dataUrl, { anchoCm, altoCm, margenIzqCm = 0 }, opciones = {}) {
  return new D.Paragraph({
    ...opciones,
    indent: margenIzqCm ? { left: tw(margenIzqCm) } : undefined,
    spacing: { before: tw(0.15), after: tw(0.15) },
    children: [new D.ImageRun({
      type: tipoDeDataUrl(dataUrl), data: bytesDeDataUrl(dataUrl),
      transformation: { width: pxDeCm(anchoCm), height: pxDeCm(altoCm) },
    })],
  });
}

// "Identificar en imagen": Word no puede encimar los números sobre la imagen como
// la página (posición absoluta), así que se dibujan sobre la imagen misma en un
// canvas, al tamaño con que se va a imprimir para que los círculos midan lo mismo.
async function imagenConMarcadores(pregunta, ordenExamen, medidas) {
  const img = await cargarImagen(pregunta.imagen);
  const escala = 3; // resolución de sobra para que se vea nítida impresa
  const ancho = Math.round(medidas.anchoCm * PX_POR_CM * escala);
  const alto = Math.round(medidas.altoCm * PX_POR_CM * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  ctx.drawImage(img, 0, 0, ancho, alto);
  const radio = (0.55 / 2) * PX_POR_CM * escala;
  ordenExamen.forEach((m, i) => {
    const x = (m.x / 100) * ancho;
    const y = (m.y / 100) * alto;
    ctx.beginPath();
    ctx.arc(x, y, radio, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1.2 * (96 / 72) * escala;
    ctx.strokeStyle = '#111';
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = `bold ${9 * (96 / 72) * escala}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + escala);
  });
  return lienzo.toDataURL('image/png');
}

// --- Piezas comunes -------------------------------------------------------------

// Párrafo vacío de alto exacto: la separación entre reactivos (el margin-bottom
// de .reactivo en la hoja).
function separador(cm) {
  return new D.Paragraph({ spacing: { before: 0, after: 0, line: tw(cm), lineRule: D.LineRuleType.EXACT } });
}

// "Empezar en una página nueva": un párrafo mínimo con salto de página antes.
function parrafoSalto() {
  return new D.Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT } });
}

function alineacion(ctx) {
  return ctx.justificar ? D.AlignmentType.JUSTIFIED : D.AlignmentType.LEFT;
}

// "N. enunciado (X pts)" — el renglón con que arranca casi todo reactivo.
function encabezadoReactivo(numero, pregunta, valor, ctx, extra = {}) {
  return new D.Paragraph({
    alignment: alineacion(ctx),
    indent: ctx.sangriaCm ? { firstLine: tw(ctx.sangriaCm) } : undefined,
    ...(extra.tabStops ? { tabStops: extra.tabStops } : {}),
    children: [
      new D.TextRun({ ...ctx.fmt, text: `${numero}. `, bold: true }),
      ...runsDeTexto(pregunta.enunciado || '', ctx.fmt),
      valor !== null ? new D.TextRun({ ...ctx.fmt, text: ` (${redondear(valor)} pts)`, color: '444444' }) : null,
      ...(extra.alFinal || []),
    ].filter(Boolean),
  });
}

async function bloqueImagen(pregunta, ctx) {
  if (!pregunta.imagen) return [];
  const img = await cargarImagen(pregunta.imagen);
  return [parrafoDeImagen(pregunta.imagen, medidasImagen(img, pregunta, ctx.anchoCm, 6))];
}

// --- Reactivos por tipo ---------------------------------------------------------

async function opcionMultiple(p, numeros, modoClave, ctx) {
  const elementos = [encabezadoReactivo(numeros[p.id], p, p.valor, ctx), ...(await bloqueImagen(p, ctx))];
  p.opciones.forEach((op, i) => {
    const correcta = modoClave && i === p.respuestaCorrecta;
    elementos.push(new D.Paragraph({
      indent: { left: tw(0.6) },
      spacing: { before: i === 0 ? tw(0.1) : tw(0.02), after: tw(0.02) },
      children: [new D.TextRun({ ...ctx.fmt, text: `${correcta ? '● ' : '○ '}${letraOpcion(i)}) `, bold: correcta }), ...runsDeTexto(op, { ...ctx.fmt, bold: correcta })],
    }));
  });
  return elementos;
}

async function relacionColumnas(p, numeros, modoClave, ctx) {
  const permutado = shuffleDeterminista(p.columnaB, p.id);
  const letraPorIndiceOriginal = {};
  permutado.forEach(([, idxOriginal], posMostrada) => { letraPorIndiceOriginal[idxOriginal] = letraOpcion(posMostrada); });
  const valores = valoresFilasRelacion(p);
  const elementos = [];
  if (p.enunciado) {
    elementos.push(new D.Paragraph({
      alignment: alineacion(ctx), indent: ctx.sangriaCm ? { firstLine: tw(ctx.sangriaCm) } : undefined,
      children: runsDeTexto(p.enunciado, ctx.fmt),
    }));
  }
  elementos.push(...(await bloqueImagen(p, ctx)));

  const anchoA = ctx.anchoCm * 0.55;
  const anchoB = ctx.anchoCm - anchoA;
  const celda = (ancho, children) => new D.TableCell({
    width: { size: tw(ancho), type: D.WidthType.DXA },
    margins: { left: tw(0.3), right: tw(0.3), top: tw(0.08), bottom: tw(0.08) },
    children: [new D.Paragraph({ children })],
  });
  const filas = [];
  const maxFilas = Math.max(p.columnaA.length, permutado.length);
  for (let i = 0; i < maxFilas; i++) {
    const a = i < p.columnaA.length ? [
      new D.TextRun({ ...ctx.fmt, text: modoClave ? `(${letraPorIndiceOriginal[p.relaciones[i]] || '?'}) ` : '(   ) ', font: 'Courier New', bold: modoClave }),
      new D.TextRun({ ...ctx.fmt, text: `${numeros[claveFilaRelacion(p.id, i)]}. `, bold: true }),
      ...runsDeTexto(p.columnaA[i], ctx.fmt),
      new D.TextRun({ ...ctx.fmt, text: ` (${redondear(valores[i])} pts)`, color: '444444' }),
    ] : [];
    const b = i < permutado.length ? [new D.TextRun({ ...ctx.fmt, text: `${letraOpcion(i)}. ` }), ...runsDeTexto(permutado[i][0], ctx.fmt)] : [];
    filas.push(new D.TableRow({ children: [celda(anchoA, a), celda(anchoB, b)] }));
  }
  if (filas.length) {
    elementos.push(new D.Table({
      width: { size: tw(ctx.anchoCm), type: D.WidthType.DXA },
      columnWidths: [tw(anchoA), tw(anchoB)],
      borders: { top: SIN_BORDE(), bottom: SIN_BORDE(), left: SIN_BORDE(), right: SIN_BORDE(), insideHorizontal: SIN_BORDE(), insideVertical: SIN_BORDE() },
      rows: filas,
    }));
  }
  const total = valores.reduce((acc, v) => acc + v, 0);
  elementos.push(new D.Paragraph({
    alignment: D.AlignmentType.RIGHT, spacing: { before: tw(0.1) },
    children: [new D.TextRun({ ...ctx.fmt, text: `Valor de la relación de columnas: ${puntos(total)}` })],
  }));
  return elementos;
}

// Una línea de respuesta: párrafo vacío de 0.7 cm con borde abajo (sin borde si
// el maestro eligió "líneas invisibles": queda el espacio sin el trazo). Word
// junta los párrafos seguidos con el mismo borde en un solo grupo y dibuja el de
// abajo solo al final del grupo; el borde "between" pone la raya entre cada uno.
function lineaRespuesta(p) {
  const raya = borde(4, '333333');
  return new D.Paragraph({
    spacing: { before: tw(0.1), after: 0, line: tw(0.7), lineRule: D.LineRuleType.EXACT },
    border: p.lineasInvisibles ? undefined : { bottom: raya, between: raya },
  });
}

function respuestaModelo(p, ctx) {
  return new D.Paragraph({
    shading: { type: D.ShadingType.CLEAR, fill: 'F4F4F4', color: 'auto' },
    spacing: { before: tw(0.1) },
    children: [
      new D.TextRun({ ...ctx.fmt, text: 'Respuesta modelo: ' }),
      ...(p.respuestaModelo ? runsDeTexto(p.respuestaModelo, ctx.fmt) : [new D.TextRun({ ...ctx.fmt, text: '(no se capturó respuesta modelo)' })]),
    ],
  });
}

async function abierta(p, numeros, modoClave, ctx) {
  if (usaFormatoColumna(p)) {
    // La línea se dibuja con un tabulador alineado al margen derecho y relleno
    // de guion bajo: arranca justo donde termina la pregunta, en el mismo renglón.
    const alFinal = modoClave
      ? [new D.TextRun({ ...ctx.fmt, text: '   Respuesta modelo: ' }), ...runsDeTexto(p.respuestaModelo || '(no se capturó)', ctx.fmt)]
      : [new D.TextRun({ ...ctx.fmt, children: [' ', new D.Tab()] })];
    const tabStops = [{ type: D.TabStopType.RIGHT, position: tw(ctx.anchoCm), leader: p.lineasInvisibles ? D.LeaderType.NONE : D.LeaderType.UNDERSCORE }];
    return [encabezadoReactivo(numeros[p.id], p, p.valor, ctx, { tabStops, alFinal }), ...(await bloqueImagen(p, ctx))];
  }
  const elementos = [encabezadoReactivo(numeros[p.id], p, p.valor, ctx), ...(await bloqueImagen(p, ctx))];
  if (modoClave) elementos.push(respuestaModelo(p, ctx));
  else for (let i = 0; i < (Number(p.lineasRespuesta) || 1); i++) elementos.push(lineaRespuesta(p));
  return elementos;
}

async function verdaderoFalso(p, numeros, modoClave, ctx) {
  const inV = p.formatoIngles ? 'T' : 'V';
  const marca = (correcta) => (modoClave && correcta ? '✔' : '   ');
  return [
    encabezadoReactivo(numeros[p.id], p, p.valor, ctx),
    ...(await bloqueImagen(p, ctx)),
    new D.Paragraph({
      indent: { left: tw(0.6) }, spacing: { before: tw(0.1) },
      children: [
        new D.TextRun({ ...ctx.fmt, text: `${inV} (${marca(p.respuestaCorrecta)})`, bold: modoClave && p.respuestaCorrecta }),
        new D.TextRun({ ...ctx.fmt, text: '        ' }),
        new D.TextRun({ ...ctx.fmt, text: `F (${marca(!p.respuestaCorrecta)})`, bold: modoClave && !p.respuestaCorrecta }),
      ],
    }),
  ];
}

async function identificarImagen(p, numeros, modoClave, ctx) {
  const marcadores = p.marcadores || [];
  const activas = marcadores.filter((m) => m.activo !== false);
  // Mismas semillas que renderIdentificarImagenBloques: números y banco quedan
  // igual que en el PDF, y el examen y la clave siempre coinciden.
  const ordenExamen = shuffleDeterminista(marcadores, `${p.id}#orden`).map(([m]) => m);
  const elementos = [encabezadoReactivo(numeros[p.id], p, p.valor, ctx)];
  if (p.imagen) {
    const img = await cargarImagen(p.imagen);
    const medidas = medidasImagen(img, p, ctx.anchoCm, 9);
    elementos.push(parrafoDeImagen(await imagenConMarcadores(p, ordenExamen, medidas), medidas));
  }
  if (!modoClave && activas.length) {
    const permutado = shuffleDeterminista(activas.map((m) => m.etiqueta), `${p.id}#banco`);
    const palabras = [];
    permutado.forEach(([et], i) => {
      if (i > 0) palabras.push(new D.TextRun({ ...ctx.fmt, text: '    ' }));
      palabras.push(new D.TextRun({ ...ctx.fmt, text: ` ${et || '—'} `, border: borde(4, '666666') }));
    });
    elementos.push(new D.Paragraph({
      border: { top: borde(4, '999999'), bottom: borde(4, '999999'), left: borde(4, '999999'), right: borde(4, '999999') },
      shading: { type: D.ShadingType.CLEAR, fill: 'FAFAFA', color: 'auto' },
      spacing: { before: tw(0.15), after: tw(0.15) },
      children: palabras,
    }));
  }
  ordenExamen.forEach((m, i) => {
    elementos.push(new D.Paragraph({
      indent: { left: tw(0.4) }, spacing: { before: i === 0 ? tw(0.15) : 0, after: tw(0.12) },
      tabStops: [{ type: D.TabStopType.RIGHT, position: tw(ctx.anchoCm), leader: D.LeaderType.UNDERSCORE }],
      children: [
        new D.TextRun({ ...ctx.fmt, text: `${i + 1}. `, bold: true }),
        modoClave
          ? new D.TextRun({ ...ctx.fmt, text: m.etiqueta || '(sin nombre)', bold: true })
          : new D.TextRun({ ...ctx.fmt, children: [new D.Tab()] }),
      ],
    }));
  });
  return elementos;
}

const CONSTRUCTORES = {
  opcion_multiple: opcionMultiple,
  relacion_columnas: relacionColumnas,
  abierta,
  verdadero_falso: verdaderoFalso,
  identificar_imagen: identificarImagen,
};

// El recuadro del texto de lectura: un párrafo por línea, todos con el mismo
// borde y fondo — Word une párrafos seguidos con bordes iguales en una sola caja.
function lectura(p, ctx) {
  const elementos = [];
  if (p.enunciado) {
    elementos.push(new D.Paragraph({ spacing: { after: tw(0.15) }, children: runsDeTexto(p.enunciado, { ...ctx.fmt, italics: true }) }));
  }
  const caja = { top: borde(4, '999999'), bottom: borde(4, '999999'), left: borde(4, '999999'), right: borde(4, '999999') };
  (p.textoLectura || '').split('\n').forEach((linea) => {
    elementos.push(new D.Paragraph({
      border: caja,
      shading: { type: D.ShadingType.CLEAR, fill: 'FAFAFA', color: 'auto' },
      alignment: alineacion(ctx),
      indent: ctx.sangriaCm ? { firstLine: tw(ctx.sangriaCm) } : undefined,
      children: linea ? runsDeTexto(linea, ctx.fmt) : [],
    }));
  });
  elementos.push(separador(0.3));
  return elementos;
}

async function reactivo(p, numeros, modoClave, ctx) {
  const constructor = CONSTRUCTORES[p.tipo] || abierta;
  const elementos = await constructor(p, numeros, modoClave, ctx);
  return [...(p.saltoPagina ? [parrafoSalto()] : []), ...elementos, separador(0.45)];
}

// --- Encabezado -----------------------------------------------------------------

// Un renglón de la caja de datos (ver .fila-datos-oficial en page.css): cada
// campo es su etiqueta y una raya. Las rayas "medio" y "ancho" se estiran con el
// espacio que sobra del renglón; las demás se quedan en su mínimo. En Word la
// raya es un tabulador con relleno de guion bajo hasta donde termina el campo, y
// el valor impreso (grado, grupo…) va subrayado al inicio de esa raya.
function filaDeCampos(campos, { anchoCm, inicioCm = 0, fmt, pt, familiaCss }) {
  const SEPARACION = 0.4;
  const MINIMO = { corto: 1, medio: 1.2, ancho: 3, fecha: 2, fijo: 3 };
  const crece = (tipo) => tipo === 'medio' || tipo === 'ancho';
  const medidos = campos.map((c) => ({
    ...c,
    etiquetaCm: anchoTextoCm(`${c.etiqueta} `, pt, familiaCss),
    valorCm: Math.max(MINIMO[c.tipo], c.valor ? anchoTextoCm(String(c.valor), pt, familiaCss) + 0.3 : 0),
  }));
  const usado = inicioCm + medidos.reduce((acc, c) => acc + c.etiquetaCm + c.valorCm, 0) + SEPARACION * (campos.length - 1);
  const cuantosCrecen = medidos.filter((c) => crece(c.tipo)).length;
  const extra = cuantosCrecen ? Math.max(0, anchoCm - usado) / cuantosCrecen : 0;

  const tabStops = [];
  const children = [];
  let x = inicioCm;
  if (inicioCm) {
    tabStops.push({ type: D.TabStopType.LEFT, position: tw(inicioCm) });
    children.push(new D.TextRun({ ...fmt, children: [new D.Tab()] }));
  }
  medidos.forEach((c, i) => {
    if (i > 0) {
      x += SEPARACION;
      tabStops.push({ type: D.TabStopType.LEFT, position: tw(x) });
      children.push(new D.TextRun({ ...fmt, children: [new D.Tab()] }));
    }
    children.push(new D.TextRun({ ...fmt, text: `${c.etiqueta} ` }));
    if (c.valor !== '' && c.valor != null) children.push(new D.TextRun({ ...fmt, text: String(c.valor), underline: { type: D.UnderlineType.SINGLE } }));
    x += c.etiquetaCm + c.valorCm + (crece(c.tipo) ? extra : 0);
    tabStops.push({ type: D.TabStopType.LEFT, position: tw(x), leader: D.LeaderType.UNDERSCORE });
    children.push(new D.TextRun({ ...fmt, children: [new D.Tab()] }));
  });
  return new D.Paragraph({ tabStops, children, spacing: { before: tw(0.1), after: tw(0.1), line: 240 } });
}

async function encabezadoOficial(examen, config, ctx) {
  const pt = 10;
  const fmt = { ...ctx.fmtBase, size: pt * 2 };
  const texto = (config.encabezadoOficial || ENCABEZADO_OFICIAL_DEFECTO).split('\n');
  const parrafosMembrete = texto.map((linea) => new D.Paragraph({ spacing: { before: 0, after: 0, line: 300 }, children: [new D.TextRun({ ...fmt, text: linea })] }));

  let anchoLogo = 0;
  let celdaLogo = null;
  if (config.logoDataUrl) {
    const img = await cargarImagen(config.logoDataUrl);
    const altoCm = 2.1;
    const anchoCm = altoCm * img.naturalWidth / img.naturalHeight;
    anchoLogo = anchoCm + 0.45;
    celdaLogo = new D.TableCell({
      width: { size: tw(anchoLogo + 0.35), type: D.WidthType.DXA },
      verticalAlign: D.VerticalAlign.CENTER,
      margins: { left: tw(0.35), right: 0, top: tw(0.15), bottom: tw(0.15) },
      children: [parrafoDeImagen(config.logoDataUrl, { anchoCm, altoCm }, { spacing: { before: 0, after: 0 } })],
    });
  }
  const anchoTotal = ctx.anchoCm;
  const anchoTexto = anchoTotal - (celdaLogo ? anchoLogo + 0.35 : 0);
  const celdaTexto = new D.TableCell({
    width: { size: tw(anchoTexto), type: D.WidthType.DXA },
    verticalAlign: D.VerticalAlign.CENTER,
    margins: { left: tw(celdaLogo ? 0 : 0.35), right: tw(0.35), top: tw(0.15), bottom: tw(0.15) },
    children: parrafosMembrete,
  });

  const { meta } = examen;
  const anchoFilas = anchoTotal - 0.7;
  const opcionesFila = { anchoCm: anchoFilas, fmt, pt, familiaCss: ctx.familiaCss };
  const filasDatos = [
    filaDeCampos([
      { etiqueta: 'Nombre del alumno(a):', valor: '', tipo: 'ancho' },
      { etiqueta: 'Grado:', valor: meta.grado, tipo: 'corto' },
      { etiqueta: 'Grupo:', valor: meta.grupo, tipo: 'corto' },
      { etiqueta: 'N.L.', valor: '', tipo: 'corto' },
    ], opcionesFila),
    filaDeCampos([
      { etiqueta: 'Nombre del profesor(a):', valor: meta.profesor, tipo: 'ancho' },
      { etiqueta: 'Disciplina:', valor: meta.materia, tipo: 'ancho' },
    ], opcionesFila),
    filaDeCampos([
      { etiqueta: 'Fecha:', valor: '', tipo: 'fecha' },
      { etiqueta: 'No. de reactivos:', valor: Object.keys(numerarReactivos(examen)).length, tipo: 'corto' },
      { etiqueta: 'Total de puntos:', valor: puntosDeclarados(examen), tipo: 'corto' },
      { etiqueta: 'Valor del examen:', valor: meta.valorExamen, tipo: 'medio' },
    ], opcionesFila),
    filaDeCampos([
      { etiqueta: 'Puntos obtenidos:', valor: '', tipo: 'fijo' },
      { etiqueta: 'Porcentaje:', valor: '', tipo: 'fijo' },
    ], { ...opcionesFila, inicioCm: 2.2 }),
  ];
  const columnas = celdaLogo ? [tw(anchoLogo + 0.35), tw(anchoTexto)] : [tw(anchoTotal)];
  const linea = borde(8, '111111');
  return new D.Table({
    width: { size: tw(anchoTotal), type: D.WidthType.DXA },
    columnWidths: columnas,
    borders: { top: linea, bottom: linea, left: linea, right: linea, insideHorizontal: linea, insideVertical: SIN_BORDE() },
    rows: [
      new D.TableRow({ children: celdaLogo ? [celdaLogo, celdaTexto] : [celdaTexto] }),
      new D.TableRow({
        children: [new D.TableCell({
          width: { size: tw(anchoTotal), type: D.WidthType.DXA },
          columnSpan: columnas.length,
          margins: { left: tw(0.35), right: tw(0.35), top: tw(0.15), bottom: tw(0.15) },
          children: filasDatos,
        })],
      }),
    ],
  });
}

function encabezadoIngles(examen, config, ctx) {
  const fmtChico = { ...ctx.fmtBase, size: 20 };
  const { meta } = examen;
  const espacio = ' '.repeat(6);
  const renglon = (partes) => new D.Paragraph({ spacing: { before: tw(0.1), after: tw(0.1), line: 240 }, children: [new D.TextRun({ ...fmtChico, text: partes.join(espacio) })] });
  const membrete = (config.encabezadoIngles || ENCABEZADO_INGLES_DEFECTO).split('\n')
    .map((linea) => new D.Paragraph({ spacing: { before: 0, after: 0, line: 324 }, children: [new D.TextRun({ ...ctx.fmtBase, size: 18, text: linea })] }));
  const linea = borde(8, '111111');
  const celda = (children) => new D.TableCell({
    width: { size: tw(ctx.anchoCm), type: D.WidthType.DXA },
    margins: { left: tw(0.35), right: tw(0.35), top: tw(0.15), bottom: tw(0.1) },
    children,
  });
  return new D.Table({
    width: { size: tw(ctx.anchoCm), type: D.WidthType.DXA },
    columnWidths: [tw(ctx.anchoCm)],
    borders: { top: linea, bottom: linea, left: linea, right: linea, insideHorizontal: linea, insideVertical: SIN_BORDE() },
    rows: [
      new D.TableRow({ children: [celda(membrete)] }),
      new D.TableRow({
        children: [celda([
          renglon([`Grado: ${meta.grado || '____'}`, `Grupo: ${meta.grupo || '____'}`, 'N.L.: ______', `Asignatura: ${meta.materia || '____'}`, `Fecha: ${meta.fecha || '____'}`]),
          renglon(['Nombre del alumno (a): ______________________________________________']),
          renglon([`Profesor(a): ${meta.profesor || '____'}`, `No. de reactivos: ${Object.keys(numerarReactivos(examen)).length}`, `Valor del examen: ${meta.valorExamen}%`]),
          renglon(['Puntos obtenidos: ______________', 'Porcentaje: ______________']),
        ])],
      }),
    ],
  });
}

function tituloCentrado(lineas, ctx, tamanoPt) {
  return lineas.map((texto, i) => new D.Paragraph({
    alignment: D.AlignmentType.CENTER,
    spacing: { before: i === 0 ? tw(0.35) : 0, after: 0 },
    children: [new D.TextRun({ ...ctx.fmtBase, ...(tamanoPt ? { size: tamanoPt * 2 } : {}), text: texto, bold: true })],
  }));
}

function instruccionesGenerales(examen, esIngles, ctx) {
  if (!examen.instruccionesGenerales) return [];
  if (esIngles) {
    return [new D.Paragraph({ spacing: { before: tw(0.3) }, children: runsPlanos(examen.instruccionesGenerales, { ...ctx.fmtBase, size: 20, italics: true }) })];
  }
  return [new D.Paragraph({
    alignment: D.AlignmentType.JUSTIFIED,
    spacing: { before: tw(0.3) },
    indent: ctx.sangriaCm ? { firstLine: tw(ctx.sangriaCm) } : undefined,
    children: [new D.TextRun({ ...ctx.fmtBase, text: 'Instrucciones Generales: ', bold: true }), ...runsPlanos(examen.instruccionesGenerales, ctx.fmtBase)],
  })];
}

// Hojas 2 en adelante (la 1 lleva el encabezado completo en el cuerpo).
function encabezadoMini(examen, modoClave, ctx) {
  const esIngles = examen.formato === 'ingles';
  const fmt = { ...ctx.fmtBase, size: 20 };
  const materia = esIngles
    ? `${examen.meta.materia || ''} ${examen.meta.grado || ''}${examen.meta.grupo || ''}`.trim()
    : `${examen.meta.materia || ''} ${examen.meta.grado || ''}`.trim();
  const parrafos = [];
  if (!esIngles) {
    parrafos.push(new D.Paragraph({
      alignment: D.AlignmentType.CENTER, spacing: { after: tw(0.15) },
      children: [new D.TextRun({ ...ctx.fmtBase, children: ['- ', D.PageNumber.CURRENT, ' -'] })],
    }));
  }
  parrafos.push(new D.Paragraph({
    alignment: D.AlignmentType.RIGHT,
    children: [
      new D.TextRun({ ...fmt, text: materia }),
      modoClave ? new D.TextRun({ ...fmt, text: esIngles ? ' — ANSWER KEY' : ' — CLAVE', bold: true }) : null,
    ].filter(Boolean),
  }));
  parrafos.push(new D.Paragraph({
    alignment: D.AlignmentType.RIGHT,
    border: { bottom: borde(4, '999999') },
    spacing: { after: tw(0.2) },
    children: [new D.TextRun({ ...fmt, text: `${esIngles ? 'TYPE' : 'TIPO'} ${examen.tipoExamen || 'A'}`, bold: true })],
  }));
  return new D.Header({ children: parrafos });
}

function pieIngles(ctx) {
  return new D.Footer({
    children: [new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      children: [new D.TextRun({ ...ctx.fmtBase, size: 18, color: '444444', children: ['Page ', D.PageNumber.CURRENT, ' of ', D.PageNumber.TOTAL_PAGES] })],
    })],
  });
}

function valorDeSeccion(seccion, ctx) {
  const valores = (seccion.preguntas || []).flatMap((p) => reactivosDe(p).map((r) => r.valor));
  const uniforme = valores.length > 0 && valores.every((v) => v === valores[0]);
  const renglon = (texto) => new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ ...ctx.fmt, text: texto, bold: true })] });
  return [
    ...(uniforme ? [renglon(`Valor de cada reactivo: ${puntos(valores[0])}`)] : []),
    renglon(`Valor de la sección: ${puntos(subtotalSeccion(seccion))}`),
    separador(0.35),
  ];
}

function firma(ctx) {
  const lateral = Math.max(0, (ctx.anchoCm - 8) / 2);
  return [
    separador(1),
    new D.Paragraph({ indent: { left: tw(lateral), right: tw(lateral) }, border: { bottom: borde(4, '333333') }, children: [] }),
    new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: tw(0.1) }, children: [new D.TextRun({ ...ctx.fmtBase, text: 'Firma del padre, madre o tutor' })] }),
  ];
}

// --- Documento completo ---------------------------------------------------------

export async function exportarExamenWord(examen, config, modoClave) {
  await cargarLibrerias();
  const esIngles = examen.formato === 'ingles';
  const papel = papelDeExamen(examen);
  const estilo = estiloDocumentoDeExamen(examen, config);
  const fuente = primeraFuente(estilo.familia);
  const fmtBase = { font: fuente, size: Math.round(estilo.tamano * 2) };
  const ctxBase = {
    anchoCm: papel.ancho - 2 * estilo.margenCm,
    familiaCss: estilo.familia,
    fmtBase,
    fmt: fmtBase,
    justificar: estilo.ajuste === 'justificado',
    sangriaCm: estilo.sangriaCm,
  };
  const numeros = numerarReactivos(examen);

  const cuerpo = [];
  if (esIngles) {
    cuerpo.push(encabezadoIngles(examen, config, ctxBase));
    const titulo = (examen.meta.tituloIngles || '').split('\n').filter((l) => l.trim());
    cuerpo.push(...tituloCentrado([...titulo, `TYPE ${examen.tipoExamen || 'A'}${modoClave ? ' — ANSWER KEY' : ''}`], ctxBase, 12));
  } else {
    cuerpo.push(await encabezadoOficial(examen, config, ctxBase));
    const trimestre = ETIQUETAS_TRIMESTRE[examen.meta.trimestre];
    const ciclo = cicloDeExamen(examen, config);
    cuerpo.push(...tituloCentrado([
      ['EXAMEN', trimestre, ciclo].filter(Boolean).join(' '),
      `TIPO ${examen.tipoExamen || 'A'}${modoClave ? ' — CLAVE DE RESPUESTAS' : ''}`,
    ], ctxBase));
  }
  cuerpo.push(...instruccionesGenerales(examen, esIngles, ctxBase));
  cuerpo.push(separador(0.4));

  for (const seccion of examen.secciones || []) {
    // Formato de la sección que haya puesto el administrador (ver aplicarEstiloSeccion).
    const e = seccion.estilo || {};
    const ctx = {
      ...ctxBase,
      fmt: { ...fmtBase, ...(e.familia ? { font: primeraFuente(e.familia) } : {}), ...(e.tamano ? { size: Number(e.tamano) * 2 } : {}) },
      justificar: e.ajuste === 'justificado' || (ctxBase.justificar && e.ajuste !== 'sin_ajuste'),
    };
    if (seccion.saltoPagina) cuerpo.push(parrafoSalto());
    if (seccion.titulo || seccion.instrucciones) {
      if (seccion.titulo) {
        cuerpo.push(new D.Paragraph({
          spacing: { before: tw(0.5), after: tw(0.1) }, keepNext: true,
          children: [new D.TextRun({ ...ctx.fmt, text: seccion.titulo.toUpperCase(), bold: true })],
        }));
      }
      if (seccion.instrucciones) {
        cuerpo.push(new D.Paragraph({
          spacing: { before: seccion.titulo ? 0 : tw(0.5), after: tw(0.25) }, keepNext: true,
          indent: ctx.sangriaCm ? { firstLine: tw(ctx.sangriaCm) } : undefined,
          children: runsPlanos(seccion.instrucciones, { ...ctx.fmt, bold: true }),
        }));
      }
    }
    for (const p of seccion.preguntas || []) {
      if (p.tipo === 'lectura_comprension') {
        if (p.saltoPagina) cuerpo.push(parrafoSalto());
        cuerpo.push(...lectura(p, ctx));
        for (const sp of p.subpreguntas || []) cuerpo.push(...(await reactivo(sp, numeros, modoClave, ctx)));
      } else {
        cuerpo.push(...(await reactivo(p, numeros, modoClave, ctx)));
      }
    }
    if ((seccion.preguntas || []).length > 0) cuerpo.push(...valorDeSeccion(seccion, ctx));
  }
  if (!esIngles) cuerpo.push(...firma(ctxBase));

  const encabezadoVacio = new D.Header({ children: [new D.Paragraph({})] });
  const documento = new D.Document({
    creator: 'Panel de control CCUMA',
    title: `${modoClave ? 'Clave' : 'Examen'} ${examen.meta.materia || ''}`.trim(),
    styles: {
      default: {
        document: {
          run: { font: fuente, size: Math.round(estilo.tamano * 2) },
          paragraph: { spacing: { line: Math.round(240 * estilo.interlineado), before: 0, after: 0 } },
        },
      },
    },
    sections: [{
      properties: {
        titlePage: true, // la hoja 1 no lleva el mini encabezado ni el número
        page: {
          size: { width: tw(papel.ancho), height: tw(papel.alto) },
          margin: {
            top: tw(estilo.margenCm), bottom: tw(estilo.margenCm), left: tw(estilo.margenCm), right: tw(estilo.margenCm),
            header: tw(estilo.margenCm / 2), footer: tw(estilo.margenCm / 2),
          },
        },
      },
      headers: { first: encabezadoVacio, default: encabezadoMini(examen, modoClave, ctxBase) },
      ...(esIngles ? { footers: { first: pieIngles(ctxBase), default: pieIngles(ctxBase) } } : {}),
      children: cuerpo,
    }],
  });

  const blob = await D.Packer.toBlob(documento);
  const nombre = `${modoClave ? 'CLAVE' : 'Examen'}_${examen.meta.materia || 'materia'}_${examen.meta.grado || ''}${examen.meta.grupo || ''}_Tipo${examen.tipoExamen}`.replace(/\s+/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
