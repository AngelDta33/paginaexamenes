// Lista de programas de actividades académicas y su editor: un formato fijo de
// una sola hoja (carta horizontal) con vista previa e impresión, sin reactivos
// ni paginación — solo sirve para este documento.

import { el, clear } from './dom.js';
import {
  listarProgramas, obtenerPrograma, guardarPrograma, eliminarPrograma,
} from './programasStore.js';
import {
  nuevoPrograma, nuevoCriterioPrograma, totalPorcentajeCriterios, ETIQUETAS_TRIMESTRE,
} from './programasModel.js';
import { obtenerConfig } from './store.js';
import { esRevisorOAdmin } from './auth.js';

const ANCHO_HOJA_CM = 27.94; // carta horizontal (11 x 8.5in)
const ALTO_HOJA_CM = 21.59;

function fechaCorta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
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

  const cargando = el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'Cargando programas…');
  contenedor.appendChild(cargando);

  let programas;
  try {
    programas = await listarProgramas(sesion);
  } catch (err) {
    cargando.textContent = `No se pudieron cargar los programas: ${err.message}`;
    return;
  }
  cargando.remove();

  if (programas.length === 0) {
    contenedor.appendChild(el('p', { style: 'color:#666; margin-top:1.5rem;' }, soloConsulta ? 'Todavía no hay programas capturados.' : 'Aún no tienes programas. Crea uno para llenar el formato de actividades académicas del trimestre.'));
    return;
  }

  contenedor.appendChild(el('div', { class: 'lista-examenes' }, programas.map((programa) => el('div', { class: 'tarjeta-examen' }, [
    el('h3', {}, programa.disciplina || 'Sin disciplina'),
    el('div', { class: 'meta-chica' }, `${ETIQUETAS_TRIMESTRE[programa.trimestre] || 'sin trimestre'} · ${programa.grupos || 'sin grupos'} · editado ${fechaCorta(programa.updatedAt)}`),
    soloConsulta ? el('div', { class: 'meta-chica' }, `Profesor(a): ${programa.profesorNombre || 'sin nombre'}`) : null,
    el('div', { class: 'acciones-tarjeta' }, [
      el('button', { type: 'button', class: 'btn-primario', onclick: () => onAbrirPrograma(programa.id) }, 'Abrir'),
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

function columnaTemario(titulo, texto) {
  return el('div', { class: 'col-temario' }, [
    el('div', { class: 'titulo-col-temario' }, titulo),
    el('div', { class: 'contenido-col-temario' }, texto || ''),
  ]);
}

function renderPaginaPrograma(programa, config) {
  const criterios = programa.criterios || [];
  const total = totalPorcentajeCriterios(programa);

  const tablaCriterios = el('table', { class: 'tabla-criterios' }, [
    el('thead', {}, [el('tr', {}, [el('th', {}, 'Criterios'), el('th', {}, 'Porcentaje obtenido')])]),
    el('tbody', {}, [
      ...criterios.map((c) => el('tr', {}, [
        el('td', { class: 'celda-criterio-nombre' }, c.nombre || ''),
        el('td', {}, c.porcentaje === '' || c.porcentaje === null || c.porcentaje === undefined ? '' : `${c.porcentaje}%`),
      ])),
      el('tr', { class: 'fila-total' }, [el('td', { class: 'celda-criterio-nombre' }, 'Total'), el('td', {}, `${total}%`)]),
      el('tr', { class: 'fila-evaluacion' }, [el('td', { class: 'celda-criterio-nombre' }, 'Evaluación obtenida'), el('td', {}, programa.evaluacionObtenida || '')]),
    ]),
  ]);

  const firmas = el('div', { class: 'firmas-programa' }, [
    el('div', { class: 'firma-programa' }, [el('div', { class: 'linea-firma-programa' }), el('div', { class: 'etiqueta-firma-programa' }, 'Firma de enterado (a) al inicio')]),
    el('div', { class: 'firma-programa' }, [el('div', { class: 'linea-firma-programa' }), el('div', { class: 'etiqueta-firma-programa' }, 'Firma de enterado (a) al término')]),
  ]);

  const colCriterios = el('div', { class: 'col-temario col-criterios' }, [
    el('div', { class: 'titulo-col-temario' }, 'CRITERIOS DE EVALUACIÓN'),
    tablaCriterios,
    firmas,
  ]);

  return el('div', {
    class: 'page pagina-programa',
    style: `--pagina-ancho:${ANCHO_HOJA_CM}cm; --pagina-alto:${ALTO_HOJA_CM}cm;`,
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
      el('div', { class: 'fila-datos-programa fila-disciplina' }, [
        celdaDatos('', 'DISCIPLINA', programa.disciplina),
        celdaDatos('', 'CAMPO FORMATIVO', programa.campoFormativo),
        el('div', { class: 'celda-datos-programa' }, [el('strong', {}, `${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''}   CICLO ESCOLAR: ${programa.cicloEscolar || '____'}`)]),
      ]),
      el('div', { class: 'fila-datos-programa fila-profesor' }, [
        celdaDatos('', 'NOMBRE DEL (DE LA) PROFESOR (A)', programa.profesor),
        celdaDatos('', 'GRUPOS', programa.grupos),
      ]),
      el('div', { class: 'barra-temario' }, 'TEMARIO'),
      el('div', { class: 'fila-temario' }, [
        columnaTemario('FECHAS DEL TRIMESTRE', programa.fechasTrimestre),
        columnaTemario('PROCESOS DE DESARROLLO DE APRENDIZAJE', programa.procesosDesarrollo),
        columnaTemario('ORIENTACIONES DIDÁCTICAS', programa.orientacionesDidacticas),
        colCriterios,
      ]),
      el('div', { class: 'fila-observaciones-programa' }, [
        el('strong', {}, 'OBSERVACIONES: '),
        el('span', { class: 'texto-observaciones-programa' }, programa.observaciones || ''),
      ]),
    ]),
    el('div', { class: 'pie-programa' }, [
      el('div', { class: 'firma-pie-programa' }, [
        el('div', { class: 'etiqueta-elaboro' }, 'ELABORÓ'),
        el('div', {}, 'PROFR. (A)'),
      ]),
      el('div', { class: 'firma-pie-programa' }, [
        el('div', { class: 'etiqueta-elaboro' }, 'VO. BO. DE COORDINACIÓN'),
        el('div', {}, 'LIC.'),
      ]),
    ]),
  ]);
}

function fijarTamanoPapelImpresion() {
  let estilo = document.getElementById('estilo-papel-impresion');
  if (!estilo) {
    estilo = el('style', { id: 'estilo-papel-impresion' });
    document.head.appendChild(estilo);
  }
  estilo.textContent = `@media print { @page { size: ${ANCHO_HOJA_CM}cm ${ALTO_HOJA_CM}cm; margin: 0; } }`;
}

// Mismo mecanismo que imprimir() en preview.js (sacar la hoja de su lugar y
// colgarla directo de <body> para que no queden páginas en blanco), pero con
// el tamaño fijo de esta hoja en vez del que elige el examen.
function imprimirPrograma(programa) {
  const contenedor = document.querySelector('.hoja-contenedor');
  if (!contenedor) return;

  fijarTamanoPapelImpresion();

  const tituloOriginal = document.title;
  document.title = `Programa_${programa.disciplina || 'materia'}_${ETIQUETAS_TRIMESTRE[programa.trimestre] || ''}`.replace(/\s+/g, '_');

  const ancla = document.createComment('hoja-contenedor');
  const padre = contenedor.parentNode;
  padre.insertBefore(ancla, contenedor);
  const raiz = el('div', { class: 'raiz-impresion' }, [contenedor]);
  document.body.appendChild(raiz);
  const eraCompacta = contenedor.classList.contains('vista-compacta');
  contenedor.classList.remove('vista-compacta');

  let restaurado = false;
  function restaurar() {
    if (restaurado) return;
    restaurado = true;
    if (eraCompacta) contenedor.classList.add('vista-compacta');
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

  const puedeEditar = !esRevisorOAdmin(sesion) || programa.profesorId === sesion.uid;
  const config = await obtenerConfig();
  if (!programa.cicloEscolar && config.cicloEscolar) programa.cicloEscolar = config.cicloEscolar;

  let guardarTimeout = null;
  const estadoGuardado = el('span', { class: 'estado-guardado' });
  function guardarConDebounce() {
    clearTimeout(guardarTimeout);
    estadoGuardado.textContent = 'Guardando…';
    estadoGuardado.className = 'estado-guardado';
    guardarTimeout = setTimeout(() => {
      guardarPrograma(programa)
        .then(() => { estadoGuardado.textContent = 'Guardado ✓'; estadoGuardado.className = 'estado-guardado ok'; })
        .catch((err) => { estadoGuardado.textContent = `No se pudo guardar: ${err.message}`; estadoGuardado.className = 'estado-guardado error'; });
    }, 400);
    repintarPreview();
  }

  const contenedorPreview = el('div', { class: 'hoja-contenedor vista-compacta' });
  function repintarPreview() {
    clear(contenedorPreview);
    contenedorPreview.appendChild(renderPaginaPrograma(programa, config));
  }

  const campoTexto = (etiqueta, valor, onInput, tipo = 'text') => el('div', { class: 'campo' }, [
    el('label', {}, etiqueta),
    el('input', {
      type: tipo, value: valor || '', disabled: !puedeEditar,
      oninput: (e) => { onInput(e.target.value); guardarConDebounce(); },
    }),
  ]);

  const campoArea = (etiqueta, valor, onInput, filas = '4') => el('div', { class: 'campo' }, [
    el('label', {}, etiqueta),
    el('textarea', {
      rows: filas, disabled: !puedeEditar,
      oninput: (e) => { onInput(e.target.value); guardarConDebounce(); },
    }, valor || ''),
  ]);

  const selectorTrimestre = el('select', {
    disabled: !puedeEditar,
    onchange: (e) => { programa.trimestre = e.target.value; guardarConDebounce(); },
  }, Object.entries(ETIQUETAS_TRIMESTRE).map(([v, t]) => el('option', { value: v, selected: programa.trimestre === v }, t)));

  const listaCriterios = el('div', { class: 'lista-criterios-programa' });
  function pintarCriterios() {
    clear(listaCriterios);
    (programa.criterios || []).forEach((c, i) => {
      listaCriterios.appendChild(el('div', { class: 'fila-criterio-programa' }, [
        el('input', {
          type: 'text', placeholder: `Criterio ${i + 1}`, value: c.nombre, disabled: !puedeEditar,
          oninput: (e) => { c.nombre = e.target.value; guardarConDebounce(); },
        }),
        el('input', {
          type: 'number', placeholder: '%', class: 'input-porcentaje-criterio', value: c.porcentaje, disabled: !puedeEditar,
          oninput: (e) => { c.porcentaje = e.target.value === '' ? '' : parseFloat(e.target.value) || 0; guardarConDebounce(); },
        }),
        puedeEditar ? el('button', {
          type: 'button', class: 'btn-icono', title: 'Quitar criterio',
          onclick: () => { programa.criterios.splice(i, 1); pintarCriterios(); guardarConDebounce(); },
        }, '✕') : null,
      ]));
    });
  }
  pintarCriterios();

  const panelDatos = el('div', { class: 'panel' }, [
    el('h2', {}, 'Datos generales'),
    el('div', { class: 'rejilla-campos' }, [
      campoTexto('Disciplina', programa.disciplina, (v) => { programa.disciplina = v; }),
      campoTexto('Campo formativo', programa.campoFormativo, (v) => { programa.campoFormativo = v; }),
      el('div', { class: 'campo' }, [el('label', {}, 'Trimestre'), selectorTrimestre]),
      campoTexto('Ciclo escolar', programa.cicloEscolar, (v) => { programa.cicloEscolar = v; }),
      campoTexto('Nombre del (de la) profesor(a)', programa.profesor, (v) => { programa.profesor = v; }),
      campoTexto('Grupos', programa.grupos, (v) => { programa.grupos = v; }),
    ]),
  ]);

  const panelTemario = el('div', { class: 'panel' }, [
    el('h2', {}, 'Temario'),
    campoArea('Fechas del trimestre', programa.fechasTrimestre, (v) => { programa.fechasTrimestre = v; }),
    campoArea('Procesos de desarrollo de aprendizaje', programa.procesosDesarrollo, (v) => { programa.procesosDesarrollo = v; }),
    campoArea('Orientaciones didácticas', programa.orientacionesDidacticas, (v) => { programa.orientacionesDidacticas = v; }),
  ]);

  const panelCriterios = el('div', { class: 'panel' }, [
    el('h2', {}, 'Criterios de evaluación'),
    listaCriterios,
    puedeEditar ? el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => { programa.criterios.push(nuevoCriterioPrograma()); pintarCriterios(); guardarConDebounce(); },
    }, '+ Agregar criterio') : null,
    campoTexto('Evaluación obtenida', programa.evaluacionObtenida, (v) => { programa.evaluacionObtenida = v; }),
  ]);

  const panelObservaciones = el('div', { class: 'panel' }, [
    el('h2', {}, 'Observaciones'),
    campoArea('', programa.observaciones, (v) => { programa.observaciones = v; }, '3'),
  ]);

  const panelPreview = el('div', { class: 'panel panel-preview' }, [
    el('h2', {}, ['Vista previa ', estadoGuardado]),
    el('div', { class: 'acciones-preview' }, [
      el('button', { type: 'button', class: 'btn-primario', onclick: () => imprimirPrograma(programa) }, '🖨 Imprimir / Descargar PDF'),
    ]),
    el('p', { class: 'etiqueta-chica nota-impresion' }, 'Al imprimir, pon Márgenes: Ninguno y Escala: 100% (sin "Ajustar al área de impresión") y elige orientación horizontal. Así el PDF sale idéntico a esta vista previa.'),
    contenedorPreview,
  ]);

  const layout = el('div', { class: 'editor-layout' }, [
    el('div', {}, [panelDatos, panelTemario, panelCriterios, panelObservaciones]),
    panelPreview,
  ]);

  clear(contenedor);
  contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, '← Volver a mis programas'));
  if (!puedeEditar) {
    contenedor.appendChild(el('p', { class: 'aviso-solo-lectura' }, 'Este programa es de otro(a) profesor(a); solo puedes consultarlo.'));
  }
  contenedor.appendChild(layout);
  repintarPreview();
}
