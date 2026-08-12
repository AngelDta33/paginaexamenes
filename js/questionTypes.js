// Por cada tipo de reactivo: editor de captura, render para el examen y render para la clave.

import { el, clear } from './dom.js';
import { nuevaSubpregunta } from './model.js';

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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

function campoImagen(pregunta, onChange) {
  const preview = el('div', { class: 'imagen-preview' });
  function pintarPreview() {
    clear(preview);
    if (pregunta.imagen) {
      preview.appendChild(el('img', { src: pregunta.imagen, alt: 'Imagen del reactivo' }));
      preview.appendChild(el('button', {
        type: 'button', class: 'btn-quitar-imagen',
        onclick: () => { pregunta.imagen = null; pintarPreview(); onChange(); },
      }, 'Quitar imagen'));
    }
  }
  pintarPreview();
  const input = el('input', {
    type: 'file', accept: 'image/*',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      pregunta.imagen = await redimensionarImagen(file);
      pintarPreview();
      onChange();
    },
  });
  return el('div', { class: 'campo-imagen' }, [
    el('label', {}, ['Imagen (opcional): ', input]),
    preview,
  ]);
}

function campoEnunciado(pregunta, onChange, placeholder = 'Enunciado del reactivo…') {
  return el('textarea', {
    class: 'input-enunciado', rows: '2', placeholder,
    oninput: (e) => { pregunta.enunciado = e.target.value; onChange(); },
  }, pregunta.enunciado);
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
          type: 'text', value: op, placeholder: `Opción ${LETRAS[i]}`,
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
      }, `${LETRAS[j] || j} — ${valB || '(vacío)'}`)));
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
    cont.appendChild(el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => {
        pregunta.columnaA.push('');
        pregunta.columnaB.push('');
        pregunta.relaciones.push(pregunta.columnaB.length - 1);
        pintar(); onChange();
      },
    }, '+ Agregar par'));

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
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => { pregunta.columnaB.push(''); pintar(); onChange(); },
      }, '+ Agregar distractor a columna B'),
    ]));
  }
  pintar();
  return cont;
}

function editorAbierta(pregunta, onChange) {
  return el('div', { class: 'editor-tipo' }, [
    el('label', {}, [
      'Líneas para responder: ',
      el('input', {
        type: 'number', min: '1', max: '15', value: pregunta.lineasRespuesta,
        oninput: (e) => { pregunta.lineasRespuesta = parseInt(e.target.value, 10) || 1; onChange(); },
      }),
    ]),
    el('label', {}, [
      'Respuesta modelo (solo para la clave):',
      el('textarea', {
        rows: '2', value: pregunta.respuestaModelo,
        oninput: (e) => { pregunta.respuestaModelo = e.target.value; onChange(); },
      }, pregunta.respuestaModelo),
    ]),
  ]);
}

