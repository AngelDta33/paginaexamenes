// Por cada tipo de reactivo: editor de captura, render para el examen y render para la clave.

import { el, clear } from './dom.js';
import { nuevaSubpregunta, uid } from './model.js';
import { renderTextoFormulas, campoTextoConFormulas } from './formulas.js';

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Letra de una opción/par a partir de su índice (0=A, 25=Z, 26=AA, 27=AB, …
// como las columnas de una hoja de cálculo) para que las listas con más de
// 26 elementos no muestren "undefined" en vez de una letra.
function letraOpcion(indice) {
  let i = indice;
  let letra = '';
  do {
    letra = LETRAS[i % 26] + letra;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return letra;
}

export function redimensionarImagen(file, maxAncho = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxAncho / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Shuffle determinístico a partir de un id (para que el orden de la columna B no cambie entre renders)
function shuffleDeterminista(arr, semilla) {
  let s = 0;
  for (const ch of String(semilla)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const copia = arr.map((v, i) => [v, i]);
  for (let i = copia.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia; // [valorOriginal, indiceOriginal][]
}

// ---------------------------------------------------------------------------
// EDITOR
// ---------------------------------------------------------------------------

function campoValor(pregunta, onChange) {
  return el('label', { class: 'campo-valor' }, [
    'Puntos ',
    el('input', {
      type: 'number', step: '0.1', min: '0', value: pregunta.valor,
      class: 'input-valor',
      oninput: (e) => { pregunta.valor = parseFloat(e.target.value) || 0; onChange(); },
    }),
  ]);
}

// Lee la primera imagen que haya en el portapapeles del sistema (por ejemplo, una
// imagen copiada de internet con "clic derecho → Copiar imagen"). Devuelve un Blob
// o null. Requiere la API de Portapapeles (Chrome/Edge/Firefox modernos).
async function leerImagenDelPortapapeles() {
  if (!navigator.clipboard || !navigator.clipboard.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const tipo = item.types.find((t) => t.startsWith('image/'));
    if (tipo) return item.getType(tipo);
  }
  return null;
}

function campoImagen(pregunta, onChange) {
  const preview = el('div', { class: 'imagen-preview' });
  const ajusteCont = el('div', { class: 'ajuste-imagen' });

  async function aplicarImagen(blobOFile) {
    if (!blobOFile) return;
    pregunta.imagen = await redimensionarImagen(blobOFile);
    pintarPreview();
    pintarAjuste();
    onChange();
  }

  function pintarPreview() {
    clear(preview);
    if (pregunta.imagen) {
      preview.appendChild(el('img', { src: pregunta.imagen, alt: 'Imagen del reactivo' }));
      preview.appendChild(el('button', {
        type: 'button', class: 'btn-quitar-imagen',
        onclick: () => { pregunta.imagen = null; pintarPreview(); pintarAjuste(); onChange(); },
      }, 'Quitar imagen'));
    }
  }

  // Controles de tamaño/posición: ocultos hasta que el docente active "modificar
  // orientación". Por defecto la imagen sigue el formato normal; solo si se activa
  // se pueden cambiar ancho y alineación (útil cuando una imagen sale de contexto).
  function pintarAjuste() {
    clear(ajusteCont);
    if (!pregunta.imagen) return;
    const chkModificar = el('label', { class: 'campo-checkbox' }, [
      el('input', {
        type: 'checkbox', checked: !!pregunta.imagenModificar,
        onchange: (e) => { pregunta.imagenModificar = e.target.checked; pintarAjuste(); onChange(); },
      }),
      ' Modificar orientación (tamaño y posición)',
    ]);
    ajusteCont.appendChild(chkModificar);
    if (!pregunta.imagenModificar) return;

    const anchoActual = Number(pregunta.imagenAncho) || 100;
    const valorAncho = el('span', { class: 'valor-ancho' }, `${anchoActual}%`);
    const sliderAncho = el('input', {
      type: 'range', min: '10', max: '100', step: '5', value: anchoActual,
      oninput: (e) => {
        pregunta.imagenAncho = parseInt(e.target.value, 10);
        valorAncho.textContent = `${pregunta.imagenAncho}%`;
        onChange();
      },
    });
    const selAlineacion = el('select', {
      onchange: (e) => { pregunta.imagenAlineacion = e.target.value; onChange(); },
    }, [
      ['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha'],
    ].map(([v, t]) => el('option', { value: v, selected: (pregunta.imagenAlineacion || 'center') === v }, t)));

    ajusteCont.appendChild(el('div', { class: 'controles-ajuste-imagen' }, [
      el('label', {}, ['Ancho: ', sliderAncho, valorAncho]),
      el('label', {}, ['Posición: ', selAlineacion]),
    ]));
  }

  pintarPreview();
  pintarAjuste();

  const input = el('input', {
    type: 'file', accept: 'image/*',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await aplicarImagen(file);
    },
  });

  const btnPegar = el('button', {
    type: 'button', class: 'btn-secundario btn-pegar-imagen',
    onclick: async () => {
      try {
        const blob = await leerImagenDelPortapapeles();
        if (!blob) {
          alert('No hay ninguna imagen en el portapapeles. Copia una imagen (por ejemplo, clic derecho → Copiar imagen) e inténtalo de nuevo.');
          return;
        }
        await aplicarImagen(blob);
      } catch (err) {
        alert('No se pudo leer el portapapeles. Copia la imagen de nuevo o usa el botón de subir archivo.');
      }
    },
  }, '📋 Pegar imagen copiada');

  return el('div', { class: 'campo-imagen' }, [
    el('label', {}, ['Imagen (opcional): ', input]),
    btnPegar,
    preview,
    ajusteCont,
  ]);
}

function campoEnunciado(pregunta, onChange, placeholder = 'Enunciado del reactivo…') {
  const { contenedor } = campoTextoConFormulas({
    placeholder, valor: pregunta.enunciado, filas: '2',
    oninput: (valor) => { pregunta.enunciado = valor; onChange(); },
  });
  return contenedor;
}

function editorOpcionMultiple(pregunta, onChange) {
  const listaOpciones = el('div', { class: 'lista-opciones' });
  function pintar() {
    clear(listaOpciones);
    pregunta.opciones.forEach((op, i) => {
      listaOpciones.appendChild(el('div', { class: 'fila-opcion' }, [
        el('input', {
          type: 'radio', name: `correcta-${pregunta.id}`, checked: pregunta.respuestaCorrecta === i,
          onchange: () => { pregunta.respuestaCorrecta = i; onChange(); },
        }),
        el('input', {
          type: 'text', value: op, placeholder: `Opción ${letraOpcion(i)}`,
          oninput: (e) => { pregunta.opciones[i] = e.target.value; onChange(); },
        }),
        el('button', {
          type: 'button', class: 'btn-icono', title: 'Quitar opción',
          onclick: () => {
            pregunta.opciones.splice(i, 1);
            if (pregunta.respuestaCorrecta >= pregunta.opciones.length) pregunta.respuestaCorrecta = 0;
            pintar(); onChange();
          },
        }, '✕'),
      ]));
    });
  }
  pintar();
  return el('div', { class: 'editor-tipo' }, [
    listaOpciones,
    el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => { pregunta.opciones.push(''); pintar(); onChange(); },
    }, '+ Agregar opción'),
  ]);
}

function editorRelacionColumnas(pregunta, onChange) {
  const cont = el('div', { class: 'editor-relacion' });
  function pintar() {
    clear(cont);
    const filas = el('div', { class: 'filas-relacion' });
    pregunta.columnaA.forEach((valA, i) => {
      const selector = el('select', {
        onchange: (e) => { pregunta.relaciones[i] = parseInt(e.target.value, 10); onChange(); },
      }, pregunta.columnaB.map((valB, j) => el('option', {
        value: j, selected: pregunta.relaciones[i] === j,
      }, `${letraOpcion(j)} — ${valB || '(vacío)'}`)));
      filas.appendChild(el('div', { class: 'fila-relacion' }, [
        el('input', {
          type: 'text', value: valA, placeholder: `Columna A #${i + 1}`,
          oninput: (e) => { pregunta.columnaA[i] = e.target.value; onChange(); },
        }),
        el('span', {}, '↔'),
        selector,
        el('button', {
          type: 'button', class: 'btn-icono', title: 'Quitar fila',
          onclick: () => { pregunta.columnaA.splice(i, 1); pregunta.relaciones.splice(i, 1); pintar(); onChange(); },
        }, '✕'),
      ]));
    });
    cont.appendChild(filas);

    // Tres botones juntos: agregar solo una fila de la columna A, solo una opción
    // de la columna B (distractores), o un par completo A+B ya relacionado.
    cont.appendChild(el('div', { class: 'barra-nueva barra-relacion' }, [
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => {
          pregunta.columnaA.push('');
          pregunta.relaciones.push(0); // apunta a la primera opción de B por defecto
          pintar(); onChange();
        },
      }, '+ Fila en columna A'),
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => { pregunta.columnaB.push(''); pintar(); onChange(); },
      }, '+ Opción en columna B'),
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => {
          pregunta.columnaA.push('');
          pregunta.columnaB.push('');
          pregunta.relaciones.push(pregunta.columnaB.length - 1);
          pintar(); onChange();
        },
      }, '+ Par (A + B)'),
    ]));

    cont.appendChild(el('div', { class: 'columna-b-editor' }, [
      el('span', { class: 'etiqueta-chica' }, 'Columna B (opciones que verá el alumno; puedes agregar distractores extra):'),
      ...pregunta.columnaB.map((valB, j) => el('div', { class: 'fila-relacion' }, [
        el('input', {
          type: 'text', value: valB, placeholder: `Columna B #${j + 1}`,
          oninput: (e) => { pregunta.columnaB[j] = e.target.value; onChange(); },
        }),
        el('button', {
          type: 'button', class: 'btn-icono', title: 'Quitar de columna B',
          onclick: () => {
            pregunta.columnaB.splice(j, 1);
            pregunta.relaciones = pregunta.relaciones.map((r) => (r >= j ? Math.max(0, r - 1) : r));
            pintar(); onChange();
          },
        }, '✕'),
      ])),
    ]));
  }
  pintar();
  return cont;
}

