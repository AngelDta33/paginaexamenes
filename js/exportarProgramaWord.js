// Exporta un programa de actividades académicas a Word (.docx) con el mismo
// contenido y formato que la vista previa / PDF: encabezado, datos, temario en
// cuatro columnas, criterios con firmas, observaciones y nombres al pie. Va
// siempre en hoja horizontal, del tamaño que se eligió para el programa.
//
// Lo que no puede ser idéntico al PDF: Word reparte el alto por su cuenta, así
// que la tabla del temario crece con lo que se escriba y, si es mucho texto,
// la hoja puede pasar a una segunda página.
// La librería docx se carga solo al exportar (la misma que usa el examen).

import { ETIQUETAS_TRIMESTRE, totalPorcentajeCriterios, nombreElaboro } from './programasModel.js';

const URL_DOCX = 'https://cdn.jsdelivr.net/npm/docx@9.8.1/+esm';

let D = null;

const PX_POR_CM = 96 / 2.54;
const tw = (cm) => Math.round(cm * (1440 / 2.54));
const pxDeCm = (cm) => Math.round(cm * PX_POR_CM);

const FUENTE = 'Arial';
const TAM_TEXTO = 19; // 9.5 pt, en medios puntos
const COLOR_LINEA = '111111';

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
function parrafosDeTexto(texto, opciones = {}) {
  const lineas = String(texto || '').split('\n');
  return lineas.map((linea) => new D.Paragraph({
    ...opciones,
    children: [new D.TextRun({ font: FUENTE, size: TAM_TEXTO, text: linea })],
  }));
}

function parrafo(texto, { negrita = false, centrado = false, tamano = TAM_TEXTO, antes = 0, despues = 0 } = {}) {
  return new D.Paragraph({
    alignment: centrado ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
    spacing: { before: tw(antes), after: tw(despues) },
    children: [new D.TextRun({ font: FUENTE, size: tamano, bold: negrita, text: texto })],
  });
}

// "ETIQUETA: valor" con la etiqueta en negritas, como en la hoja.
function parrafoConEtiqueta(etiqueta, valor) {
  return new D.Paragraph({
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
    margins: { top: tw(0.12), bottom: tw(0.12), left: tw(0.25), right: tw(0.25) },
    borders: bordesTodos(1),
    children,
    ...extra,
  });
}

async function encabezado(config, anchoCm) {
  const hijosLogo = [];
  const anchoLogoCelda = 3;
  if (config.logoDataUrl) {
    const img = await cargarImagen(config.logoDataUrl);
    const altoCm = 1.7;
    const anchoCm2 = altoCm * img.naturalWidth / img.naturalHeight;
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
          children: lineas.map((l, i) => parrafo(l, { negrita: true, centrado: true, tamano: i === 3 ? 21 : 22 })),
        }),
      ],
    })],
  });
}

