// Lista de programas de actividades académicas y su editor: un formato fijo de
// una sola hoja horizontal (del tamaño de papel que elija el maestro) con vista
// previa e impresión, sin reactivos ni paginación — solo sirve para este documento.

import { el, clear } from './dom.js';
import {
  listarProgramas, obtenerPrograma, guardarPrograma, eliminarPrograma,
} from './programasStore.js';
import {
  nuevoPrograma, nuevoCriterioPrograma, totalPorcentajeCriterios, ETIQUETAS_TRIMESTRE,
  duplicarPrograma, nombreElaboro, interlineadoTemario, altoLineaTemarioPx, textoTemario,
} from './programasModel.js';
import { obtenerConfig } from './store.js';
import { esRevisorOAdmin } from './auth.js';
import { coincideTexto, guardarFoco, restaurarFoco, campoBusqueda } from './filtros.js';
import { TAMANOS_PAPEL } from './paginate.js';
import { exportarProgramaWord } from './exportarProgramaWord.js';

// El formato de programa siempre va HORIZONTAL, así que cada papel se usa
// acostado: el ancho de la hoja es el lado largo. Mismo mecanismo que en los
// exámenes (ver TAMANOS_PAPEL y papelDeExamen en paginate.js): si el papel que
// se elige en el diálogo de impresión no es el mismo con el que se armó la
// vista previa, el contenido sale cortado y con hojas casi en blanco de más.
const ETIQUETAS_PAPEL_PROGRAMA = {
  carta: 'Carta horizontal (27.94 × 21.59 cm)',
  oficio: 'Oficio / Folio horizontal (33.02 × 21.59 cm)',
  a4: 'A4 horizontal (29.7 × 21 cm)',
};

const PAPEL_PROGRAMA_POR_DEFECTO = 'carta';

function papelDePrograma(programa) {
  const base = TAMANOS_PAPEL[programa && programa.tamanoPapel] || TAMANOS_PAPEL[PAPEL_PROGRAMA_POR_DEFECTO];
  return { ancho: base.alto, alto: base.ancho }; // acostado
}

function fechaCorta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

let busquedaPrograma = '';
let filtroTrimestrePrograma = 'todos';
let filtroProfesorPrograma = 'todos';
// programasCache guarda el último listarProgramas(): teclear en el buscador o
// cambiar un filtro solo re-filtra y repinta esta copia en memoria, sin
// volver a consultar Firestore en cada tecla (si no, el <input> se reemplaza
// por uno nuevo justo cuando el navegador está esperando la respuesta de red
// y pierde el foco — solo dejaba borrar de a un carácter).
let programasCache = null;

// Ver el comentario junto a reiniciarFiltrosExamenes en main.js — mismo motivo.
export function reiniciarFiltrosProgramas() {
  busquedaPrograma = '';
  filtroTrimestrePrograma = 'todos';
  filtroProfesorPrograma = 'todos';
  programasCache = null;
}

// ---------------------------------------------------------------------------
// LISTA
// ---------------------------------------------------------------------------

export async function montarListaProgramas(contenedor, sesion, { onAbrirPrograma }) {
  clear(contenedor);
  const soloConsulta = esRevisorOAdmin(sesion);

  if (!soloConsulta) {
    contenedor.appendChild(el('div', { class: 'barra-nueva' }, [
      el('button', {
        type: 'button', class: 'btn-primario',
        onclick: async () => {
          const programa = nuevoPrograma(sesion);
          await guardarPrograma(programa);
          onAbrirPrograma(programa.id);
        },
      }, '+ Nuevo programa'),
    ]));
  }

  const contenedorResultados = el('div', {});
  contenedor.appendChild(contenedorResultados);

  const cargando = el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'Cargando programas…');
  contenedorResultados.appendChild(cargando);

  try {
    programasCache = await listarProgramas(sesion);
  } catch (err) {
    cargando.textContent = `No se pudieron cargar los programas: ${err.message}`;
    return;
  }
  clear(contenedorResultados);
  renderizarResultadosProgramas(contenedor, contenedorResultados, sesion, { onAbrirPrograma }, soloConsulta);
}