function editorAbierta(pregunta, onChange) {
  const { contenedor: campoRespuesta } = campoTextoConFormulas({
    valor: pregunta.respuestaModelo, filas: '2',
    oninput: (valor) => { pregunta.respuestaModelo = valor; onChange(); },
  });
  return el('div', { class: 'editor-tipo' }, [
    el('label', {}, [
      'Líneas para responder: ',
      el('input', {
        type: 'number', min: '1', max: '15', value: pregunta.lineasRespuesta,
        oninput: (e) => { pregunta.lineasRespuesta = parseInt(e.target.value, 10) || 1; onChange(); },
      }),
    ]),
    el('div', { class: 'campo' }, [
      el('label', {}, 'Respuesta modelo (solo para la clave):'),
      campoRespuesta,
    ]),
  ]);
}

function editorVerdaderoFalso(pregunta, onChange) {
  const etiquetaV = pregunta.formatoIngles ? 'True' : 'Verdadero';
  const etiquetaF = pregunta.formatoIngles ? 'False' : 'Falso';
  const selectResp = el('select', {
    onchange: (e) => { pregunta.respuestaCorrecta = e.target.value === 'true'; onChange(); },
  }, [
    el('option', { value: 'true', selected: pregunta.respuestaCorrecta === true }, etiquetaV),
    el('option', { value: 'false', selected: pregunta.respuestaCorrecta === false }, etiquetaF),
  ]);
  return el('div', { class: 'editor-tipo' }, [
    el('label', {}, ['Respuesta correcta: ', selectResp]),
    el('label', { class: 'campo-checkbox', style: 'margin-left:0.8rem;' }, [
      el('input', {
        type: 'checkbox', checked: !!pregunta.formatoIngles,
        onchange: (e) => {
          pregunta.formatoIngles = e.target.checked;
          // Repinta las etiquetas del selector (Verdadero/Falso ↔ True/False).
          selectResp.options[0].textContent = pregunta.formatoIngles ? 'True' : 'Verdadero';
          selectResp.options[1].textContent = pregunta.formatoIngles ? 'False' : 'Falso';
          onChange();
        },
      }),
      ' Formato inglés (True / False)',
    ]),
  ]);
}

