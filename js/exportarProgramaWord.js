// Exporta un programa de actividades académicas a Word (.docx) con el mismo
// contenido y formato que la vista previa / PDF: encabezado, datos, temario en
// cuatro columnas, criterios con firmas, observaciones y nombres al pie. Va
// siempre en hoja horizontal, del tamaño que se eligió para el programa.
//
// Lo que no puede ser idéntico al PDF: Word reparte el alto por su cuenta, así
// que la tabla del temario crece con lo que se escriba y, si es mucho texto,
// la hoja puede pasar a una segunda página.
// La librería docx se carga solo al exportar (la misma que usa el examen).

import {
  ETIQUETAS_TRIMESTRE, totalPorcentajeCriterios, nombreElaboro, interlineadoTemario, ANCHO_COLUMNA_PORCENTAJE_CM, textoTemario,
  tamanoLetraTemario,
} from './programasModel.js';

const URL_DOCX = 'https://cdn.jsdelivr.net/npm/docx@9.8.1/+esm';

let D = null;

const PX_POR_CM = 96 / 2.54;
const tw = (cm) => Math.round(cm * (1440 / 2.54));
const pxDeCm = (cm) => Math.round(cm * PX_POR_CM);

const FUENTE = 'Arial';
const TAM_TEXTO = 19; // 9.5 pt, en medios puntos
const COLOR_LINEA = '111111';
// La hoja usa interlineado 1.3 en todo menos en el temario; en Word 1 = ~1.15.
const LINEA_HOJA = Math.round(240 * 1.3 / 1.15);