function renderizarResultadosProgramas(contenedor, contenedorResultados, sesion, { onAbrirPrograma }, soloConsulta) {
  const foco = guardarFoco(contenedorResultados, '.campo-busqueda');
  clear(contenedorResultados);
  const repintar = () => renderizarResultadosProgramas(contenedor, contenedorResultados, sesion, { onAbrirPrograma }, soloConsulta);
  let programas = programasCache || [];

  const barraFiltros = el('div', { class: 'barra-filtros' }, [
    campoBusqueda({ placeholder: 'Buscar por disciplina, campo formativo o grupos…', valor: busquedaPrograma, onCambio: (v) => { busquedaPrograma = v; repintar(); } }),
    el('select', {
      onchange: (e) => { filtroTrimestrePrograma = e.target.value; repintar(); },
    }, [
      el('option', { value: 'todos', selected: filtroTrimestrePrograma === 'todos' }, 'Todos los trimestres'),
      ...Object.entries(ETIQUETAS_TRIMESTRE).map(([v, t]) => el('option', { value: v, selected: filtroTrimestrePrograma === v }, t)),
    ]),
  ]);
  if (soloConsulta) {
    const profesores = [...new Set(programas.map((p) => p.profesorNombre).filter(Boolean))].sort();
    barraFiltros.appendChild(el('select', {
      onchange: (e) => { filtroProfesorPrograma = e.target.value; repintar(); },
    }, [
      el('option', { value: 'todos', selected: filtroProfesorPrograma === 'todos' }, 'Todos los profesores'),
      ...profesores.map((p) => el('option', { value: p, selected: filtroProfesorPrograma === p }, p)),
    ]));
  }
  contenedorResultados.appendChild(barraFiltros);
  restaurarFoco(contenedorResultados, foco);

  if (soloConsulta && filtroProfesorPrograma !== 'todos') {
    programas = programas.filter((p) => p.profesorNombre === filtroProfesorPrograma);
  }
  if (filtroTrimestrePrograma !== 'todos') {
    programas = programas.filter((p) => p.trimestre === filtroTrimestrePrograma);
  }
  if (busquedaPrograma) {
    programas = programas.filter((p) => coincideTexto(busquedaPrograma, p.disciplina, p.campoFormativo, p.grupos, p.profesorNombre));
  }

  if (programas.length === 0) {
    contenedorResultados.appendChild(el('p', { style: 'color:#666; margin-top:1.5rem;' }, soloConsulta ? 'No hay programas que coincidan con esos filtros.' : 'Aún no tienes programas. Crea uno para llenar el formato de actividades académicas del trimestre.'));
    return;
  }

  contenedorResultados.appendChild(el('div', { class: 'lista-examenes' }, programas.map((programa) => el('div', { class: 'tarjeta-examen' }, [
    el('h3', {}, programa.disciplina || 'Sin disciplina'),
    el('div', { class: 'meta-chica' }, `${ETIQUETAS_TRIMESTRE[programa.trimestre] || 'sin trimestre'} · ${programa.grupos || 'sin grupos'} · editado ${fechaCorta(programa.updatedAt)}`),
    soloConsulta ? el('div', { class: 'meta-chica' }, `Profesor(a): ${programa.profesorNombre || 'sin nombre'}`) : null,
    el('div', { class: 'acciones-tarjeta' }, [
      el('button', { type: 'button', class: 'btn-primario', onclick: () => onAbrirPrograma(programa.id) }, 'Abrir'),
      // Disponible para cualquier rol: la copia queda a nombre de quien duplica
      // (editable por esa persona), sin tocar el programa original.
      el('button', {
        type: 'button', class: 'btn-secundario', title: 'Crea una copia para armar el programa de otra materia',
        onclick: async () => {
          const copia = duplicarPrograma(programa, sesion);
          await guardarPrograma(copia);
          onAbrirPrograma(copia.id);
        },
      }, 'Duplicar'),
      soloConsulta ? null : el('button', {
        type: 'button', class: 'btn-peligro',
        onclick: async () => {
          if (confirm(`¿Eliminar el programa de "${programa.disciplina || 'sin disciplina'}"? Esta acción no se puede deshacer.`)) {
            await eliminarPrograma(programa.id);
            montarListaProgramas(contenedor, sesion, { onAbrirPrograma });
          }
        },
      }, 'Eliminar'),
    ]),
  ]))));
}

// ---------------------------------------------------------------------------
// RENDER DE LA HOJA
// ---------------------------------------------------------------------------

const PX_POR_CM = 96 / 2.54;
const BORDE_COLUMNA_PX = 96 / 72; // 1pt, la raya entre columnas del temario

// Anchos de las cuatro columnas del temario (fechas, contenidos, orientaciones y
// criterios), como fracción del ancho de la tabla. Los de fábrica son los del
// formato original; los mínimos evitan que un título se parta en tres renglones.
const ANCHOS_POR_DEFECTO = [0.17, 0.27, 0.27, 0.29];
const ANCHOS_MINIMOS = [0.10, 0.14, 0.14, 0.24];
const ANCHOS_MAXIMOS = [0.40, 0.60, 0.60, 0.60];

function anchoTemarioPx(programa) {
  return (papelDePrograma(programa).ancho - 2 * 1.2) * PX_POR_CM - 2 * BORDE_COLUMNA_PX;
}

function celdaDatos(clase, etiqueta, valor) {
  return el('div', { class: `celda-datos-programa ${clase}` }, etiqueta ? [el('strong', {}, `${etiqueta}: `), valor || ''] : [valor || '']);
}

function textoPorcentaje(c) {
  return c.porcentaje === '' || c.porcentaje === null || c.porcentaje === undefined ? '' : `${c.porcentaje}%`;
}

// Renglones de la tabla de criterios, en orden: un renglón por criterio, el total
// y la evaluación obtenida. "Porcentaje" lleva lo que vale cada criterio;
// "Porcentaje obtenido" queda en blanco para escribir a mano lo que sacó el alumno.
function renglonesCriterios(programa) {
  return [
    ...(programa.criterios || []).map((c) => el('tr', {}, [
      el('td', { class: 'celda-criterio-nombre' }, c.nombre || ''),
      el('td', {}, textoPorcentaje(c)),
      el('td', {}, ''),
    ])),
    el('tr', { class: 'fila-total' }, [el('td', { class: 'celda-criterio-nombre' }, 'Total'), el('td', {}, `${totalPorcentajeCriterios(programa)}%`), el('td', {}, '')]),
    el('tr', { class: 'fila-evaluacion' }, [el('td', { class: 'celda-criterio-nombre' }, 'Evaluación obtenida'), el('td', {}, ''), el('td', {}, programa.evaluacionObtenida || '')]),
  ];
}