// Editor de "Identificar en imagen": maneja su propia imagen (con pegado) y una
// zona donde se hace clic para colocar marcadores numerados, arrastrables, cada
// uno con el nombre correcto de la parte. La imagen se maneja aquí (no con el
// campoImagen compartido) para poder repintar los marcadores al cambiarla.
function editorIdentificarImagen(pregunta, onChange) {
  if (!pregunta.marcadores) pregunta.marcadores = [];
  const cont = el('div', { class: 'editor-tipo editor-identificar' });
  const zonaImagen = el('div', { class: 'zona-marcadores' });
  const listaMarcadores = el('div', { class: 'lista-marcadores' });

  function repintarTodo() { pintarZona(); pintarLista(); }

  const campoImg = campoImagen(pregunta, () => { onChange(); repintarTodo(); });

  function arrastrar(badge, wrap, m) {
    badge.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      badge.setPointerCapture(e.pointerId);
      const mover = (ev) => {
        const rect = wrap.getBoundingClientRect();
        m.x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
        m.y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
        badge.style.left = `${m.x}%`;
        badge.style.top = `${m.y}%`;
      };
      const soltar = () => {
        badge.releasePointerCapture(e.pointerId);
        badge.removeEventListener('pointermove', mover);
        badge.removeEventListener('pointerup', soltar);
        m.x = Math.round(m.x * 10) / 10;
        m.y = Math.round(m.y * 10) / 10;
        onChange();
      };
      badge.addEventListener('pointermove', mover);
      badge.addEventListener('pointerup', soltar);
    });
  }

  function pintarZona() {
    clear(zonaImagen);
    if (!pregunta.imagen) {
      zonaImagen.appendChild(el('p', { class: 'etiqueta-chica' }, 'Sube o pega una imagen arriba; luego haz clic sobre ella para colocar cada número donde va una parte a identificar.'));
      return;
    }
    const wrap = el('div', { class: 'marcadores-wrap' }, [el('img', { src: pregunta.imagen, draggable: 'false' })]);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('.marcador-badge')) return; // no crear otro al tocar uno existente
      const rect = wrap.getBoundingClientRect();
      pregunta.marcadores.push({
        id: uid('mrk'),
        x: Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10,
        y: Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10,
        etiqueta: '',
        activo: true,
      });
      onChange(); repintarTodo();
    });
    pregunta.marcadores.forEach((m, i) => {
      const activo = m.activo !== false;
      const badge = el('div', {
        class: activo ? 'marcador-badge' : 'marcador-badge marcador-badge-inactivo',
        style: `left:${m.x}%; top:${m.y}%;`,
        title: activo ? 'Arrastra para mover' : 'Parte desactivada — arrastra para mover',
      }, String(i + 1));
      arrastrar(badge, wrap, m);
      wrap.appendChild(badge);
    });
    zonaImagen.appendChild(wrap);
  }

  function pintarLista() {
    clear(listaMarcadores);
    pregunta.marcadores.forEach((m, i) => {
      const activo = m.activo !== false;
      listaMarcadores.appendChild(el('div', { class: activo ? 'fila-marcador' : 'fila-marcador fila-marcador-inactiva' }, [
        el('span', { class: 'num-marcador' }, `${i + 1}.`),
        el('input', {
          type: 'text', value: m.etiqueta, placeholder: `Nombre de la parte ${i + 1}`,
          oninput: (e) => { m.etiqueta = e.target.value; onChange(); },
        }),
        el('span', { class: activo ? 'estado-activo' : 'estado-inactivo' }, activo ? 'Activo' : 'Inactivo'),
        el('button', {
          type: 'button', class: 'btn-secundario', title: activo ? 'No incluir esta parte en el examen' : 'Volver a incluir esta parte en el examen',
          onclick: () => { m.activo = m.activo === false; onChange(); repintarTodo(); },
        }, activo ? 'Desactivar' : 'Activar'),
        el('button', {
          type: 'button', class: 'btn-icono', title: 'Quitar marcador',
          onclick: () => { pregunta.marcadores.splice(i, 1); onChange(); repintarTodo(); },
        }, '✕'),
      ]));
    });
  }

  repintarTodo();
  cont.appendChild(campoImg);
  cont.appendChild(zonaImagen);
  cont.appendChild(el('p', { class: 'etiqueta-chica' }, 'Haz clic en la imagen para agregar cada parte a identificar; puedes agregar tantas como quieras. Arrastra un número para moverlo. Escribe el nombre correcto de cada parte abajo; con "Desactivar" puedes ocultar una parte del examen sin borrarla. En el examen aparecerá la imagen con los números de las partes activas y un banco de palabras para que el alumno los relacione.'));
  cont.appendChild(listaMarcadores);
  return cont;
}