const borde = (grosorPt) => ({ style: D.BorderStyle.SINGLE, size: Math.round(grosorPt * 8), color: COLOR_LINEA });
const SIN_BORDE = () => ({ style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' });
const bordesTodos = (grosorPt) => ({ top: borde(grosorPt), bottom: borde(grosorPt), left: borde(grosorPt), right: borde(grosorPt) });
const sinBordes = () => ({ top: SIN_BORDE(), bottom: SIN_BORDE(), left: SIN_BORDE(), right: SIN_BORDE() });

function cargarImagen(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer el logo de la escuela.'));
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

// Un texto de varias líneas (como se escribe en los campos del editor) pasa a
// un párrafo por línea, conservando las líneas en blanco.
function parrafosDeTexto(texto, opciones = {}, tamano = TAM_TEXTO) {
  const lineas = String(texto || '').split('\n');
  return lineas.map((linea) => new D.Paragraph({
    ...opciones,
    children: [new D.TextRun({ font: FUENTE, size: tamano, text: linea })],
  }));
}

// Tamaño de letra (en medios puntos) elegido para un espacio del temario.
const medioPuntosTemario = (programa, columna) => Math.round(tamanoLetraTemario(programa, columna) * 2);

function parrafo(texto, { negrita = false, centrado = false, tamano = TAM_TEXTO, antes = 0, despues = 0 } = {}) {
  return new D.Paragraph({
    alignment: centrado ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
    spacing: { before: tw(antes), after: tw(despues), line: LINEA_HOJA },
    children: [new D.TextRun({ font: FUENTE, size: tamano, bold: negrita, text: texto })],
  });
}

// "ETIQUETA: valor" con la etiqueta en negritas, como en la hoja.
function parrafoConEtiqueta(etiqueta, valor, { antes = 0, despues = 0 } = {}) {
  return new D.Paragraph({
    spacing: { before: tw(antes), after: tw(despues), line: LINEA_HOJA },
    children: [
      new D.TextRun({ font: FUENTE, size: TAM_TEXTO, bold: true, text: `${etiqueta}: ` }),
      new D.TextRun({ font: FUENTE, size: TAM_TEXTO, text: valor || '' }),
    ],
  });
}

// Celda de una columna del temario: el contenido ya viene como lista de párrafos/tablas.
function celda(cm, children, extra = {}) {
  return new D.TableCell({
    width: { size: tw(cm), type: D.WidthType.DXA },
    margins: { top: tw(0.12), bottom: tw(0.12), left: tw(0.3), right: tw(0.3) },
    borders: bordesTodos(1),
    children,
    ...extra,
  });
}

async function encabezado(config, anchoCm) {
  const hijosLogo = [];
  let anchoLogoCelda = 0.5;
  if (config.logoDataUrl) {
    const img = await cargarImagen(config.logoDataUrl);
    const altoCm = 1.7;
    const anchoCm2 = altoCm * img.naturalWidth / img.naturalHeight;
    anchoLogoCelda = anchoCm2 + 0.5;
    hijosLogo.push(new D.Paragraph({
      children: [new D.ImageRun({
        type: tipoDeDataUrl(config.logoDataUrl), data: bytesDeDataUrl(config.logoDataUrl),
        transformation: { width: pxDeCm(anchoCm2), height: pxDeCm(altoCm) },
      })],
    }));
  } else {
    hijosLogo.push(new D.Paragraph({}));
  }
  const lineas = [
    'COLEGIO CULTURAL MÉXICO-ARAGÓN, S.C.',
    'DIRECCIÓN TÉCNICA DE SECUNDARIA',
    'ÁREA I DIRECTIVA',
    'PROGRAMA DE ACTIVIDADES ACADÉMICAS',
  ];
  return new D.Table({
    width: { size: tw(anchoCm), type: D.WidthType.DXA },
    columnWidths: [tw(anchoLogoCelda), tw(anchoCm - anchoLogoCelda)],
    layout: D.TableLayoutType.FIXED,
    borders: { ...sinBordes(), insideHorizontal: SIN_BORDE(), insideVertical: SIN_BORDE() },
    rows: [new D.TableRow({
      children: [
        new D.TableCell({
          width: { size: tw(anchoLogoCelda), type: D.WidthType.DXA }, borders: sinBordes(),
          verticalAlign: D.VerticalAlign.CENTER, children: hijosLogo,
        }),
        new D.TableCell({
          width: { size: tw(anchoCm - anchoLogoCelda), type: D.WidthType.DXA }, borders: sinBordes(),
          verticalAlign: D.VerticalAlign.CENTER,
          // El logo ocupa la izquierda, así que el título queda centrado en el resto de la hoja.
          children: lineas.map((l, i) => new D.Paragraph({
            alignment: D.AlignmentType.CENTER, spacing: { line: Math.round(240 * 1.35 / 1.15) },
            children: [new D.TextRun({ font: FUENTE, size: i === 3 ? 21 : 22, bold: true, text: l })],
          })),
        }),
      ],
    })],
  });
}

// "Criterios de evaluación": la tabla de criterios (con total y evaluación
// obtenida) y, debajo, las dos líneas de firma de enterado.
function contenidoCriterios(programa, anchoCm) {
  const anchoUtil = anchoCm; // la tabla ocupa toda la columna, sin márgenes, como en la hoja
  // Igual que la hoja: "Porcentaje" y "Porcentaje obtenido" miden lo de su título
  // y el resto es para el nombre del criterio.
  const ancho2 = ANCHO_COLUMNA_PORCENTAJE_CM;
  const ancho3 = ANCHO_COLUMNA_PORCENTAJE_CM;
  const ancho1 = anchoUtil - ancho2 - ancho3;
  const celdaCriterio = (texto, { negrita = false, centrado = false, ancho }) => new D.TableCell({
    width: { size: tw(ancho), type: D.WidthType.DXA },
    // Mismo relleno que la hoja: 0.2 cm en la columna del nombre, 0.12 en las de porcentaje.
    margins: {
      top: tw(0.08), bottom: tw(0.08), left: tw(ancho === ancho1 ? 0.2 : 0.12), right: tw(ancho === ancho1 ? 0.2 : 0.12),
    },
    borders: bordesTodos(0.5),
    children: [parrafo(texto, { negrita, centrado, tamano: medioPuntosTemario(programa, 'criterios') })],
  });
  // "Porcentaje" lleva lo que vale cada criterio; "Porcentaje obtenido" queda en
  // blanco para escribir a mano lo que sacó el alumno.
  const celdaVacia = () => celdaCriterio('', { ancho: ancho3 });
  const fila = (nombre, porcentaje, obtenido, negrita = false) => new D.TableRow({
    children: [
      celdaCriterio(nombre, { negrita, ancho: ancho1 }),
      celdaCriterio(porcentaje, { centrado: true, negrita: false, ancho: ancho2 }),
      obtenido === null ? celdaVacia() : celdaCriterio(obtenido, { centrado: true, ancho: ancho3 }),
    ],
  });
  const porcentaje = (c) => (c.porcentaje === '' || c.porcentaje === null || c.porcentaje === undefined ? '' : `${c.porcentaje}%`);
  const renglonDelgado = (anchos) => new D.TableRow({
    height: { value: tw(0.19), rule: D.HeightRule.EXACT },
    children: anchos.map((ancho) => new D.TableCell({
      width: { size: tw(ancho), type: D.WidthType.DXA },
      margins: { top: 0, bottom: 0, left: tw(0.12), right: tw(0.12) },
      borders: bordesTodos(0.5),
      children: [new D.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT } })],
    })),
  });

  const tabla = new D.Table({
    width: { size: tw(anchoUtil), type: D.WidthType.DXA },
    columnWidths: [tw(ancho1), tw(ancho2), tw(ancho3)],
    layout: D.TableLayoutType.FIXED,
    rows: [
      new D.TableRow({
        children: [
          celdaCriterio('Criterios', { negrita: true, centrado: true, ancho: ancho1 }),
          celdaCriterio('Porcentaje', { negrita: true, centrado: true, ancho: ancho2 }),
          celdaCriterio('Porcentaje obtenido', { negrita: true, centrado: true, ancho: ancho3 }),
        ],
      }),
      // Un criterio sin nombre ni porcentaje queda como renglón delgado, igual que
      // en la hoja (ahí una celda vacía solo mide su relleno).
      ...(programa.criterios || []).map((c) => ((c.nombre || '') === '' && porcentaje(c) === ''
        ? renglonDelgado([ancho1, ancho2, ancho3])
        : fila(c.nombre || '', porcentaje(c), null))),
      new D.TableRow({
        children: [
          celdaCriterio('Total', { negrita: true, ancho: ancho1 }),
          celdaCriterio(`${totalPorcentajeCriterios(programa)}%`, { negrita: true, centrado: true, ancho: ancho2 }),
          celdaVacia(),
        ],
      }),
      fila('Evaluación obtenida', '', programa.evaluacionObtenida || '', true),
    ],
  });

  const mitad = anchoUtil / 2;
  const firma = (etiqueta) => new D.TableCell({
    width: { size: tw(mitad), type: D.WidthType.DXA },
    borders: sinBordes(),
    margins: { left: tw(0.1), right: tw(0.1) },
    children: [
      new D.Paragraph({ spacing: { before: tw(1.2) }, border: { bottom: borde(0.5) }, children: [] }),
      parrafo(etiqueta, { centrado: true, tamano: 17, antes: 0.05 }),
    ],
  });
  const firmas = new D.Table({
    width: { size: tw(anchoUtil), type: D.WidthType.DXA },
    columnWidths: [tw(mitad), tw(mitad)],
    layout: D.TableLayoutType.FIXED,
    borders: { ...sinBordes(), insideHorizontal: SIN_BORDE(), insideVertical: SIN_BORDE() },
    rows: [new D.TableRow({
      children: [firma('Firma de enterado (a) al inicio'), firma('Firma de enterado (a) al término')],
    })],
  });

  return { tabla, firmas };
}