// La tabla con el encabezado y los renglones [desde, hasta) — cuando no cabe en
// una hoja, cada hoja lleva su parte y repite el encabezado.
function tablaCriterios(programa, desde = 0, hasta = Infinity) {
  return el('table', { class: 'tabla-criterios' }, [
    el('thead', {}, [el('tr', {}, [el('th', {}, 'Criterios'), el('th', {}, 'Porcentaje'), el('th', {}, 'Porcentaje obtenido')])]),
    el('tbody', {}, renglonesCriterios(programa).slice(desde, hasta)),
  ]);
}

function bloqueFirmas() {
  return el('div', { class: 'firmas-programa' }, [
    el('div', { class: 'firma-programa' }, [el('div', { class: 'linea-firma-programa' }), el('div', { class: 'etiqueta-firma-programa' }, 'Firma de enterado (a) al inicio')]),
    el('div', { class: 'firma-programa' }, [el('div', { class: 'linea-firma-programa' }), el('div', { class: 'etiqueta-firma-programa' }, 'Firma de enterado (a) al término')]),
  ]);
}

// Una columna de texto del temario: se ve como una ventana sobre el texto
// completo. `desde` y `lineas` (en renglones) dicen qué parte se muestra en esta
// hoja; con `lineas` en null la ventana ocupa todo el espacio que le quede.
function columnaTemario(titulo, texto, ventana) {
  const interior = el('div', {
    class: 'texto-col-temario', style: `margin-top:-${ventana.desde * ventana.lineaPx}px;`,
  }, textoTemario(texto));
  return el('div', { class: 'col-temario' }, [
    el('div', { class: 'titulo-col-temario' }, titulo),
    el('div', {
      class: 'contenido-col-temario',
      style: ventana.lineas === null ? '' : `flex:none; height:${ventana.lineas * ventana.lineaPx}px;`,
    }, [interior]),
  ]);
}