const TIPOS_SUBPREGUNTA = [
  { valor: 'opcion_multiple', etiqueta: 'Opción múltiple' },
  { valor: 'verdadero_falso', etiqueta: 'Verdadero / Falso' },
  { valor: 'abierta', etiqueta: 'Abierta' },
  { valor: 'relacion_columnas', etiqueta: 'Relación de columnas' },
];

function editorLecturaComprension(pregunta, onChange) {
  const cont = el('div', { class: 'editor-lectura' });
  const subCont = el('div', { class: 'subpreguntas' });

  function pintarSub() {
    clear(subCont);
    pregunta.subpreguntas.forEach((sp, i) => {
      subCont.appendChild(crearEditorPregunta(sp, {
        onChange,
        onDelete: () => { pregunta.subpreguntas.splice(i, 1); pintarSub(); onChange(); },
        subEtiqueta: `Subpregunta ${i + 1}`,
      }));
    });
  }

  const selectorTipo = el('select', {}, TIPOS_SUBPREGUNTA.map((t) => el('option', { value: t.valor }, t.etiqueta)));

  const { contenedor: campoTexto } = campoTextoConFormulas({
    placeholder: 'Pega o escribe el texto de comprensión de lectura…', valor: pregunta.textoLectura, filas: '5',
    oninput: (valor) => { pregunta.textoLectura = valor; onChange(); },
    permitirSangria: true,
  });
  cont.appendChild(el('div', { class: 'campo' }, [
    el('label', {}, 'Texto de lectura:'),
    campoTexto,
    el('p', { class: 'etiqueta-chica' }, 'Consejo: usa la tecla Tab para agregar sangría (por ejemplo, para separar el diálogo de un personaje); Shift+Tab la quita.'),
  ]));
  cont.appendChild(subCont);
  cont.appendChild(el('div', { class: 'agregar-sub' }, [
    selectorTipo,
    el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => {
        pregunta.subpreguntas.push(nuevaSubpregunta(selectorTipo.value));
        pintarSub(); onChange();
      },
    }, '+ Agregar subpregunta'),
  ]));
  pintarSub();
  return cont;
}