function editorVerdaderoFalso(pregunta, onChange) {
  return el('div', { class: 'editor-tipo' }, [
    el('label', {}, [
      'Respuesta correcta: ',
      el('select', {
        onchange: (e) => { pregunta.respuestaCorrecta = e.target.value === 'true'; onChange(); },
      }, [
        el('option', { value: 'true', selected: pregunta.respuestaCorrecta === true }, 'Verdadero'),
        el('option', { value: 'false', selected: pregunta.respuestaCorrecta === false }, 'Falso'),
      ]),
    ]),
  ]);
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

  cont.appendChild(el('label', {}, [
    'Texto de lectura:',
    el('textarea', {
      rows: '5', placeholder: 'Pega o escribe el texto de comprensión de lectura…',
      oninput: (e) => { pregunta.textoLectura = e.target.value; onChange(); },
    }, pregunta.textoLectura),
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
  lectura_comprension: editorLecturaComprension,
};

const ETIQUETAS_TIPO = {
  opcion_multiple: 'Opción múltiple',
  relacion_columnas: 'Relación de columnas',
  abierta: 'Respuesta abierta',
  verdadero_falso: 'Verdadero / Falso',
  lectura_comprension: 'Lectura de comprensión',
};

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
  if (pregunta.tipo !== 'lectura_comprension') {
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
    el('span', { class: 'enunciado-texto' }, pregunta.enunciado || ''),
    valor !== null ? el('span', { class: 'valor-reactivo' }, ` (${valor} pts)`) : null,
  ]);
}

function bloqueImagen(pregunta) {
  return pregunta.imagen ? el('div', { class: 'imagen-reactivo' }, [el('img', { src: pregunta.imagen })]) : null;
}

function renderOpcionMultiple(pregunta, numero, modoClave) {
  return el('div', { class: 'reactivo' }, [
    encabezadoReactivo(numero, pregunta, pregunta.valor),
    bloqueImagen(pregunta),
    el('div', { class: 'lista-opciones-examen' }, pregunta.opciones.map((op, i) => el('div', {
      class: modoClave && i === pregunta.respuestaCorrecta ? 'opcion-examen opcion-correcta' : 'opcion-examen',
    }, `${modoClave && i === pregunta.respuestaCorrecta ? '● ' : '○ '}${LETRAS[i]}) ${op}`))),
  ]);
}

function renderRelacionColumnas(pregunta, numero, modoClave) {
  const permutado = shuffleDeterminista(pregunta.columnaB, pregunta.id);
  // indiceOriginal -> letra mostrada
  const letraPorIndiceOriginal = {};
  permutado.forEach(([, idxOriginal], posMostrada) => { letraPorIndiceOriginal[idxOriginal] = LETRAS[posMostrada]; });

  const celdasA = pregunta.columnaA.map((valA, i) => el('td', { class: 'celda-relacion celda-a' }, [
    el('span', { class: modoClave ? 'resp-relacion resp-correcta' : 'resp-relacion' }, modoClave ? `(${letraPorIndiceOriginal[pregunta.relaciones[i]]}) ` : '(   ) '),
    `${i + 1}. ${valA}`,
  ]));
  const celdasB = permutado.map(([valB], pos) => el('td', { class: 'celda-relacion celda-b' }, `${LETRAS[pos]}. ${valB}`));

  const maxFilas = Math.max(celdasA.length, celdasB.length);
  const tabla = el('table', { class: 'tabla-relacion' }, [
    el('tbody', {}, Array.from({ length: maxFilas }, (_, i) => el('tr', {}, [
      celdasA[i] || el('td', { class: 'celda-relacion celda-a' }, ''),
      celdasB[i] || el('td', { class: 'celda-relacion celda-b' }, ''),
    ]))),
  ]);

  return el('div', { class: 'reactivo' }, [
    encabezadoReactivo(numero, pregunta, pregunta.valor),
    bloqueImagen(pregunta),
    tabla,
  ]);
}

function renderAbierta(pregunta, numero, modoClave) {
  const cuerpo = [encabezadoReactivo(numero, pregunta, pregunta.valor), bloqueImagen(pregunta)];
  if (modoClave) {
    cuerpo.push(el('div', { class: 'respuesta-modelo' }, `Respuesta modelo: ${pregunta.respuestaModelo || '(no se capturó respuesta modelo)'}`));
  } else {
    for (let i = 0; i < pregunta.lineasRespuesta; i++) cuerpo.push(el('div', { class: 'linea-respuesta' }));
  }
  return el('div', { class: 'reactivo' }, cuerpo);
}

function renderVerdaderoFalso(pregunta, numero, modoClave) {
  return el('div', { class: 'reactivo' }, [
    encabezadoReactivo(numero, pregunta, pregunta.valor),
    bloqueImagen(pregunta),
    el('div', { class: 'vf-opciones' }, [
      el('span', { class: modoClave && pregunta.respuestaCorrecta ? 'vf-opcion vf-correcta' : 'vf-opcion' }, `V (${modoClave && pregunta.respuestaCorrecta ? '✔' : '  '})`),
      el('span', { class: modoClave && !pregunta.respuestaCorrecta ? 'vf-opcion vf-correcta' : 'vf-opcion' }, `F (${modoClave && !pregunta.respuestaCorrecta ? '✔' : '  '})`),
    ]),
  ]);
}

const RENDER_TIPO = {
  opcion_multiple: renderOpcionMultiple,
  relacion_columnas: renderRelacionColumnas,
  abierta: renderAbierta,
  verdadero_falso: renderVerdaderoFalso,
};

export function renderPregunta(pregunta, numero, modoClave) {
  const fn = RENDER_TIPO[pregunta.tipo];
  if (fn) return fn(pregunta, numero, modoClave);
  return el('div', { class: 'reactivo' }, [encabezadoReactivo(numero, pregunta, pregunta.valor)]);
}

export function renderLectura(pregunta, numerosPorId) {
  return el('div', { class: 'reactivo reactivo-lectura' }, [
    pregunta.enunciado ? el('p', { class: 'instrucciones-lectura' }, pregunta.enunciado) : null,
    el('div', { class: 'texto-lectura' }, pregunta.textoLectura),
  ]);
}