// Una hoja del programa. La primera lleva los datos generales; las demás solo
// continúan el temario. Cada hoja lleva los renglones de criterios
// [filasDesde, filasHasta) y, si toca, las firmas de enterado; las
// observaciones y los nombres van en la última. Con `medir` la columna de
// criterios va vacía: así se mide el espacio que le queda, sin que su
// contenido estire la hoja.
function renderPaginaPrograma(programa, config, anchos, {
  primera = true, conPie = true, desde = 0, lineas = null, hoja = 1, totalHojas = 1,
  filasDesde = 0, filasHasta = Infinity, firmas = true, medir = false, soloPie = false,
} = {}) {
  const papel = papelDePrograma(programa);
  const lineaPx = altoLineaTemarioPx(programa);
  const ventana = { desde, lineas, lineaPx };
  const llevaCriterios = !medir && (filasDesde < filasHasta || firmas);
  const numFilas = renglonesCriterios(programa).length;

  const colCriterios = el('div', { class: 'col-temario col-criterios' }, [
    el('div', { class: 'titulo-col-temario' }, llevaCriterios || primera ? 'CRITERIOS DE EVALUACIÓN' : ' '),
    llevaCriterios && filasDesde < Math.min(filasHasta, numFilas) ? tablaCriterios(programa, filasDesde, filasHasta) : null,
    llevaCriterios && firmas ? bloqueFirmas() : null,
  ]);

  const filasDatos = primera
    ? [
      // Disciplina, campo formativo y trimestre en una sola línea (si no caben,
      // siguen en el renglón de abajo).
      el('div', { class: 'fila-datos-programa fila-disciplina' }, [
        el('div', { class: 'celda-datos-programa datos-en-linea' }, [
          el('span', {}, [el('strong', {}, 'DISCIPLINA: '), programa.disciplina || '']),
          el('span', {}, [el('strong', {}, 'CAMPO FORMATIVO: '), programa.campoFormativo || '']),
          el('span', {}, [el('strong', {}, `${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''}   CICLO ESCOLAR: ${programa.cicloEscolar || '____'}`)]),
        ]),
      ]),
      el('div', { class: 'fila-datos-programa fila-profesor' }, [
        celdaDatos('', 'NOMBRE DEL (DE LA) PROFESOR (A)', programa.profesor),
        celdaDatos('', 'GRUPOS', programa.grupos),
      ]),
    ]
    : [
      el('div', { class: 'fila-datos-programa fila-disciplina' }, [
        el('div', { class: 'celda-datos-programa' }, [
          el('strong', {}, `DISCIPLINA: ${programa.disciplina || ''}  ·  ${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''}  ·  ${programa.profesor || ''}  (continuación)`),
        ]),
      ]),
    ];

  return el('div', {
    class: 'page pagina-programa',
    style: `--pagina-ancho:${papel.ancho}cm; --pagina-alto:${papel.alto}cm; --lh-temario:${lineaPx}px;`,
  }, [
    // El membrete (logo y nombre de la escuela) solo va en la primera hoja,
    // igual que en el Word; las demás se identifican con su renglón de
    // "(continuación)". Como medirPagina arma la hoja con este mismo `primera`,
    // el espacio que deja libre se aprovecha para el temario.
    primera ? el('div', { class: 'encabezado-programa' }, [
      config.logoDataUrl ? el('img', { class: 'logo-programa', src: config.logoDataUrl }) : null,
      el('div', { class: 'titulo-programa' }, [
        el('div', {}, 'COLEGIO CULTURAL MÉXICO-ARAGÓN, S.C.'),
        el('div', {}, 'DIRECCIÓN TÉCNICA DE SECUNDARIA'),
        el('div', {}, 'ÁREA I DIRECTIVA'),
        el('div', {}, 'PROGRAMA DE ACTIVIDADES ACADÉMICAS'),
      ]),
    ]) : null,
    // soloPie: el temario ya se acabó en la hoja anterior y aquí solo siguen
    // las observaciones y los nombres (sin una tabla del temario vacía).
    soloPie ? el('div', { class: 'cuerpo-programa cuerpo-solo-pie' }, [
      ...filasDatos,
      el('div', { class: 'fila-observaciones-programa' }, [
        el('strong', {}, 'OBSERVACIONES: '),
        el('span', { class: 'texto-observaciones-programa' }, programa.observaciones || ''),
      ]),
    ]) : el('div', { class: 'cuerpo-programa' }, [
      ...filasDatos,
      el('div', { class: 'barra-temario' }, 'TEMARIO'),
      el('div', {
        class: 'fila-temario',
        style: `grid-template-columns: ${anchos.map((a) => `${a * 100}%`).join(' ')};`,
      }, [
        columnaTemario('FECHAS DEL TRIMESTRE', programa.fechasTrimestre, ventana),
        columnaTemario('CONTENIDOS', programa.procesosDesarrollo, ventana),
        columnaTemario('ORIENTACIONES DIDÁCTICAS', programa.orientacionesDidacticas, ventana),
        colCriterios,
      ]),
      conPie ? el('div', { class: 'fila-observaciones-programa' }, [
        el('strong', {}, 'OBSERVACIONES: '),
        el('span', { class: 'texto-observaciones-programa' }, programa.observaciones || ''),
      ]) : null,
    ]),
    conPie ? el('div', { class: 'pie-programa' }, [
      el('div', { class: 'firma-pie-programa' }, [
        el('div', { class: 'etiqueta-elaboro' }, 'ELABORÓ'),
        el('div', {}, `PROFR. (A) ${nombreElaboro(programa)}`.trim()),
      ]),
      el('div', { class: 'firma-pie-programa' }, [
        el('div', { class: 'etiqueta-elaboro' }, 'VO. BO. DE COORDINACIÓN'),
        el('div', {}, `LIC. ${programa.coordinadora || ''}`.trim()),
      ]),
    ]) : null,
    totalHojas > 1 ? el('div', { class: 'numero-hoja-programa' }, `Hoja ${hoja} de ${totalHojas}`) : null,
  ]);
}

// Lugar oculto para medir: lleva las mismas variables de la hoja (fuente, alto de
// renglón) para que lo que se mide aquí sea lo que se ve.
function conHuesped(programa, hijos, medir) {
  const huesped = el('div', {
    class: 'pagina-programa',
    style: `position:absolute; left:-9999px; top:0; visibility:hidden; padding:0; --lh-temario:${altoLineaTemarioPx(programa)}px;`,
  }, hijos);
  document.body.appendChild(huesped);
  try {
    return medir();
  } finally {
    huesped.remove();
  }
}

// Alto de cada columna del temario para cada ancho posible (en pasos de 1 %).
function alturasPorAncho(programa) {
  const W = anchoTemarioPx(programa);
  const textos = [programa.fechasTrimestre, programa.procesosDesarrollo, programa.orientacionesDidacticas].map(textoTemario);
  const margenTexto = 0.2 * PX_POR_CM;
  const cajasTexto = textos.map((t) => el('div', { class: 'texto-col-temario', style: 'box-sizing:border-box;' }, t || ''));
  const tabla = tablaCriterios(programa);
  const cajaCriterios = el('div', { style: 'box-sizing:border-box;' }, [tabla]);
  const firmas = bloqueFirmas();
  firmas.style.flex = 'none';

  return conHuesped(programa, [...cajasTexto, cajaCriterios, firmas], () => {
    const altoFirmas = firmas.getBoundingClientRect().height;
    return [0, 1, 2, 3].map((i) => {
      const puntos = [];
      for (let f = ANCHOS_MINIMOS[i]; f <= ANCHOS_MAXIMOS[i] + 1e-9; f += 0.01) {
        const anchoPx = f * W - (i < 3 ? BORDE_COLUMNA_PX : 0);
        let alto;
        if (i < 3) {
          cajasTexto[i].style.width = `${anchoPx}px`;
          alto = (textos[i] ? cajasTexto[i].getBoundingClientRect().height : 0) + margenTexto;
        } else {
          cajaCriterios.style.width = `${anchoPx}px`;
          alto = tabla.getBoundingClientRect().height + altoFirmas;
        }
        puntos.push({ f, alto });
      }
      return puntos;
    });
  });
}