const EDITORES_TIPO = {
  opcion_multiple: editorOpcionMultiple,
  relacion_columnas: editorRelacionColumnas,
  abierta: editorAbierta,
  verdadero_falso: editorVerdaderoFalso,
  identificar_imagen: editorIdentificarImagen,
  lectura_comprension: editorLecturaComprension,
};

const ETIQUETAS_TIPO = {
  opcion_multiple: 'Opción múltiple',
  relacion_columnas: 'Relación de columnas',
  abierta: 'Respuesta abierta',
  verdadero_falso: 'Verdadero / Falso',
  identificar_imagen: 'Identificar en imagen',
  lectura_comprension: 'Lectura de comprensión',
};

// Tipos que manejan su propia imagen dentro del editor (no usan el campoImagen
// compartido que agrega crearEditorPregunta).
const TIPOS_IMAGEN_PROPIA = new Set(['identificar_imagen']);

export function crearEditorPregunta(pregunta, { onChange, onDelete, subEtiqueta }) {
  const cabecera = el('div', { class: 'cabecera-pregunta' }, [
    el('span', { class: 'etiqueta-tipo' }, subEtiqueta ? `${subEtiqueta} — ${ETIQUETAS_TIPO[pregunta.tipo]}` : ETIQUETAS_TIPO[pregunta.tipo]),
    pregunta.tipo !== 'lectura_comprension' ? campoValor(pregunta, onChange) : null,
    el('button', { type: 'button', class: 'btn-icono btn-eliminar', title: 'Eliminar reactivo', onclick: onDelete }, '🗑'),
  ]);

  const cuerpo = [cabecera];
  if (pregunta.tipo !== 'lectura_comprension') {
    cuerpo.push(campoEnunciado(pregunta, onChange));
  }
  const editorFn = EDITORES_TIPO[pregunta.tipo] || editorAbierta;
  cuerpo.push(editorFn(pregunta, onChange));
  if (pregunta.tipo !== 'lectura_comprension' && !TIPOS_IMAGEN_PROPIA.has(pregunta.tipo)) {
    cuerpo.push(campoImagen(pregunta, onChange));
  }

  return el('div', { class: 'tarjeta-pregunta' }, cuerpo);
}

