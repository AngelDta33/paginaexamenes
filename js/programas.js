// Lista de programas de actividades académicas y su editor: un formato fijo de
// una sola hoja horizontal (del tamaño de papel que elija el maestro) con vista
// previa e impresión, sin reactivos ni paginación — solo sirve para este documento.

import { el, clear } from './dom.js';
import {
  listarProgramas, obtenerPrograma, guardarPrograma, eliminarPrograma,
} from './programasStore.js';
import {
  nuevoPrograma, nuevoCriterioPrograma, totalPorcentajeCriterios, ETIQUETAS_TRIMESTRE,
  duplicarPrograma, nombreElaboro, interlineadoTemario, altoLineaTemarioPx,
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

function celdaDatos(clase, etiqueta, valor) {
  return el('div', { class: `celda-datos-programa ${clase}` }, etiqueta ? [el('strong', {}, `${etiqueta}: `), valor || ''] : [valor || '']);
}

// Una columna de texto del temario: se ve como una ventana sobre el texto
// completo. `desde` y `lineas` (en renglones) dicen qué parte se muestra en esta
// hoja; con `lineas` en null la ventana ocupa todo el espacio que le quede.
function columnaTemario(titulo, texto, ventana) {
  const interior = el('div', {
    class: 'texto-col-temario', style: `margin-top:-${ventana.desde * ventana.lineaPx}px;`,
  }, texto || '');
  return el('div', { class: 'col-temario' }, [
    el('div', { class: 'titulo-col-temario' }, titulo),
    el('div', {
      class: 'contenido-col-temario',
      style: ventana.lineas === null ? '' : `flex:none; height:${ventana.lineas * ventana.lineaPx}px;`,
    }, [interior]),
  ]);
}

// Una hoja del programa. La primera lleva los datos y los criterios; las demás
// solo continúan el temario. Las observaciones y los nombres van en la última.
function renderPaginaPrograma(programa, config, {
  primera = true, conPie = true, desde = 0, lineas = null, hoja = 1, totalHojas = 1,
} = {}) {
  const papel = papelDePrograma(programa);
  const lineaPx = altoLineaTemarioPx(programa);
  const ventana = { desde, lineas, lineaPx };
  const criterios = programa.criterios || [];
  const total = totalPorcentajeCriterios(programa);

  // "Porcentaje" lleva lo que vale cada criterio; "Porcentaje obtenido" queda en
  // blanco para escribir a mano lo que sacó el alumno.
  const tablaCriterios = el('table', { class: 'tabla-criterios' }, [
    el('thead', {}, [el('tr', {}, [el('th', {}, 'Criterios'), el('th', {}, 'Porcentaje'), el('th', {}, 'Porcentaje obtenido')])]),
    el('tbody', {}, [
      ...criterios.map((c) => el('tr', {}, [
        el('td', { class: 'celda-criterio-nombre' }, c.nombre || ''),
        el('td', {}, c.porcentaje === '' || c.porcentaje === null || c.porcentaje === undefined ? '' : `${c.porcentaje}%`),
        el('td', {}, ''),
      ])),
      el('tr', { class: 'fila-total' }, [el('td', { class: 'celda-criterio-nombre' }, 'Total'), el('td', {}, `${total}%`), el('td', {}, '')]),
      el('tr', { class: 'fila-evaluacion' }, [el('td', { class: 'celda-criterio-nombre' }, 'Evaluación obtenida'), el('td', {}, ''), el('td', {}, programa.evaluacionObtenida || '')]),
    ]),
  ]);

  const firmas = el('div', { class: 'firmas-programa' }, [
    el('div', { class: 'firma-programa' }, [el('div', { class: 'linea-firma-programa' }), el('div', { class: 'etiqueta-firma-programa' }, 'Firma de enterado (a) al inicio')]),
    el('div', { class: 'firma-programa' }, [el('div', { class: 'linea-firma-programa' }), el('div', { class: 'etiqueta-firma-programa' }, 'Firma de enterado (a) al término')]),
  ]);

  const colCriterios = primera
    ? el('div', { class: 'col-temario col-criterios' }, [
      el('div', { class: 'titulo-col-temario' }, 'CRITERIOS DE EVALUACIÓN'),
      tablaCriterios,
      firmas,
    ])
    : el('div', { class: 'col-temario' }, [el('div', { class: 'titulo-col-temario' }, ' ')]);

  const filasDatos = primera
    ? [
      el('div', { class: 'fila-datos-programa fila-disciplina' }, [
        celdaDatos('', 'DISCIPLINA', programa.disciplina),
        celdaDatos('', 'CAMPO FORMATIVO', programa.campoFormativo),
        el('div', { class: 'celda-datos-programa' }, [el('strong', {}, `${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''}   CICLO ESCOLAR: ${programa.cicloEscolar || '____'}`)]),
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
    el('div', { class: 'encabezado-programa' }, [
      config.logoDataUrl ? el('img', { class: 'logo-programa', src: config.logoDataUrl }) : null,
      el('div', { class: 'titulo-programa' }, [
        el('div', {}, 'COLEGIO CULTURAL MÉXICO-ARAGÓN, S.C.'),
        el('div', {}, 'DIRECCIÓN TÉCNICA DE SECUNDARIA'),
        el('div', {}, 'ÁREA I DIRECTIVA'),
        el('div', {}, 'PROGRAMA DE ACTIVIDADES ACADÉMICAS'),
      ]),
    ]),
    el('div', { class: 'cuerpo-programa' }, [
      ...filasDatos,
      el('div', { class: 'barra-temario' }, 'TEMARIO'),
      el('div', { class: 'fila-temario' }, [
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

// Arma la hoja en un lugar oculto para saber cuánto espacio le queda al temario
// y cuánto texto tiene.
function medirPagina(programa, config, opciones) {
  const huesped = el('div', { style: 'position:absolute; left:-9999px; top:0; visibility:hidden;' });
  document.body.appendChild(huesped);
  const pagina = renderPaginaPrograma(programa, config, { ...opciones, lineas: null });
  huesped.appendChild(pagina);
  const altoTexto = Math.max(...[...pagina.querySelectorAll('.texto-col-temario')].map((t) => t.getBoundingClientRect().height));
  const altoVentana = pagina.querySelector('.contenido-col-temario').getBoundingClientRect().height;
  huesped.remove();
  return { altoTexto, altoVentana };
}

// Decide cuántas hojas hacen falta y qué renglones del temario lleva cada una.
// Si todo cabe en una hoja, es una sola; si no, la primera se llena (sin
// observaciones ni nombres) y el resto sigue en las siguientes hojas.
function repartirPaginas(programa, config) {
  const lineaPx = altoLineaTemarioPx(programa);
  const cabe = (alto) => Math.floor(alto / lineaPx + 0.001);

  const unica = medirPagina(programa, config, { primera: true, conPie: true, desde: 0 });
  const totalLineas = Math.ceil(unica.altoTexto / lineaPx - 0.05);
  if (totalLineas <= cabe(unica.altoVentana)) return [{ primera: true, conPie: true, desde: 0, lineas: null }];

  const hojas = [];
  let desde = 0;
  let primera = true;
  for (let i = 0; i < 20; i++) {
    const conPie = medirPagina(programa, config, { primera, conPie: true, desde });
    if (totalLineas - desde <= cabe(conPie.altoVentana)) {
      hojas.push({ primera, conPie: true, desde, lineas: null });
      return hojas;
    }
    const sinPie = medirPagina(programa, config, { primera, conPie: false, desde });
    const capacidad = Math.max(1, cabe(sinPie.altoVentana));
    hojas.push({ primera, conPie: false, desde, lineas: capacidad });
    desde += capacidad;
    primera = false;
  }
  return hojas;
}

function renderPaginasPrograma(programa, config) {
  const hojas = repartirPaginas(programa, config);
  return hojas.map((hoja, i) => renderPaginaPrograma(programa, config, { ...hoja, hoja: i + 1, totalHojas: hojas.length }));
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

  function repintarPreview() {
    clear(contenedorPreview);
    renderPaginasPrograma(programa, config).forEach((pagina) => contenedorPreview.appendChild(pagina));
    ajustarVista();
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
      el('label', {}, 'Interlineado del temario (0.7 = compacto, 1 = normal)'),
      el('input', {
        type: 'number', step: '0.05', min: '0.5', max: '3', value: interlineadoTemario(programa),
        oninput: (e) => {
          const v = parseFloat(e.target.value);
          programa.interlineadoTemario = Number.isFinite(v) ? v : null;
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
        await exportarProgramaWord(programa, config, papelDePrograma(programa));
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
  repintarPreview();
  if (window.ResizeObserver) new ResizeObserver(ajustarVista).observe(panelPreview);
}
