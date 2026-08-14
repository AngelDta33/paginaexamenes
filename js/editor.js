// UI del constructor de exámenes: encabezado, secciones, reactivos, validación,
// flujo de revisión (enviar / aprobar / regresar a borrador) y panel de vista previa.

import { el, clear } from './dom.js';
import {
  nuevaSeccion, nuevaPregunta, TIPOS_PREGUNTA, subtotalSeccion, totalExamen, numerarReactivos,
  validarExamen, ETIQUETAS_ESTADO,
} from './model.js';
import { crearEditorPregunta } from './questionTypes.js';
import { guardarExamen, obtenerConfig, exportarExamenJSON } from './store.js';
import { pintarVistaPrevia, imprimir } from './preview.js';
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

  if (puedeEditar) {
    const campoTexto = (etiqueta, valor, onInput, tipo = 'text') => el('div', { class: 'campo' }, [
      el('label', {}, etiqueta),
      el('input', { type: tipo, value: valor || '', oninput: (e) => { onInput(e.target.value); guardarYActualizar(); } }),
    ]);

    const selectorTipoExamen = el('select', {
      onchange: (e) => { examen.tipoExamen = e.target.value; guardarYActualizar(); },
    }, ['A', 'B'].map((v) => el('option', { value: v, selected: examen.tipoExamen === v }, `Tipo ${v}`)));

    panelEncabezado = el('div', { class: 'panel' }, [
      el('h2', {}, 'Datos generales'),
      el('div', { class: 'rejilla-campos' }, [
        campoTexto('Grado', examen.meta.grado, (v) => { examen.meta.grado = v; }),
        campoTexto('Grupo', examen.meta.grupo, (v) => { examen.meta.grupo = v; }),
        campoTexto('Materia', examen.meta.materia, (v) => { examen.meta.materia = v; }),
        campoTexto('Profesor(a)', examen.meta.profesor, (v) => { examen.meta.profesor = v; }),
        campoTexto('Trimestre', examen.meta.trimestre, (v) => { examen.meta.trimestre = v; }),
        campoTexto('Fecha', examen.meta.fecha, (v) => { examen.meta.fecha = v; }, 'date'),
        el('div', { class: 'campo' }, [el('label', {}, 'Tipo de examen'), selectorTipoExamen]),
        campoTexto('Valor del examen (pts)', examen.meta.valorExamen, (v) => { examen.meta.valorExamen = parseFloat(v) || 0; }, 'number'),
      ]),
      el('div', { class: 'campo', style: 'margin-top:0.6rem;' }, [
        el('label', {}, 'Instrucciones generales'),
        el('textarea', {
          rows: '2',
          oninput: (e) => { examen.instruccionesGenerales = e.target.value; guardarYActualizar(); },
        }, examen.instruccionesGenerales),
      ]),
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
        examen.secciones.length > 1 ? el('button', {
          type: 'button', class: 'btn-icono btn-eliminar', title: 'Eliminar sección',
          onclick: () => { examen.secciones.splice(indice, 1); pintarSecciones(); guardarYActualizar(); },
        }, '🗑 sección') : null,
      ]));

      bloque.appendChild(el('textarea', {
        rows: '1', placeholder: 'Instrucciones específicas de esta sección…', value: seccion.instrucciones,
        oninput: (e) => { seccion.instrucciones = e.target.value; guardarYActualizar(); },
      }, seccion.instrucciones));

      const contenedorPreguntas = el('div', {});
      function pintarPreguntas() {
        clear(contenedorPreguntas);
        seccion.preguntas.forEach((p, pi) => {
          contenedorPreguntas.appendChild(crearEditorPregunta(p, {
            onChange: () => { subtotalSpan.textContent = `Subtotal: ${subtotalSeccion(seccion)} pts`; guardarYActualizar(); },
            onDelete: () => { seccion.preguntas.splice(pi, 1); pintarPreguntas(); guardarYActualizar(); },
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
      barraValidacion.appendChild(el('span', {}, `✔ Los puntos cuadran: ${total} / ${examen.meta.valorExamen} pts. Reactivos: ${Object.keys(numerarReactivos(examen)).length}.`));
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

  const panelPreview = el('div', { class: 'panel panel-preview' }, [
    el('h2', {}, ['Vista previa ', estadoGuardado]),
    el('div', { class: 'acciones-preview' }, [
      btnVerExamen,
      btnVerClave,
      el('button', { type: 'button', class: 'btn-primario', onclick: () => imprimir(examen, modoVista === 'clave') }, '🖨 Imprimir / Descargar PDF'),
      el('button', { type: 'button', class: 'btn-secundario', onclick: () => exportarExamenJSON(examen) }, '⬇ Exportar respaldo (.json)'),
    ]),
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
  obtenerConfig().then((config) => { configCache = config; repintarPreview(); });
}