// Párrafo vacío de alto exacto, para dejar entre bloques el mismo aire que la hoja.
function espaciador(cm) {
  return new D.Paragraph({ spacing: { before: 0, after: 0, line: Math.max(20, tw(cm)), lineRule: D.LineRuleType.EXACT } });
}

function pie(programa, anchoCm) {
  const bloque = (titulo, cargo) => new D.TableCell({
    width: { size: tw(anchoCm / 2), type: D.WidthType.DXA },
    borders: sinBordes(),
    children: [
      parrafo(titulo, { negrita: true, centrado: true, despues: 0.5 }),
      parrafo(cargo, { centrado: true }),
    ],
  });
  return new D.Table({
    width: { size: tw(anchoCm), type: D.WidthType.DXA },
    columnWidths: [tw(anchoCm / 2), tw(anchoCm / 2)],
    layout: D.TableLayoutType.FIXED,
    borders: { ...sinBordes(), insideHorizontal: SIN_BORDE(), insideVertical: SIN_BORDE() },
    rows: [new D.TableRow({
      cantSplit: true,
      children: [
        bloque('ELABORÓ', `PROFR. (A) ${nombreElaboro(programa)}`.trim()),
        bloque('VO. BO. DE COORDINACIÓN', `LIC. ${programa.coordinadora || ''}`.trim()),
      ],
    })],
  });
}