// Elige los anchos que dejan la columna más alta lo más corta posible: así el
// texto se reparte y se aprovecha el espacio de la hoja. El ancho que sobra se
// reparte en la proporción del formato original.
function elegirAnchos(alturas) {
  const anchoPara = (i, H) => {
    const p = alturas[i].find((x) => x.alto <= H + 0.5);
    return p ? p.f : null;
  };
  const candidatos = [...new Set(alturas.flat().map((x) => x.alto))].sort((a, b) => a - b);
  const factible = (H) => {
    const anchos = [0, 1, 2, 3].map((i) => anchoPara(i, H));
    return anchos.every((a) => a !== null) && anchos.reduce((s, a) => s + a, 0) <= 1 + 1e-9 ? anchos : null;
  };
  let lo = 0;
  let hi = candidatos.length - 1;
  let mejor = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const anchos = factible(candidatos[mid]);
    if (anchos) { mejor = anchos; hi = mid - 1; } else { lo = mid + 1; }
  }
  if (!mejor) return ANCHOS_POR_DEFECTO;
  const sobra = 1 - mejor.reduce((s, a) => s + a, 0);
  return mejor.map((a, i) => a + sobra * ANCHOS_POR_DEFECTO[i]);
}

// Altos (px) de las piezas de la columna de criterios con el ancho elegido.
function medirCriterios(programa, anchos) {
  const anchoPx = anchos[3] * anchoTemarioPx(programa);
  const tabla = tablaCriterios(programa);
  const firmas = bloqueFirmas();
  firmas.style.flex = 'none';
  const caja = el('div', { style: `width:${anchoPx}px;` }, [tabla, firmas]);
  return conHuesped(programa, [caja], () => {
    const filas = [...tabla.rows].map((r) => r.getBoundingClientRect().height);
    const encabezado = filas.shift();
    return { encabezado, filas, firmas: firmas.getBoundingClientRect().height };
  });
}

// Arma una hoja (con la columna de criterios vacía) para saber cuánto espacio le
// queda al temario y cuánto texto tiene.
function medirPagina(programa, config, anchos, opciones) {
  const pagina = renderPaginaPrograma(programa, config, anchos, { ...opciones, lineas: null, medir: true });
  return conHuesped(programa, [pagina], () => {
    const altoTexto = Math.max(...[...pagina.querySelectorAll('.texto-col-temario')].map((t) => t.getBoundingClientRect().height));
    const altoVentana = pagina.querySelector('.contenido-col-temario').getBoundingClientRect().height;
    const col = pagina.querySelector('.col-criterios');
    const altoColumna = col.getBoundingClientRect().height - col.querySelector('.titulo-col-temario').getBoundingClientRect().height;
    return { altoTexto, altoVentana, altoColumna };
  });
}

// Decide los anchos de columna, cuántas hojas hacen falta y qué lleva cada una.
// Si todo cabe en una hoja, es una sola; si no, cada hoja se llena (el texto se
// corta entre renglones y la tabla de criterios entre renglones de la tabla) y
// las observaciones y los nombres van en la última.
function planificarPrograma(programa, config) {
  const lineaPx = altoLineaTemarioPx(programa);
  const anchos = elegirAnchos(alturasPorAncho(programa));
  const crit = medirCriterios(programa, anchos);
  const numFilas = crit.filas.length;
  const altoTablaDesde = (j) => (j < numFilas ? crit.encabezado + crit.filas.slice(j).reduce((s, h) => s + h, 0) : 0);
  const cabe = (alto) => Math.floor(alto / lineaPx + 0.001);

  const hojas = [];
  let desde = 0;
  let fila = 0;
  let firmasPendientes = true;
  let primera = true;
  let medidaUnica = null;
  let totalLineas = 0;
  for (let i = 0; i < 20; i++) {
    if (i > 0 && desde >= totalLineas && fila >= numFilas && !firmasPendientes) {
      hojas.push({ primera: false, conPie: true, soloPie: true, filasDesde: numFilas, filasHasta: numFilas, firmas: false });
      break;
    }
    const conPie = medirPagina(programa, config, anchos, { primera, conPie: true, desde });
    if (i === 0) {
      medidaUnica = conPie;
      totalLineas = Math.ceil(conPie.altoTexto / lineaPx - 0.05);
    }
    const criteriosRestantes = altoTablaDesde(fila) + (firmasPendientes ? crit.firmas : 0);
    if (totalLineas - desde <= cabe(conPie.altoVentana) && criteriosRestantes <= conPie.altoColumna + 0.5) {
      hojas.push({ primera, conPie: true, desde, lineas: null, filasDesde: fila, filasHasta: numFilas, firmas: firmasPendientes });
      break;
    }
    const sinPie = medirPagina(programa, config, anchos, { primera, conPie: false, desde });
    const capacidad = Math.max(1, cabe(sinPie.altoVentana));
    let disponible = sinPie.altoColumna;
    let hasta = fila;
    if (fila < numFilas) {
      disponible -= crit.encabezado;
      while (hasta < numFilas && crit.filas[hasta] <= disponible + 0.5) { disponible -= crit.filas[hasta]; hasta++; }
      if (hasta === fila) hasta = fila + 1; // un renglón más alto que la hoja: va solo
    }
    const ponFirmas = firmasPendientes && hasta >= numFilas && crit.firmas <= disponible + 0.5;
    hojas.push({ primera, conPie: false, desde, lineas: capacidad, filasDesde: fila, filasHasta: hasta, firmas: ponFirmas });
    desde += capacidad;
    fila = hasta;
    if (ponFirmas) firmasPendientes = false;
    primera = false;
  }

  return {
    anchos,
    hojas,
    // Para el Word: el espacio del temario en una sola hoja y lo que mide la tabla de criterios.
    altoTemarioCm: medidaUnica.altoColumna / PX_POR_CM,
    altoTablaCriteriosCm: altoTablaDesde(0) / PX_POR_CM,
  };
}