// ---------------------------------------------------------------------------
// RENDER PARA EXAMEN / CLAVE
// ---------------------------------------------------------------------------

function encabezadoReactivo(numero, pregunta, valor) {
  return el('div', { class: 'reactivo-encabezado' }, [
    el('span', { class: 'num-reactivo' }, `${numero}. `),
    el('span', { class: 'enunciado-texto' }, renderTextoFormulas(pregunta.enunciado || '')),
    valor !== null ? el('span', { class: 'valor-reactivo' }, ` (${valor} pts)`) : null,
  ]);
}

function bloqueImagen(pregunta) {
  if (!pregunta.imagen) return null;
  const img = el('img', { src: pregunta.imagen });
  // Por defecto la imagen usa el formato normal (CSS). Solo si el docente activó
  // "modificar orientación" se aplica el ancho y la alineación elegidos.
  if (pregunta.imagenModificar) {
    const ancho = Math.max(10, Math.min(100, Number(pregunta.imagenAncho) || 100));
    img.style.width = `${ancho}%`;
    img.style.maxHeight = 'none';
    const align = pregunta.imagenAlineacion || 'center';
    img.style.marginLeft = align === 'left' ? '0' : 'auto';
    img.style.marginRight = align === 'right' ? '0' : 'auto';
  }
  return el('div', { class: 'imagen-reactivo' }, [img]);
}

// Devuelve la pregunta como varios bloques — el encabezado y una por opción — en
// vez de un solo div con todas las opciones adentro, para que el paginador pueda
// cortar la lista entre opciones si un reactivo con muchas no cabe completo en
// una página (mismo motivo que renderLecturaBloques).
function renderOpcionMultipleBloques(pregunta, numero, modoClave) {
  const bloques = [{
    tipo: 'pregunta-inicio',
    el: el('div', { class: 'reactivo' }, [encabezadoReactivo(numero, pregunta, pregunta.valor), bloqueImagen(pregunta)]),
  }];
  pregunta.opciones.forEach((op, i) => {
    const clases = ['opcion-examen'];
    if (i === 0) clases.push('opcion-examen-primera');
    if (modoClave && i === pregunta.respuestaCorrecta) clases.push('opcion-correcta');
    bloques.push({
      tipo: 'pregunta-opcion',
      el: el('div', { class: clases.join(' ') }, [
        `${modoClave && i === pregunta.respuestaCorrecta ? '● ' : '○ '}${letraOpcion(i)}) `,
        ...renderTextoFormulas(op),
      ]),
    });
  });
  return bloques;
}