// papel = { ancho, alto } en cm, ya acostado (ver papelDePrograma en programas.js).
// opciones: lo que ya calculó la vista previa para que el Word salga igual —
// los anchos de las cuatro columnas del temario (fracciones), el alto del temario
// cuando todo cabe en una hoja y lo que mide la tabla de criterios, en cm.
export async function exportarProgramaWord(programa, config, papel, opciones = {}) {
  if (!D) D = await import(URL_DOCX);

  const margenLateralCm = 1.2;
  const margenVerticalCm = 1.0;
  const anchoCm = papel.ancho - 2 * margenLateralCm;
  const anchos = (opciones.anchos || [0.17, 0.27, 0.27, 0.29]).map((p) => anchoCm * p);
  // Las columnas de la tabla de Word: las cuatro del temario más un corte donde
  // se parte el renglón de profesor/grupos (a la mitad exacta, como en la hoja),
  // que casi siempre cae dentro de alguna de ellas.
  const bordes = [0];
  anchos.forEach((a) => bordes.push(bordes[bordes.length - 1] + a));
  const mitad = anchoCm / 2;
  const cortes = [...new Set([...bordes, mitad].map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
  const columnasWord = cortes.slice(1).map((x, i) => x - cortes[i]);
  const columnasEntre = (desdeCm, hastaCm) => cortes.filter((x) => x > desdeCm + 0.001 && x <= hastaCm + 0.001).length;
  const span = (i) => columnasEntre(bordes[i], bordes[i + 1]);
  const totalColumnas = columnasWord.length;
  const [aFechas, aContenidos, aOrientaciones, aCriterios] = anchos;
  // Alto del temario cuando todo cabe en una hoja (lo mide la vista previa); sin
  // ese dato se usa lo que queda de la hoja quitando encabezado, datos y pie.
  // Se le resta un margen de seguridad: Word (y LibreOffice) suman los márgenes de
  // las celdas a los altos mínimos, y unos milímetros de más mandan los nombres
  // del pie a otra hoja. Si el contenido necesita más, Word estira las celdas solo.
  const HOLGURA_CM = 0.9;
  const altoTemarioCm = (opciones.altoTemarioCm || Math.max(5, papel.alto - 2 * margenVerticalCm - 11)) - HOLGURA_CM;

  const encabezadoTabla = await encabezado(config, anchoCm);
  // Mismo interlineado del temario que en la vista previa ("Múltiple" en Word).
  const interlineado = { spacing: { line: Math.round(240 * interlineadoTemario(programa)) } };

  const margenesTitulo = { top: tw(0.12), bottom: tw(0.12), left: tw(0.2), right: tw(0.2) };
  const tituloColumna = (cm, texto, extra = {}) => celda(cm, [parrafo(texto, { negrita: true, centrado: true })], {
    margins: margenesTitulo, verticalAlign: D.VerticalAlign.CENTER, ...extra,
  });
  // Texto del temario: 0.2 cm de aire arriba y 0.3 a los lados, como en la hoja.
  const margenesTexto = { top: tw(0.2), bottom: 0, left: tw(0.3), right: tw(0.3) };
  const celdaTexto = (cm, texto, columna, extra = {}) => celda(cm, parrafosDeTexto(textoTemario(texto), interlineado, medioPuntosTemario(programa, columna)), { margins: margenesTexto, rowSpan: 2, ...extra });

  // En la hoja las firmas de enterado van pegadas al fondo de la columna de
  // criterios. En Word eso se logra con una segunda fila (de alto mínimo) a la que
  // se unen las tres columnas de texto, con las firmas alineadas abajo.
  const criterios = contenidoCriterios(programa, aCriterios - 0.05);
  const altoTablaCriteriosCm = opciones.altoTablaCriteriosCm || (2.12 + 0.6 * ((programa.criterios || []).length + 1));
  const altoFirmas = Math.max(1.8, altoTemarioCm - altoTablaCriteriosCm);
  const parrafoFinal = () => new D.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT } });

  const tablaPrincipal = new D.Table({
    width: { size: tw(anchoCm), type: D.WidthType.DXA },
    columnWidths: columnasWord.map(tw),
    layout: D.TableLayoutType.FIXED,
    rows: [
      new D.TableRow({
        // Disciplina, campo formativo y trimestre en una sola línea, como en la hoja.
        children: [celda(anchoCm, [new D.Paragraph({
          spacing: { line: LINEA_HOJA },
          children: [
            new D.TextRun({ font: FUENTE, size: TAM_TEXTO, bold: true, text: 'DISCIPLINA: ' }),
            // Dos espacios entre bloques: lo mismo que los 0.2 cm de la hoja.
            new D.TextRun({ font: FUENTE, size: TAM_TEXTO, text: `${programa.disciplina || ''}  ` }),
            new D.TextRun({ font: FUENTE, size: TAM_TEXTO, bold: true, text: 'CAMPO FORMATIVO: ' }),
            new D.TextRun({ font: FUENTE, size: TAM_TEXTO, text: `${programa.campoFormativo || ''}  ` }),
            new D.TextRun({ font: FUENTE, size: TAM_TEXTO, bold: true, text: `${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''} CICLO ESCOLAR: ${programa.cicloEscolar || '____'}` }),
          ],
        })], { columnSpan: totalColumnas })],
      }),
      new D.TableRow({
        children: [
          celda(mitad, [parrafoConEtiqueta('NOMBRE DEL (DE LA) PROFESOR (A)', programa.profesor)], { columnSpan: columnasEntre(0, mitad) }),
          celda(mitad, [parrafoConEtiqueta('GRUPOS', programa.grupos)], { columnSpan: columnasEntre(mitad, anchoCm) }),
        ],
      }),
      new D.TableRow({
        children: [celda(anchoCm, [parrafo('TEMARIO', { negrita: true, centrado: true, tamano: 22 })], { columnSpan: totalColumnas })],
      }),
      new D.TableRow({
        cantSplit: true,
        children: [
          tituloColumna(aFechas, 'FECHAS DEL TRIMESTRE', { columnSpan: span(0) }),
          tituloColumna(aContenidos, 'CONTENIDOS', { columnSpan: span(1) }),
          tituloColumna(aOrientaciones, 'ORIENTACIONES DIDÁCTICAS', { columnSpan: span(2) }),
          tituloColumna(aCriterios, 'CRITERIOS DE EVALUACIÓN', { columnSpan: span(3) }),
        ],
      }),
      new D.TableRow({
        children: [
          celdaTexto(aFechas, programa.fechasTrimestre, 'fechas', { columnSpan: span(0) }),
          celdaTexto(aContenidos, programa.procesosDesarrollo, 'contenidos', { columnSpan: span(1) }),
          celdaTexto(aOrientaciones, programa.orientacionesDidacticas, 'orientaciones', { columnSpan: span(2) }),
          celda(aCriterios, [criterios.tabla, parrafoFinal()], { columnSpan: span(3), margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
        ],
      }),
      new D.TableRow({
        height: { value: tw(altoFirmas), rule: D.HeightRule.ATLEAST },
        children: [
          celda(aCriterios, [criterios.firmas, parrafoFinal()], {
            columnSpan: span(3),
            margins: { top: 0, bottom: tw(0.1), left: 0, right: 0 }, verticalAlign: D.VerticalAlign.BOTTOM,
          }),
        ],
      }),
      new D.TableRow({
        height: { value: tw(1.1), rule: D.HeightRule.ATLEAST },
        children: [celda(anchoCm, [
          new D.Paragraph({
            spacing: { line: LINEA_HOJA },
            children: [
              new D.TextRun({ font: FUENTE, size: TAM_TEXTO, bold: true, text: 'OBSERVACIONES: ' }),
              new D.TextRun({ font: FUENTE, size: TAM_TEXTO, text: programa.observaciones || '' }),
            ],
          }),
        ], { columnSpan: totalColumnas, margins: { top: tw(0.15), bottom: tw(0.15), left: tw(0.3), right: tw(0.3) } })],
      }),
    ],
  });

  const documento = new D.Document({
    creator: 'Panel de control CCUMA',
    title: `Programa ${programa.disciplina || ''}`.trim(),
    styles: { default: { document: { run: { font: FUENTE, size: TAM_TEXTO } } } },
    sections: [{
      properties: {
        page: {
          // Horizontal declarado (no solo con las medidas acostadas): docx pide las
          // medidas en vertical y las voltea él mismo al marcar LANDSCAPE.
          size: { width: tw(papel.alto), height: tw(papel.ancho), orientation: D.PageOrientation.LANDSCAPE },
          margin: {
            top: tw(margenVerticalCm), bottom: tw(margenVerticalCm), left: tw(margenLateralCm), right: tw(margenLateralCm),
          },
        },
      },
      children: [
        encabezadoTabla,
        espaciador(0.3),
        tablaPrincipal,
        // En la hoja hay 0.5 cm; aquí un poco menos, porque Word suele medir los
        // renglones de la tabla un pelo más altos y así los nombres no se pasan
        // solos a otra hoja cuando el programa llena la página.
        espaciador(0.25),
        pie(programa, anchoCm),
      ],
    }],
  });

  const blob = await D.Packer.toBlob(documento);
  const nombre = `Programa_${programa.disciplina || 'materia'}_${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''}`.replace(/\s+/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
