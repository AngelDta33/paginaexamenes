// UI del constructor de exámenes: encabezado, secciones, reactivos, validación,
// flujo de revisión (enviar / aprobar / regresar a borrador) y panel de vista previa.

import { el, clear } from './dom.js';
import {
  nuevaSeccion, nuevaPregunta, TIPOS_PREGUNTA, subtotalSeccion, totalExamen, numerarReactivos,
  validarExamen, puntosDeclarados, ETIQUETAS_ESTADO, moverElemento,
  FAMILIAS_FUENTE, TAMANOS_FUENTE, AJUSTES_TEXTO,
} from './model.js';
import { crearEditorPregunta, campoSaltoPagina } from './questionTypes.js';
import { guardarExamen, obtenerConfig, exportarExamenJSON } from './store.js';
import { pintarVistaPrevia, imprimir } from './preview.js';
import { TAMANOS_PAPEL, PAPEL_POR_DEFECTO } from './paginate.js';
import { ETIQUETAS_TRIMESTRE } from './programasModel.js';
import { esRevisorOAdmin as calcularEsRevisorOAdmin } from './auth.js';

function fechaCorta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// sesion = { uid, nombre, rol } de quien tiene la pantalla abierta.
export function montarEditor(contenedor, examen, { sesion, onVolver }) {
  let modoVista = 'examen'; // 'examen' | 'clave'
  let guardarTimeout = null;
  let configCache = null;

  const esRevisorOAdmin = calcularEsRevisorOAdmin(sesion);
  // El formato (márgenes, sangría, interlineado, tipografía de cada sección) es
  // cosa del administrador nada más: un revisor puede corregir el contenido del
  // examen, pero no cambiar el formato estándar de la escuela.
  const esAdministrador = !!sesion && sesion.rol === 'administrador';
  const puedeEditar = esRevisorOAdmin || examen.estado === 'borrador';

  const estadoGuardado = el('span', { class: 'estado-guardado' });

  function guardarConIndicador() {
    return guardarExamen(examen)
      .then(() => { estadoGuardado.textContent = 'Guardado ✓'; estadoGuardado.className = 'estado-guardado ok'; })
      .catch((err) => { estadoGuardado.textContent = `No se pudo guardar: ${err.message}`; estadoGuardado.className = 'estado-guardado error'; });
  }

  function guardarYActualizar() {
    clearTimeout(guardarTimeout);
    estadoGuardado.textContent = 'Guardando…';
    estadoGuardado.className = 'estado-guardado';
    guardarTimeout = setTimeout(guardarConIndicador, 400);
    pintarValidacion();
    repintarPreview();
  }

  clear(contenedor);

  // --- Aviso Tipo B ---
  let avisoTipoB = null;
  if (examen.tipoExamen === 'B' && examen.duplicadoDeId && !examen.revisadoDistinto) {
    avisoTipoB = el('div', { class: 'aviso-tipo-b' }, [
      el('span', {}, '⚠️ Este es el examen Tipo B (duplicado del Tipo A). Recuerda modificar las preguntas para que sean distintas entre sí.'),
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => { examen.revisadoDistinto = true; avisoTipoB.remove(); guardarExamen(examen).catch(console.error); },
      }, 'Ya lo revisé'),
    ]);
  }

  // --- Panel de estado / flujo de revisión ---
  const panelEstado = el('div', { class: 'panel panel-estado' });
  function pintarPanelEstado() {
    clear(panelEstado);
    const botones = [];
    if (sesion.rol === 'maestro' && examen.estado === 'borrador') {
      botones.push(el('button', {
        type: 'button', class: 'btn-primario',
        onclick: async () => {
          examen.estado = 'en_revision';
          await guardarExamen(examen);
          montarEditor(contenedor, examen, { sesion, onVolver });
        },
      }, 'Enviar a revisión'));
    }
    // El docente puede retirar su examen de revisión si se equivocó al enviarlo,
    // para poder corregirlo y volverlo a mandar.
    if (sesion.rol === 'maestro' && examen.estado === 'en_revision') {
      botones.push(el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: async () => {
          if (!confirm('¿Cancelar la revisión y regresar el examen a borrador para poder editarlo?')) return;
          examen.estado = 'borrador';
          await guardarExamen(examen);
          montarEditor(contenedor, examen, { sesion, onVolver });
        },
      }, 'Cancelar revisión'));
    }
    if (esRevisorOAdmin) {
      if (examen.estado !== 'aprobado') {
        botones.push(el('button', {
          type: 'button', class: 'btn-primario',
          onclick: async () => {
            examen.estado = 'aprobado';
            examen.revisadoPor = sesion.nombre;
            examen.revisadoEn = new Date().toISOString();
            await guardarExamen(examen);
            montarEditor(contenedor, examen, { sesion, onVolver });
          },
        }, '✔ Aprobar'));
      }
      if (examen.estado !== 'borrador') {
        botones.push(el('button', {
          type: 'button', class: 'btn-secundario',
          onclick: async () => {
            const texto = prompt('Comentarios para el docente: ¿qué cambios necesita hacer? (Puedes dejarlo vacío.)', '');
            if (texto === null) return; // canceló el diálogo: no se regresa nada
            if (texto.trim()) {
              examen.comentariosRevision = examen.comentariosRevision || [];
              examen.comentariosRevision.push({
                autor: sesion.nombre, fecha: new Date().toISOString(), texto: texto.trim(),
              });
            }
            examen.estado = 'borrador';
            examen.revisadoPor = null;
            examen.revisadoEn = null;
            await guardarExamen(examen);
            montarEditor(contenedor, examen, { sesion, onVolver });
          },
        }, 'Regresar a borrador'));
      }
    }
    panelEstado.appendChild(el('div', { class: 'fila-estado' }, [
      el('span', { class: `insignia-estado insignia-${examen.estado || 'borrador'}` }, ETIQUETAS_ESTADO[examen.estado] || 'Borrador'),
      examen.profesorNombre && esRevisorOAdmin ? el('span', { class: 'detalle-revision' }, `Profesor(a): ${examen.profesorNombre}`) : null,
      examen.revisadoPor ? el('span', { class: 'detalle-revision' }, `Revisado por ${examen.revisadoPor} el ${fechaCorta(examen.revisadoEn)}`) : null,
      ...botones,
    ]));
  }
  pintarPanelEstado();

  // --- Panel de comentarios de revisión (lo que el revisor pidió corregir) ---
  const panelComentarios = el('div', {});
  function pintarComentarios() {
    clear(panelComentarios);
    const comentarios = examen.comentariosRevision || [];
    if (comentarios.length === 0) return;
    const puedeQuitar = sesion.rol === 'maestro' && examen.estado === 'borrador';
    panelComentarios.appendChild(el('div', { class: 'panel panel-comentarios' }, [
      el('h2', {}, '📝 Comentarios de revisión'),
      el('p', { class: 'etiqueta-chica' }, 'Cambios que el revisor pide antes de aprobar el examen.'),
      el('ul', { class: 'lista-comentarios' }, comentarios.map((c, i) => el('li', {}, [
        el('div', { class: 'comentario-texto' }, c.texto),
        el('div', { class: 'comentario-meta' }, `— ${c.autor || 'Revisor'}${c.fecha ? `, ${fechaCorta(c.fecha)}` : ''}`),
        puedeQuitar ? el('button', {
          type: 'button', class: 'btn-icono', title: 'Marcar como resuelto y quitar',
          onclick: () => {
            examen.comentariosRevision.splice(i, 1);
            guardarExamen(examen).catch(console.error);
            pintarComentarios();
          },
        }, '✓') : null,
      ]))),
    ]));
  }
  pintarComentarios();

  // --- Panel encabezado + Reactivos (solo si se puede editar) ---
  let panelEncabezado;
  let panelSecciones;
  let campoCiclo = null;

  if (puedeEditar) {
    const campoTexto = (etiqueta, valor, onInput, tipo = 'text') => el('div', { class: 'campo' }, [
      el('label', {}, etiqueta),
      el('input', { type: tipo, value: valor || '', oninput: (e) => { onInput(e.target.value); guardarYActualizar(); } }),
    ]);

    const selectorTipoExamen = el('select', {
      onchange: (e) => { examen.tipoExamen = e.target.value; guardarYActualizar(); },
    }, ['A', 'B'].map((v) => el('option', { value: v, selected: examen.tipoExamen === v }, `Tipo ${v}`)));

    campoCiclo = el('input', {
      type: 'text', value: examen.meta.cicloEscolar || '',
      oninput: (e) => { examen.meta.cicloEscolar = e.target.value; guardarYActualizar(); },
    });

    // Lista y no texto libre: el título centrado de la hoja se arma con estas
    // etiquetas ("EXAMEN PRIMER TRIMESTRE …"), y escrito a mano no coincidía.
    const selectorTrimestre = el('select', {
      onchange: (e) => { examen.meta.trimestre = e.target.value; guardarYActualizar(); },
    }, [
      el('option', { value: '', selected: !examen.meta.trimestre }, 'Sin trimestre'),
      ...Object.entries(ETIQUETAS_TRIMESTRE).map(([v, t]) => el('option', {
        value: v, selected: String(examen.meta.trimestre) === v,
      }, t)),
    ]);

    // Márgenes, sangría e interlineado de TODO el documento — solo un
    // administrador los puede cambiar; un maestro nunca ve este bloque.
    function panelFormatoDocumento() {
      examen.estiloDocumento = examen.estiloDocumento || {};
      // `valor === '' ? '' : valor` (no `valor || ''`) para que un 0 puesto a
      // propósito se siga viendo como "0" y no como vacío/sin definir. `min`
      // en un <input type=number> es solo una sugerencia visual para las
      // flechitas — no bloquea que se teclee o pegue un negativo, por eso se
      // recorta a mano en oninput.
      const campoNumero = (etiqueta, valor, onInput) => el('label', {}, [
        `${etiqueta} `,
        el('input', {
          type: 'number', step: '0.1', min: '0', placeholder: 'estándar',
          value: valor === null || valor === undefined || valor === '' ? '' : valor,
          oninput: (e) => {
            const texto = e.target.value;
            if (texto === '' || texto === '-') { onInput(null); guardarYActualizar(); return; }
            onInput(Math.max(0, parseFloat(texto) || 0));
            guardarYActualizar();
          },
        }),
      ]);
      return el('div', { class: 'formato-documento-admin' }, [
        el('span', { class: 'etiqueta-formato-admin' }, '🛠 Formato de todo el documento (solo administrador):'),
        campoNumero('Márgenes (cm)', examen.estiloDocumento.margenCm, (v) => { examen.estiloDocumento.margenCm = v; }),
        campoNumero('Sangría (cm)', examen.estiloDocumento.sangriaCm, (v) => { examen.estiloDocumento.sangriaCm = v; }),
        campoNumero('Interlineado', examen.estiloDocumento.interlineado, (v) => { examen.estiloDocumento.interlineado = v; }),
        el('span', { class: 'etiqueta-chica', style: 'flex-basis:100%;' }, 'Solo para este examen. Déjalos vacíos ("estándar") para que use el formato estándar de la escuela, que se captura en Panel Administrador → Parámetros.'),
      ]);
    }

    panelEncabezado = el('div', { class: 'panel' }, [
      el('h2', {}, 'Datos generales'),
      el('div', { class: 'rejilla-campos' }, [
        campoTexto('Grado', examen.meta.grado, (v) => { examen.meta.grado = v; }),
        campoTexto('Grupo', examen.meta.grupo, (v) => { examen.meta.grupo = v; }),
        // El encabezado oficial la llama "Disciplina"; adentro sigue siendo meta.materia.
        campoTexto(examen.formato === 'ingles' ? 'Asignatura' : 'Disciplina', examen.meta.materia, (v) => { examen.meta.materia = v; }),
        campoTexto('Profesor(a)', examen.meta.profesor, (v) => { examen.meta.profesor = v; }),
        el('div', { class: 'campo' }, [el('label', {}, 'Trimestre'), selectorTrimestre]),
        el('div', { class: 'campo' }, [el('label', {}, 'Ciclo escolar'), campoCiclo]),
        el('div', { class: 'campo' }, [el('label', {}, 'Tipo de examen'), selectorTipoExamen]),
        examen.formato === 'ingles' ? null : campoTexto('Total de puntos', puntosDeclarados(examen), (v) => { examen.meta.totalPuntos = parseFloat(v) || 0; }, 'number'),
        campoTexto(`Valor del examen (${examen.formato === 'ingles' ? '%' : 'pts'})`, examen.meta.valorExamen, (v) => { examen.meta.valorExamen = parseFloat(v) || 0; }, 'number'),
      ]),
      examen.formato === 'ingles' ? null : el('p', { class: 'etiqueta-chica' }, '"Total de puntos" es lo que vale el examen en puntos (los reactivos deben sumar exactamente eso). "Valor del examen" es lo que cuenta dentro de la calificación del trimestre. "No. de reactivos" se cuenta solo. Trimestre y ciclo escolar salen impresos en el título de la hoja; la fecha no se imprime, va en blanco para llenarse el día del examen.'),
      examen.formato === 'ingles' ? el('div', { class: 'campo', style: 'margin-top:0.6rem;' }, [
        el('label', {}, 'Título del examen (inglés)'),
        el('textarea', {
          rows: '2', placeholder: 'THIRD-GRADE ENGLISH INTER\nTHIRD TRIMESTRAL EXAM 2025-2026',
          oninput: (e) => { examen.meta.tituloIngles = e.target.value; guardarYActualizar(); },
        }, examen.meta.tituloIngles),
        el('p', { class: 'etiqueta-chica' }, 'Una línea por renglón, centrado en la hoja. "TYPE A/B" se agrega solo, tomado del "Tipo de examen" de arriba.'),
      ]) : null,
      el('div', { class: 'campo', style: 'margin-top:0.6rem;' }, [
        el('label', {}, 'Instrucciones generales'),
        el('textarea', {
          rows: '2',
          oninput: (e) => { examen.instruccionesGenerales = e.target.value; guardarYActualizar(); },
        }, examen.instruccionesGenerales),
      ]),
      esAdministrador ? panelFormatoDocumento() : null,
    ]);

    const contenedorSecciones = el('div', { class: 'contenedor-secciones' });

    function pintarSecciones() {
      clear(contenedorSecciones);
      examen.secciones.forEach((seccion, si) => contenedorSecciones.appendChild(pintarSeccion(seccion, si)));
    }

    function pintarSeccion(seccion, indice) {
      const bloque = el('div', { class: 'seccion-bloque' });
      const subtotalSpan = el('span', { class: 'seccion-subtotal' }, `Subtotal: ${subtotalSeccion(seccion)} pts`);

      bloque.appendChild(el('div', { class: 'seccion-cabecera' }, [
        el('input', {
          type: 'text', placeholder: `Título de la sección ${indice + 1} (opcional)`, value: seccion.titulo,
          oninput: (e) => { seccion.titulo = e.target.value; guardarYActualizar(); },
        }),
        subtotalSpan,
        el('button', {
          type: 'button', class: 'btn-icono', title: 'Mover sección arriba', disabled: indice === 0,
          onclick: indice === 0 ? null : () => {
            moverElemento(examen.secciones, indice, -1);
            pintarSecciones(); guardarYActualizar();
          },
        }, '▲'),
        el('button', {
          type: 'button', class: 'btn-icono', title: 'Mover sección abajo', disabled: indice === examen.secciones.length - 1,
          onclick: indice === examen.secciones.length - 1 ? null : () => {
            moverElemento(examen.secciones, indice, 1);
            pintarSecciones(); guardarYActualizar();
          },
        }, '▼'),
        examen.secciones.length > 1 ? el('button', {
          type: 'button', class: 'btn-icono btn-eliminar', title: 'Eliminar sección',
          onclick: () => { examen.secciones.splice(indice, 1); pintarSecciones(); guardarYActualizar(); },
        }, '🗑 sección') : null,
      ]));

      bloque.appendChild(el('textarea', {
        rows: '1', placeholder: 'Instrucciones específicas de esta sección…', value: seccion.instrucciones,
        oninput: (e) => { seccion.instrucciones = e.target.value; guardarYActualizar(); },
      }, seccion.instrucciones));

      // Comentario de revisión por sección: solo lo escribe revisor/administrador
      // y solo se ve aquí, en el editor — nunca en el examen ni en la vista
      // previa. Así, cuando el examen se regresa a borrador, el docente ve
      // exactamente en qué sección estuvo el error.
      const contenedorComentario = el('div', {});
      function pintarComentarioSeccion() {
        clear(contenedorComentario);
        const comentario = seccion.comentarioRevision;
        if (esRevisorOAdmin) {
          contenedorComentario.appendChild(el('div', { class: 'comentario-seccion comentario-seccion-editable' }, [
            el('label', {}, '💬 Comentario de revisión de esta sección (no aparece en el examen; solo lo ve el profesor aquí en el editor):'),
            el('textarea', {
              rows: '2', placeholder: 'Ej. Falta indicar el valor de este reactivo…', value: comentario ? comentario.texto : '',
              oninput: (e) => {
                const texto = e.target.value;
                seccion.comentarioRevision = texto.trim() ? { texto, autor: sesion.nombre, fecha: new Date().toISOString() } : null;
                guardarYActualizar();
              },
            }, comentario ? comentario.texto : ''),
          ]));
        } else if (comentario) {
          contenedorComentario.appendChild(el('div', { class: 'comentario-seccion comentario-seccion-aviso' }, [
            el('div', { class: 'comentario-seccion-texto' }, comentario.texto),
            el('div', { class: 'comentario-seccion-meta' }, `— ${comentario.autor || 'Revisor'}${comentario.fecha ? `, ${fechaCorta(comentario.fecha)}` : ''}`),
            el('button', {
              type: 'button', class: 'btn-secundario', title: 'Marcar como resuelto y quitar',
              onclick: () => { seccion.comentarioRevision = null; pintarComentarioSeccion(); guardarYActualizar(); },
            }, '✓ Ya lo corregí'),
          ]));
        }
      }
      pintarComentarioSeccion();
      bloque.appendChild(contenedorComentario);

      // Formato de la sección (tipo de letra, tamaño, ajuste de texto): solo
      // lo puede tocar un administrador, y solo afecta esta sección (no el
      // resto del examen). Se aplica en la vista previa/impresión, nunca en
      // el editor mismo.
      if (esAdministrador) {
        seccion.estilo = seccion.estilo || {};
        const selectorFamilia = el('select', {
          onchange: (e) => { seccion.estilo.familia = e.target.value; guardarYActualizar(); },
        }, FAMILIAS_FUENTE.map((f) => el('option', {
          value: f.valor, selected: (seccion.estilo.familia || '') === f.valor,
        }, f.etiqueta)));
        const selectorTamano = el('select', {
          onchange: (e) => { seccion.estilo.tamano = e.target.value; guardarYActualizar(); },
        }, TAMANOS_FUENTE.map((t) => el('option', {
          value: t, selected: (seccion.estilo.tamano || '') === t,
        }, t ? `${t} pt` : 'Predeterminado')));
        const selectorAjuste = el('select', {
          onchange: (e) => { seccion.estilo.ajuste = e.target.value; guardarYActualizar(); },
        }, AJUSTES_TEXTO.map((a) => el('option', {
          value: a.valor, selected: (seccion.estilo.ajuste || '') === a.valor,
        }, a.etiqueta)));
        bloque.appendChild(el('div', { class: 'formato-seccion-admin' }, [
          el('span', { class: 'etiqueta-formato-admin' }, '🛠 Formato de esta sección (solo administrador):'),
          el('label', {}, ['Fuente ', selectorFamilia]),
          el('label', {}, ['Tamaño ', selectorTamano]),
          el('label', {}, ['Ajuste ', selectorAjuste]),
        ]));
      }

      const contenedorPreguntas = el('div', {});
      function pintarPreguntas() {
        clear(contenedorPreguntas);
        seccion.preguntas.forEach((p, pi) => {
          contenedorPreguntas.appendChild(crearEditorPregunta(p, {
            onChange: () => { subtotalSpan.textContent = `Subtotal: ${subtotalSeccion(seccion)} pts`; guardarYActualizar(); },
            onDelete: () => { seccion.preguntas.splice(pi, 1); pintarPreguntas(); guardarYActualizar(); },
            onMoveUp: pi > 0 ? () => {
              moverElemento(seccion.preguntas, pi, -1);
              pintarPreguntas(); guardarYActualizar();
            } : null,
            onMoveDown: pi < seccion.preguntas.length - 1 ? () => {
              moverElemento(seccion.preguntas, pi, 1);
              pintarPreguntas(); guardarYActualizar();
            } : null,
          }));
        });
      }
      pintarPreguntas();
      bloque.appendChild(contenedorPreguntas);

      const selectorTipo = el('select', {}, TIPOS_PREGUNTA.map((t) => el('option', { value: t.valor }, t.etiqueta)));
      bloque.appendChild(el('div', { class: 'agregar-reactivo' }, [
        selectorTipo,
        el('button', {
          type: 'button', class: 'btn-secundario',
          onclick: () => {
            seccion.preguntas.push(nuevaPregunta(selectorTipo.value));
            pintarPreguntas(); guardarYActualizar();
          },
        }, '+ Agregar reactivo'),
      ]));

      bloque.appendChild(campoSaltoPagina(seccion, guardarYActualizar, '📄 Empezar esta sección en una página nueva'));

      return bloque;
    }
    pintarSecciones();

    panelSecciones = el('div', { class: 'panel' }, [
      el('h2', {}, 'Reactivos'),
      contenedorSecciones,
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => { examen.secciones.push(nuevaSeccion()); pintarSecciones(); guardarYActualizar(); },
      }, '+ Agregar sección'),
    ]);
  } else {
    panelEncabezado = el('div', { class: 'panel' }, [
      el('h2', {}, `${examen.meta.materia || 'Sin materia'} — ${examen.meta.grado || ''}${examen.meta.grupo || ''}`),
      el('p', { class: 'aviso-solo-lectura' }, 'Este examen está en revisión o ya fue aprobado, así que no puedes editarlo desde aquí. Usa la vista previa para consultarlo o imprimirlo; si necesitas cambiarlo, pide al revisor que lo regrese a borrador.'),
    ]);
    panelSecciones = el('div', {});
  }

  // --- Barra de validación ---
  const barraValidacion = el('div', { class: 'barra-validacion' });
  function pintarValidacion() {
    clear(barraValidacion);
    const avisos = validarExamen(examen);
    const total = totalExamen(examen);
    if (avisos.length === 0) {
      barraValidacion.className = 'barra-validacion ok';
      barraValidacion.appendChild(el('span', {}, `✔ Los puntos cuadran: ${total} / ${puntosDeclarados(examen)} pts. Reactivos: ${Object.keys(numerarReactivos(examen)).length}.`));
    } else {
      barraValidacion.className = 'barra-validacion aviso';
      barraValidacion.appendChild(el('span', {}, `Revisa lo siguiente antes de imprimir (total actual: ${total} pts):`));
      barraValidacion.appendChild(el('ul', {}, avisos.map((a) => el('li', {}, a.mensaje))));
    }
  }

  // --- Panel de vista previa ---
  const marcoPreview = el('div', { class: 'marco-preview' });
  const contenedorPreview = el('div', { class: 'hoja-contenedor vista-compacta' });
  marcoPreview.appendChild(contenedorPreview);

  function repintarPreview() {
    if (!configCache) return; // aún cargando la config de la escuela
    pintarVistaPrevia(contenedorPreview, examen, configCache, modoVista === 'clave');
  }

  const btnVerExamen = el('button', { type: 'button', class: 'btn-secundario' }, 'Vista: Examen');
  const btnVerClave = el('button', { type: 'button', class: 'btn-secundario' }, 'Vista: Clave');
  function actualizarBotonesModo() {
    btnVerExamen.style.fontWeight = modoVista === 'examen' ? 'bold' : 'normal';
    btnVerClave.style.fontWeight = modoVista === 'clave' ? 'bold' : 'normal';
  }
  btnVerExamen.onclick = () => { modoVista = 'examen'; actualizarBotonesModo(); repintarPreview(); };
  btnVerClave.onclick = () => { modoVista = 'clave'; actualizarBotonesModo(); repintarPreview(); };
  actualizarBotonesModo();

  // El tamaño de papel tiene que ser el mismo aquí y en el diálogo de impresión:
  // si no coinciden, cada hoja se parte en dos al imprimir (contenido cortado +
  // una página casi en blanco). Cambiarlo repagina la vista previa al instante.
  const selectorPapel = el('select', {
    class: 'selector-papel', title: 'Tamaño de hoja con el que se arma e imprime el examen',
    disabled: !puedeEditar,
    onchange: (e) => { examen.tamanoPapel = e.target.value; guardarYActualizar(); },
  }, Object.entries(TAMANOS_PAPEL).map(([valor, papel]) => el('option', {
    value: valor, selected: (examen.tamanoPapel || PAPEL_POR_DEFECTO) === valor,
  }, papel.etiqueta)));

  const panelPreview = el('div', { class: 'panel panel-preview' }, [
    el('h2', {}, ['Vista previa ', estadoGuardado]),
    el('div', { class: 'acciones-preview' }, [
      btnVerExamen,
      btnVerClave,
      el('label', { class: 'campo-papel' }, ['Hoja: ', selectorPapel]),
      el('button', { type: 'button', class: 'btn-primario', onclick: () => imprimir(examen, modoVista === 'clave') }, '🖨 Imprimir / Descargar PDF'),
      el('button', { type: 'button', class: 'btn-secundario', onclick: () => exportarExamenJSON(examen) }, '⬇ Exportar respaldo (.json)'),
    ]),
    el('p', { class: 'etiqueta-chica nota-impresion' }, 'Al imprimir, elige el mismo tamaño de hoja de aquí arriba y pon Márgenes: Ninguno y Escala: 100% (sin "Ajustar al área de impresión"). Así el PDF sale idéntico a esta vista previa.'),
    marcoPreview,
  ]);

  const layout = el('div', { class: 'editor-layout' }, [
    el('div', {}, [panelEncabezado, panelSecciones]),
    panelPreview,
  ]);

  if (avisoTipoB) contenedor.appendChild(avisoTipoB);
  contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, '← Volver a mis exámenes'));
  contenedor.appendChild(panelEstado);
  contenedor.appendChild(panelComentarios);
  contenedor.appendChild(barraValidacion);
  contenedor.appendChild(layout);

  pintarValidacion();
  obtenerConfig().then((config) => {
    configCache = config;
    // Vacío = se hereda el ciclo de "Datos de la escuela"; el placeholder deja
    // ver cuál es sin tener que escribirlo (ver cicloDeExamen en paginate.js).
    if (campoCiclo && config.cicloEscolar) campoCiclo.placeholder = config.cicloEscolar;
    repintarPreview();
  });
}