// Mismo motivo que arriba: el encabezado y una mini-tabla de una sola fila por
// cada par, en vez de una tabla gigante con todas las filas adentro.
function renderRelacionColumnasBloques(pregunta, numero, modoClave) {
  const permutado = shuffleDeterminista(pregunta.columnaB, pregunta.id);
  // indiceOriginal -> letra mostrada
  const letraPorIndiceOriginal = {};
  permutado.forEach(([, idxOriginal], posMostrada) => { letraPorIndiceOriginal[idxOriginal] = letraOpcion(posMostrada); });

  const celdasA = pregunta.columnaA.map((valA, i) => el('td', { class: 'celda-relacion celda-a' }, [
    el('span', { class: modoClave ? 'resp-relacion resp-correcta' : 'resp-relacion' }, modoClave ? `(${letraPorIndiceOriginal[pregunta.relaciones[i]]}) ` : '(   ) '),
    `${i + 1}. `,
    ...renderTextoFormulas(valA),
  ]));
  const celdasB = permutado.map(([valB], pos) => el('td', { class: 'celda-relacion celda-b' }, [
    `${letraOpcion(pos)}. `,
    ...renderTextoFormulas(valB),
  ]));

  const maxFilas = Math.max(celdasA.length, celdasB.length);
  const bloques = [{
    tipo: 'pregunta-inicio',
    el: el('div', { class: 'reactivo' }, [encabezadoReactivo(numero, pregunta, pregunta.valor), bloqueImagen(pregunta)]),
  }];
  for (let i = 0; i < maxFilas; i++) {
    bloques.push({
      tipo: 'pregunta-fila',
      el: el('table', { class: `tabla-relacion${i === 0 ? ' tabla-relacion-primera' : ''}` }, [
        el('tbody', {}, [el('tr', {}, [
          celdasA[i] || el('td', { class: 'celda-relacion celda-a' }, ''),
          celdasB[i] || el('td', { class: 'celda-relacion celda-b' }, ''),
        ])]),
      ]),
    });
  }
  return bloques;
}

function renderAbierta(pregunta, numero, modoClave) {
  const cuerpo = [encabezadoReactivo(numero, pregunta, pregunta.valor), bloqueImagen(pregunta)];
  if (modoClave) {
    cuerpo.push(el('div', { class: 'respuesta-modelo' }, [
      'Respuesta modelo: ',
      ...(pregunta.respuestaModelo ? renderTextoFormulas(pregunta.respuestaModelo) : ['(no se capturó respuesta modelo)']),
    ]));
  } else {
    for (let i = 0; i < pregunta.lineasRespuesta; i++) cuerpo.push(el('div', { class: 'linea-respuesta' }));
  }
  return el('div', { class: 'reactivo' }, cuerpo);
}

function renderVerdaderoFalso(pregunta, numero, modoClave) {
  const inV = pregunta.formatoIngles ? 'T' : 'V';
  const inF = pregunta.formatoIngles ? 'F' : 'F';
  return el('div', { class: 'reactivo' }, [
    encabezadoReactivo(numero, pregunta, pregunta.valor),
    bloqueImagen(pregunta),
    el('div', { class: 'vf-opciones' }, [
      el('span', { class: modoClave && pregunta.respuestaCorrecta ? 'vf-opcion vf-correcta' : 'vf-opcion' }, `${inV} (${modoClave && pregunta.respuestaCorrecta ? '✔' : '  '})`),
      el('span', { class: modoClave && !pregunta.respuestaCorrecta ? 'vf-opcion vf-correcta' : 'vf-opcion' }, `${inF} (${modoClave && !pregunta.respuestaCorrecta ? '✔' : '  '})`),
    ]),
  ]);
}