// "Criterios de evaluación": la tabla de criterios (con total y evaluación
// obtenida) y, debajo, las dos líneas de firma de enterado.
function contenidoCriterios(programa, anchoCm) {
  const anchoUtil = anchoCm; // el ancho ya descuenta los márgenes de la celda
  const ancho1 = anchoUtil * 0.4;
  const ancho2 = anchoUtil * 0.3;
  const ancho3 = anchoUtil - ancho1 - ancho2;
  const celdaCriterio = (texto, { negrita = false, centrado = false, ancho }) => new D.TableCell({
    width: { size: tw(ancho), type: D.WidthType.DXA },
    margins: { top: tw(0.06), bottom: tw(0.06), left: tw(0.08), right: tw(0.08) },
    borders: bordesTodos(0.5),
    children: [parrafo(texto, { negrita, centrado, tamano: 18 })],
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
      ...(programa.criterios || []).map((c) => fila(c.nombre || '', porcentaje(c), null)),
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

  return [tabla, new D.Paragraph({ spacing: { before: tw(0.2) } }), firmas];
}

function pie(programa, anchoCm) {
  const bloque = (titulo, cargo) => new D.TableCell({
    width: { size: tw(anchoCm / 2), type: D.WidthType.DXA },
    borders: sinBordes(),
    children: [
      parrafo(titulo, { negrita: true, centrado: true, despues: 0.9 }),
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
export async function exportarProgramaWord(programa, config, papel) {
  if (!D) D = await import(URL_DOCX);

  const margenLateralCm = 1.2;
  const margenVerticalCm = 1.0;
  const anchoCm = papel.ancho - 2 * margenLateralCm;
  const anchos = [0.17, 0.27, 0.27, 0.29].map((p) => anchoCm * p);
  // Alto mínimo del temario para que la hoja se vea llena como en el PDF; lo
  // demás (encabezado, datos, observaciones, nombres) ocupa unos 11.5 cm.
  const altoTemarioCm = Math.max(5, papel.alto - 2 * margenVerticalCm - 11.5);

  const encabezadoTabla = await encabezado(config, anchoCm);

  const tituloColumna = (cm, texto) => celda(cm, [parrafo(texto, { negrita: true, centrado: true })]);
  const tablaPrincipal = new D.Table({
    width: { size: tw(anchoCm), type: D.WidthType.DXA },
    columnWidths: anchos.map(tw),
    layout: D.TableLayoutType.FIXED,
    rows: [
      new D.TableRow({
        children: [celda(anchoCm, [
          parrafoConEtiqueta('DISCIPLINA', programa.disciplina),
          parrafoConEtiqueta('CAMPO FORMATIVO', programa.campoFormativo),
          parrafo(`${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''}   CICLO ESCOLAR: ${programa.cicloEscolar || '____'}`, { negrita: true }),
        ], { columnSpan: 4 })],
      }),
      new D.TableRow({
        children: [
          celda(anchos[0] + anchos[1], [parrafoConEtiqueta('NOMBRE DEL (DE LA) PROFESOR (A)', programa.profesor)], { columnSpan: 2 }),
          celda(anchos[2] + anchos[3], [parrafoConEtiqueta('GRUPOS', programa.grupos)], { columnSpan: 2 }),
        ],
      }),
      new D.TableRow({
        children: [celda(anchoCm, [parrafo('TEMARIO', { negrita: true, centrado: true, tamano: 22 })], { columnSpan: 4 })],
      }),
      new D.TableRow({
        cantSplit: true,
        children: [
          tituloColumna(anchos[0], 'FECHAS DEL TRIMESTRE'),
          tituloColumna(anchos[1], 'CONTENIDOS'),
          tituloColumna(anchos[2], 'ORIENTACIONES DIDÁCTICAS'),
          tituloColumna(anchos[3], 'CRITERIOS DE EVALUACIÓN'),
        ],
      }),
      new D.TableRow({
        height: { value: tw(altoTemarioCm), rule: D.HeightRule.ATLEAST },
        children: [
          celda(anchos[0], parrafosDeTexto(programa.fechasTrimestre)),
          celda(anchos[1], parrafosDeTexto(programa.procesosDesarrollo)),
          celda(anchos[2], parrafosDeTexto(programa.orientacionesDidacticas)),
          celda(anchos[3], contenidoCriterios(programa, anchos[3] - 0.5)),
        ],
      }),
      new D.TableRow({
        children: [celda(anchoCm, [
          new D.Paragraph({
            children: [
              new D.TextRun({ font: FUENTE, size: TAM_TEXTO, bold: true, text: 'OBSERVACIONES: ' }),
              new D.TextRun({ font: FUENTE, size: TAM_TEXTO, text: programa.observaciones || '' }),
            ],
          }),
          new D.Paragraph({ spacing: { before: tw(0.9) } }),
        ], { columnSpan: 4 })],
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
          size: { width: tw(papel.ancho), height: tw(papel.alto) },
          margin: {
            top: tw(margenVerticalCm), bottom: tw(margenVerticalCm), left: tw(margenLateralCm), right: tw(margenLateralCm),
          },
        },
      },
      children: [
        encabezadoTabla,
        new D.Paragraph({ spacing: { before: 0, after: tw(0.2) } }),
        tablaPrincipal,
        new D.Paragraph({ spacing: { before: 0, after: tw(0.3) } }),
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