function renderPaginasPrograma(programa, config, plan = planificarPrograma(programa, config)) {
  return plan.hojas.map((hoja, i) => renderPaginaPrograma(programa, config, plan.anchos, { ...hoja, hoja: i + 1, totalHojas: plan.hojas.length }));
}

function fijarTamanoPapelImpresion(papel) {
  let estilo = document.getElementById('estilo-papel-impresion');
  if (!estilo) {
    estilo = el('style', { id: 'estilo-papel-impresion' });
    document.head.appendChild(estilo);
  }
  estilo.textContent = `@media print { @page { size: ${papel.ancho}cm ${papel.alto}cm; margin: 0; } }`;
}

// Mismo mecanismo que imprimir() en preview.js: sacar la hoja de su lugar y
// colgarla directo de <body> para que no queden páginas en blanco, con el
// tamaño de papel que el maestro eligió para este programa.
function imprimirPrograma(programa) {
  const contenedor = document.querySelector('.hoja-contenedor');
  if (!contenedor) return;

  fijarTamanoPapelImpresion(papelDePrograma(programa));

  const tituloOriginal = document.title;
  document.title = `Programa_${programa.disciplina || 'materia'}_${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''}`.replace(/\s+/g, '_');

  const ancla = document.createComment('hoja-contenedor');
  const padre = contenedor.parentNode;
  padre.insertBefore(ancla, contenedor);
  const raiz = el('div', { class: 'raiz-impresion' }, [contenedor]);
  document.body.appendChild(raiz);
  // El zoom de pantalla (ver ajustarVista) no va al papel.
  const zoomOriginal = contenedor.style.zoom;
  contenedor.style.zoom = '';

  let restaurado = false;
  function restaurar() {
    if (restaurado) return;
    restaurado = true;
    contenedor.style.zoom = zoomOriginal;
    padre.insertBefore(contenedor, ancla);
    ancla.remove();
    raiz.remove();
    document.title = tituloOriginal;
  }

  window.addEventListener('afterprint', restaurar, { once: true });
  try {
    window.print();
  } finally {
    restaurar();
  }
}

// ---------------------------------------------------------------------------
// EDITOR
// ---------------------------------------------------------------------------