// Mismo motivo que arriba: la imagen (acotada a 9cm, los marcadores no le suman
// alto porque van encima) y el banco de palabras quedan en un solo bloque inicial,
// pero la lista de respuestas numeradas —la parte que crece con la cantidad de
// marcadores— se parte en un bloque por renglón.
function renderIdentificarImagenBloques(pregunta, numero, modoClave) {
  // Las partes desactivadas por el docente no cuentan en el examen: no llevan
  // número sobre la imagen, no aparecen en el banco de palabras ni en la lista
  // de respuestas — mismo criterio que un alumno inactivo en Grupos.
  const marcadores = (pregunta.marcadores || []).filter((m) => m.activo !== false);
  const cuerpo = [encabezadoReactivo(numero, pregunta, pregunta.valor)];

  if (pregunta.imagen) {
    const wrap = el('div', { class: 'identificar-imagen-wrap' }, [el('img', { src: pregunta.imagen })]);
    marcadores.forEach((m, i) => {
      wrap.appendChild(el('span', { class: 'marcador-num', style: `left:${m.x}%; top:${m.y}%;` }, String(i + 1)));
    });
    cuerpo.push(wrap);
  }

  // Banco de palabras barajado (solo en el examen; en la clave se ven las respuestas).
  if (!modoClave && marcadores.length) {
    const permutado = shuffleDeterminista(marcadores.map((m) => m.etiqueta), pregunta.id);
    cuerpo.push(el('div', { class: 'banco-palabras' }, permutado.map(([et]) => el('span', { class: 'palabra-banco' }, et || '—'))));
  }

  const bloques = [{ tipo: 'pregunta-inicio', el: el('div', { class: 'reactivo' }, cuerpo) }];
  marcadores.forEach((m, i) => {
    bloques.push({
      tipo: 'pregunta-fila',
      el: el('div', { class: `fila-resp-identificar${i === 0 ? ' fila-resp-identificar-primera' : ''}` }, [
        el('span', { class: 'num-resp' }, `${i + 1}. `),
        modoClave
          ? el('span', { class: 'resp-relacion resp-correcta' }, m.etiqueta || '(sin nombre)')
          : el('span', { class: 'linea-resp-inline' }),
      ]),
    });
  });
  return bloques;
}

// Tipos cuyo contenido está acotado por diseño (verdadero_falso: dos opciones fijas;
// abierta: máximo 15 líneas de respuesta) — se quedan como un solo bloque, no
// necesitan poder partirse entre páginas.
const RENDER_TIPO = {
  abierta: renderAbierta,
  verdadero_falso: renderVerdaderoFalso,
};

export function renderPregunta(pregunta, numero, modoClave) {
  const fn = RENDER_TIPO[pregunta.tipo];
  if (fn) return fn(pregunta, numero, modoClave);
  return el('div', { class: 'reactivo' }, [encabezadoReactivo(numero, pregunta, pregunta.valor)]);
}

// Tipos cuyo contenido crece con lo que capture el maestro (opciones, filas de
// relación, marcadores) y por eso se devuelven como varios bloques repartibles.
const RENDER_TIPO_BLOQUES = {
  opcion_multiple: renderOpcionMultipleBloques,
  relacion_columnas: renderRelacionColumnasBloques,
  identificar_imagen: renderIdentificarImagenBloques,
};

// Punto de entrada único para el paginador: siempre devuelve un arreglo de
// bloques, sea uno solo (renderPregunta) o varios (tipos con listas que pueden
// crecer sin límite).
export function renderPreguntaBloques(pregunta, numero, modoClave) {
  const fn = RENDER_TIPO_BLOQUES[pregunta.tipo];
  if (fn) return fn(pregunta, numero, modoClave);
  return [{ tipo: 'pregunta', el: renderPregunta(pregunta, numero, modoClave) }];
}

// Devuelve el texto de lectura como una lista de bloques — uno por línea — en vez
// de un solo div gigante, para que el paginador pueda cortar entre líneas cuando
// el texto no cabe completo en una página (si fuera un solo bloque, uno más alto
// que la página se saldría del margen sin que el paginador pudiera partirlo).
// Cada línea comparte el mismo fondo y bordes laterales, y solo la primera/última
// línea llevan borde arriba/abajo, para que se vea como un solo recuadro continuo
// aunque quede repartido en dos páginas.
export function renderLecturaBloques(pregunta) {
  const bloques = [];
  if (pregunta.enunciado) {
    bloques.push({ tipo: 'lectura-intro', el: el('p', { class: 'instrucciones-lectura' }, renderTextoFormulas(pregunta.enunciado)) });
  }
  const lineas = (pregunta.textoLectura || '').split('\n');
  lineas.forEach((linea, i) => {
    const clases = ['texto-lectura-linea'];
    if (i === 0) clases.push('texto-lectura-linea-primera');
    if (i === lineas.length - 1) clases.push('texto-lectura-linea-ultima');
    bloques.push({
      tipo: 'lectura-linea',
      el: el('div', { class: clases.join(' ') }, linea ? renderTextoFormulas(linea) : ' '),
    });
  });
  return bloques;
}