export async function montarEditorPrograma(contenedor, programaId, sesion, { onVolver }) {
  clear(contenedor);
  contenedor.appendChild(el('p', {}, 'Cargando programa…'));

  const programa = await obtenerPrograma(programaId);
  if (!programa) {
    clear(contenedor);
    contenedor.appendChild(el('p', {}, 'No se encontró ese programa.'));
    contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver }, '← Volver'));
    return;
  }

  const config = await obtenerConfig();
  if (!programa.cicloEscolar && config.cicloEscolar) programa.cicloEscolar = config.cicloEscolar;

  let guardarTimeout = null;
  const estadoGuardado = el('span', { class: 'estado-guardado' });

  // Esquina de la página: quién hizo el último cambio (ver editadoPorNombre en
  // programasModel.js; los programas anteriores a ese campo muestran a su dueño).
  const ultimaEdicion = el('div', { class: 'ultima-edicion-programa' });
  function pintarUltimaEdicion() {
    const nombre = programa.editadoPorNombre || programa.profesorNombre || 'sin nombre';
    ultimaEdicion.textContent = `Última edición: ${nombre}${programa.updatedAt ? ` · ${fechaCorta(programa.updatedAt)}` : ''}`;
  }
  pintarUltimaEdicion();

  function guardarConDebounce() {
    clearTimeout(guardarTimeout);
    estadoGuardado.textContent = 'Guardando…';
    estadoGuardado.className = 'estado-guardado';
    guardarTimeout = setTimeout(() => {
      programa.editadoPorNombre = sesion.nombre || sesion.email || '';
      programa.editadoPorId = sesion.uid;
      guardarPrograma(programa)
        .then(() => { estadoGuardado.textContent = 'Guardado ✓'; estadoGuardado.className = 'estado-guardado ok'; pintarUltimaEdicion(); })
        .catch((err) => { estadoGuardado.textContent = `No se pudo guardar: ${err.message}`; estadoGuardado.className = 'estado-guardado error'; });
    }, 400);
    repintarPreview();
  }

  const contenedorPreview = el('div', { class: 'hoja-contenedor' });

  // La hoja mide ~28 cm de ancho: en vez de dejarla de un tamaño fijo (que se
  // salía de la caja y se veía recorrida a la derecha), se reduce lo justo para
  // que quepa en el ancho que tenga la vista previa.
  function ajustarVista() {
    const caja = contenedorPreview.parentElement;
    if (!caja || !caja.clientWidth) return;
    const estilo = getComputedStyle(caja);
    const disponible = caja.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight) - 4;
    const anchoHoja = papelDePrograma(programa).ancho * (96 / 2.54);
    contenedorPreview.style.zoom = String(Math.min(1, disponible / anchoHoja));
  }

  // Calcular los anchos de columna mide el texto muchas veces, así que el plan se
  // reutiliza mientras no cambie nada de lo que sale en la hoja, y al escribir la
  // vista previa se redibuja tras una pausa breve en vez de en cada tecla.
  let planCache = { clave: null, plan: null };
  function planActual() {
    const { updatedAt, editadoPorId, editadoPorNombre, ...contenido } = programa;
    const clave = JSON.stringify([contenido, Boolean(config.logoDataUrl)]);
    if (planCache.clave !== clave) planCache = { clave, plan: planificarPrograma(programa, config) };
    return planCache.plan;
  }

  let repintarTimeout = null;
  function repintarPreview({ inmediato = false } = {}) {
    clearTimeout(repintarTimeout);
    const repintar = () => {
      clear(contenedorPreview);
      renderPaginasPrograma(programa, config, planActual()).forEach((pagina) => contenedorPreview.appendChild(pagina));
      ajustarVista();
    };
    if (inmediato) repintar();
    else repintarTimeout = setTimeout(repintar, 250);
  }

  const campoTexto = (etiqueta, valor, onInput, tipo = 'text') => el('div', { class: 'campo' }, [
    el('label', {}, etiqueta),
    el('input', {
      type: tipo, value: valor || '',
      oninput: (e) => { onInput(e.target.value); guardarConDebounce(); },
    }),
  ]);

  const campoArea = (etiqueta, valor, onInput, filas = '4') => el('div', { class: 'campo' }, [
    el('label', {}, etiqueta),
    el('textarea', {
      rows: filas,
      oninput: (e) => { onInput(e.target.value); guardarConDebounce(); },
    }, valor || ''),
  ]);

  const selectorTrimestre = el('select', {
    onchange: (e) => { programa.trimestre = e.target.value; guardarConDebounce(); },
  }, Object.entries(ETIQUETAS_TRIMESTRE).map(([v, t]) => el('option', { value: v, selected: programa.trimestre === v }, t)));

  const listaCriterios = el('div', { class: 'lista-criterios-programa' });
  function pintarCriterios() {
    clear(listaCriterios);
    (programa.criterios || []).forEach((c, i) => {
      listaCriterios.appendChild(el('div', { class: 'fila-criterio-programa' }, [
        el('input', {
          type: 'text', placeholder: `Criterio ${i + 1}`, value: c.nombre,
          oninput: (e) => { c.nombre = e.target.value; guardarConDebounce(); },
        }),
        el('input', {
          type: 'number', placeholder: '%', class: 'input-porcentaje-criterio', value: c.porcentaje,
          oninput: (e) => { c.porcentaje = e.target.value === '' ? '' : parseFloat(e.target.value) || 0; guardarConDebounce(); },
        }),
        el('button', {
          type: 'button', class: 'btn-icono', title: 'Quitar criterio',
          onclick: () => { programa.criterios.splice(i, 1); pintarCriterios(); guardarConDebounce(); },
        }, '✕'),
      ]));
    });
  }
  pintarCriterios();

  // Se llena solo con el nombre del profesor, hasta que se escriba otro aquí.
  const campoElaboro = el('input', {
    type: 'text', value: nombreElaboro(programa),
    oninput: (e) => { programa.elaboro = e.target.value; guardarConDebounce(); },
  });

  const panelDatos = el('div', { class: 'panel' }, [
    el('h2', {}, 'Datos generales'),
    el('div', { class: 'rejilla-campos' }, [
      campoTexto('Disciplina', programa.disciplina, (v) => { programa.disciplina = v; }),
      campoTexto('Campo formativo', programa.campoFormativo, (v) => { programa.campoFormativo = v; }),
      el('div', { class: 'campo' }, [el('label', {}, 'Trimestre'), selectorTrimestre]),
      campoTexto('Ciclo escolar', programa.cicloEscolar, (v) => { programa.cicloEscolar = v; }),
      campoTexto('Nombre del (de la) profesor(a)', programa.profesor, (v) => {
        programa.profesor = v;
        if (typeof programa.elaboro !== 'string') campoElaboro.value = v;
      }),
      campoTexto('Grupos', programa.grupos, (v) => { programa.grupos = v; }),
    ]),
  ]);

  const panelTemario = el('div', { class: 'panel' }, [
    el('h2', {}, 'Temario'),
    el('div', { class: 'campo' }, [
      el('label', {}, 'Interlineado del temario (1 = normal, menos de 1 = más compacto)'),
      el('input', {
        type: 'number', step: '0.05', min: '0.5', max: '3', value: interlineadoTemario(programa),
        oninput: (e) => {
          const v = parseFloat(e.target.value);
          programa.interlineadoTemario = Number.isFinite(v) ? v : null;
          programa.interlineadoElegido = true;
          guardarConDebounce();
        },
      }),
      el('span', { class: 'etiqueta-chica' }, 'Se aplica a fechas, contenidos y orientaciones para que sus renglones sigan alineados. Si el temario no cabe en una hoja, pasa a una segunda.'),
    ]),
    campoArea('Fechas del trimestre', programa.fechasTrimestre, (v) => { programa.fechasTrimestre = v; }),
    campoArea('Contenidos', programa.procesosDesarrollo, (v) => { programa.procesosDesarrollo = v; }),
    campoArea('Orientaciones didácticas', programa.orientacionesDidacticas, (v) => { programa.orientacionesDidacticas = v; }),
  ]);

  const panelCriterios = el('div', { class: 'panel' }, [
    el('h2', {}, 'Criterios de evaluación'),
    listaCriterios,
    el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => { programa.criterios.push(nuevoCriterioPrograma()); pintarCriterios(); guardarConDebounce(); },
    }, '+ Agregar criterio'),
    campoTexto('Evaluación obtenida', programa.evaluacionObtenida, (v) => { programa.evaluacionObtenida = v; }),
  ]);

  const panelObservaciones = el('div', { class: 'panel' }, [
    el('h2', {}, 'Observaciones'),
    campoArea('', programa.observaciones, (v) => { programa.observaciones = v; }, '3'),
  ]);

  const panelFirmas = el('div', { class: 'panel' }, [
    el('h2', {}, 'Nombres al pie de la hoja'),
    el('div', { class: 'rejilla-campos' }, [
      el('div', { class: 'campo' }, [el('label', {}, 'Elaboró (profesor/a)'), campoElaboro]),
      campoTexto('Vo. Bo. de coordinación (coordinadora)', programa.coordinadora, (v) => { programa.coordinadora = v; }),
    ]),
  ]);

  // Igual que en los exámenes: el tamaño de hoja tiene que ser el mismo aquí y
  // en el diálogo de impresión, si no cada hoja se parte en dos al imprimir.
  const selectorPapel = el('select', {
    class: 'selector-papel', title: 'Tamaño de hoja con el que se arma e imprime el programa',
    onchange: (e) => { programa.tamanoPapel = e.target.value; guardarConDebounce(); },
  }, Object.entries(ETIQUETAS_PAPEL_PROGRAMA).map(([valor, etiqueta]) => el('option', {
    value: valor, selected: (programa.tamanoPapel || PAPEL_PROGRAMA_POR_DEFECTO) === valor,
  }, etiqueta)));

  // La librería de Word se descarga al primer clic, así que puede tardar un poco.
  const btnWord = el('button', {
    type: 'button', class: 'btn-secundario', title: 'Archivo .docx para Word 2021 y Word 365',
    onclick: async () => {
      const textoOriginal = btnWord.textContent;
      btnWord.disabled = true; btnWord.textContent = 'Generando Word…';
      try {
        const plan = planActual();
        await exportarProgramaWord(programa, config, papelDePrograma(programa), {
          anchos: plan.anchos, altoTemarioCm: plan.altoTemarioCm, altoTablaCriteriosCm: plan.altoTablaCriteriosCm,
        });
      } catch (err) {
        alert(`No se pudo generar el archivo de Word: ${err.message}`);
      } finally {
        btnWord.disabled = false; btnWord.textContent = textoOriginal;
      }
    },
  }, '⬇ Descargar Word (.docx)');

  const panelPreview = el('div', { class: 'panel panel-preview' }, [
    el('h2', {}, ['Vista previa ', estadoGuardado]),
    el('div', { class: 'acciones-preview' }, [
      el('label', { class: 'campo-papel' }, ['Hoja: ', selectorPapel]),
      el('button', { type: 'button', class: 'btn-primario', onclick: () => imprimirPrograma(programa) }, '🖨 Imprimir / Descargar PDF'),
      btnWord,
    ]),
    el('p', { class: 'etiqueta-chica nota-impresion' }, 'Al imprimir, elige el mismo tamaño de hoja de aquí arriba (en orientación horizontal) y pon Márgenes: Ninguno y Escala: 100% (sin "Ajustar al área de impresión"). Así el PDF sale idéntico a esta vista previa.'),
    contenedorPreview,
  ]);

  const layout = el('div', { class: 'editor-layout' }, [
    el('div', {}, [panelDatos, panelTemario, panelCriterios, panelObservaciones, panelFirmas]),
    panelPreview,
  ]);

  clear(contenedor);
  contenedor.appendChild(el('div', { class: 'barra-superior-programa' }, [
    el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver }, '← Volver a mis programas'),
    ultimaEdicion,
  ]));
  contenedor.appendChild(layout);
  repintarPreview({ inmediato: true });
  if (window.ResizeObserver) new ResizeObserver(ajustarVista).observe(panelPreview);
}
