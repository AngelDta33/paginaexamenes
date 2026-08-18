// Por cada tipo de reactivo: editor de captura, render para el examen y render para la clave.

import { el, clear } from './dom.js';
import { atributosTamano } from './imagenes.js';
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
  // Todas las multiplicaciones van con Math.imul a propósito. La versión anterior
  // usaba `s * 1103515245`, y en JS ese producto no cabe en un double sin perder
  // precisión: los bits bajos del resultado quedaban en cero. Como el índice se
  // saca justo de esos bits (`s % (i + 1)`), la baraja salía degenerada — daba un
  // puñado de permutaciones casi ordenadas (1,2,3,5,4,0 y parecidas), así que el
  // banco de palabras de "identificar en imagen" y la columna B de la relación de
  // columnas aparecían prácticamente en orden y el alumno podía contestarlas por
  // posición. Con imul + xorshift32 el reparto ya es uniforme.
  let s = 2166136261; // FNV-1a de 32 bits sobre la semilla
  for (const ch of String(semilla)) {
    s ^= ch.charCodeAt(0);
    s = Math.imul(s, 16777619) >>> 0;
  }
  if (s === 0) s = 0x9e3779b9; // xorshift se queda pegado en cero
  const copia = arr.map((v, i) => [v, i]);
  for (let i = copia.length - 1; i > 0; i--) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
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

// --- Tamaño y posición de la imagen de un reactivo -------------------------
//
// Dos números guardados en la pregunta describen cómo se coloca la imagen en la
// hoja, y los usan por igual el ajustador del editor y el render del examen:
//   imagenAncho  10..100  — ancho como % del ancho útil de la hoja.
//   imagenOffset -100..100 — dónde queda dentro del espacio que le sobra:
//                            -100 pegada a la izquierda, 0 centrada, 100 a la derecha.
// Los reactivos guardados antes de que existiera imagenOffset traen en su lugar
// imagenAlineacion ('left' | 'center' | 'right'); se traduce al vuelo.

const ANCHO_MIN_IMAGEN = 10;

function anchoDeImagen(pregunta) {
  return Math.max(ANCHO_MIN_IMAGEN, Math.min(100, Number(pregunta.imagenAncho) || 100));
}

function offsetDeImagen(pregunta) {
  const guardado = Number(pregunta.imagenOffset);
  if (Number.isFinite(guardado)) return Math.max(-100, Math.min(100, guardado));
  const alineacion = pregunta.imagenAlineacion || 'center';
  if (alineacion === 'left') return -100;
  if (alineacion === 'right') return 100;
  return 0;
}

// Margen izquierdo (% del ancho útil) que le toca a la imagen con ese ancho y ese
// offset: la mitad del espacio sobrante es el centro, y el offset la corre de ahí
// hacia cualquiera de los dos lados.
function margenIzquierdoImagen(ancho, offset) {
  const libre = 100 - ancho;
  return (libre / 2) * (1 + offset / 100);
}

// Inversa de la anterior: qué offset deja la imagen con ese margen izquierdo —
// se usa al redimensionar con el mouse, para que la esquina que NO se está
// arrastrando se quede quieta.
function offsetDesdeMargen(ancho, margenIzquierdo) {
  const libre = 100 - ancho;
  if (libre <= 0) return 0;
  return Math.max(-100, Math.min(100, (margenIzquierdo / (libre / 2) - 1) * 100));
}

// Aplica el ancho y la posición al elemento que representa la imagen en la hoja.
// Si el maestro no activó "modificar orientación", no toca nada y la imagen sigue
// el formato normal del CSS.
function aplicarAjusteImagen(elemento, pregunta) {
  if (!pregunta.imagenModificar) return elemento;
  const ancho = anchoDeImagen(pregunta);
  elemento.style.width = `${ancho}%`;
  elemento.style.maxWidth = '100%';
  elemento.style.maxHeight = 'none';
  elemento.style.marginLeft = `${margenIzquierdoImagen(ancho, offsetDeImagen(pregunta))}%`;
  elemento.style.marginRight = '0';
  return elemento;
}

// Arrastre con el mouse/dedo sobre un elemento: llama a alMover con cuánto se
// movió el puntero en horizontal, medido como % del ancho de `referencia`.
// Usa pointer capture para que el arrastre siga funcionando aunque el puntero se
// salga del elemento (que es justo lo que pasa al agrandar una imagen).
function arrastreHorizontal(elemento, referencia, { alEmpezar, alMover, alSoltar }) {
  elemento.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const anchoRef = referencia.getBoundingClientRect().width || 1;
    const inicioX = e.clientX;
    elemento.setPointerCapture(e.pointerId);
    if (alEmpezar) alEmpezar();

    const mover = (ev) => alMover(((ev.clientX - inicioX) / anchoRef) * 100);
    const soltar = () => {
      elemento.releasePointerCapture(e.pointerId);
      elemento.removeEventListener('pointermove', mover);
      elemento.removeEventListener('pointerup', soltar);
      elemento.removeEventListener('pointercancel', soltar);
      if (alSoltar) alSoltar();
    };
    elemento.addEventListener('pointermove', mover);
    elemento.addEventListener('pointerup', soltar);
    elemento.addEventListener('pointercancel', soltar);
  });
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
  // se puede cambiar (útil cuando una imagen sale de contexto).
  //
  // Hay dos formas de hacerlo y las dos escriben los mismos dos números
  // (imagenAncho / imagenOffset): el lienzo de arriba, donde se arrastra la imagen
  // para moverla y la esquina para agrandarla o achicarla, y los controles de
  // abajo (slider y botones), que siguen ahí para ajustar con precisión o sin mouse.
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

    if (!Number.isFinite(Number(pregunta.imagenAncho))) pregunta.imagenAncho = 100;
    if (!Number.isFinite(Number(pregunta.imagenOffset))) pregunta.imagenOffset = offsetDeImagen(pregunta);

    // El lienzo representa el ancho útil de la hoja: lo que se ve aquí adentro es
    // proporcionalmente lo mismo que va a salir impreso.
    const lienzo = el('div', { class: 'lienzo-ajuste-imagen', title: 'Arrastra la imagen para moverla; jala la esquina para cambiar su tamaño' });
    const marco = el('div', { class: 'imagen-ajustable' }, [
      el('img', { src: pregunta.imagen, draggable: 'false', alt: '' }),
    ]);
    const tirador = el('div', { class: 'tirador-ajuste', title: 'Arrastra para cambiar el tamaño' });
    marco.appendChild(tirador);
    lienzo.appendChild(marco);

    const valorAncho = el('span', { class: 'valor-ancho' });
    const sliderAncho = el('input', { type: 'range', min: String(ANCHO_MIN_IMAGEN), max: '100', step: '1' });

    function pintarMarco() {
      const ancho = anchoDeImagen(pregunta);
      marco.style.width = `${ancho}%`;
      marco.style.marginLeft = `${margenIzquierdoImagen(ancho, offsetDeImagen(pregunta))}%`;
      valorAncho.textContent = `${Math.round(ancho)}%`;
      sliderAncho.value = String(Math.round(ancho));
    }

    function fijarAncho(nuevoAncho, margenFijo) {
      const ancho = Math.max(ANCHO_MIN_IMAGEN, Math.min(100, nuevoAncho));
      pregunta.imagenAncho = Math.round(ancho * 10) / 10;
      // Al redimensionar, la orilla izquierda se queda donde estaba (se jala la
      // esquina derecha); si no, la imagen "salta" mientras se agranda.
      if (margenFijo !== undefined) pregunta.imagenOffset = offsetDesdeMargen(pregunta.imagenAncho, margenFijo);
      pintarMarco();
    }

    function fijarOffset(nuevoOffset) {
      pregunta.imagenOffset = Math.round(Math.max(-100, Math.min(100, nuevoOffset)) * 10) / 10;
      pintarMarco();
    }

    // Mover: arrastrar la imagen. El desplazamiento del puntero (% del lienzo) se
    // convierte a offset dividiéndolo entre el espacio libre a cada lado.
    let offsetInicial = 0;
    arrastreHorizontal(marco, lienzo, {
      alEmpezar: () => { offsetInicial = offsetDeImagen(pregunta); marco.classList.add('arrastrando'); },
      alMover: (deltaPct) => {
        const libre = 100 - anchoDeImagen(pregunta);
        if (libre <= 0) return; // ocupa todo el ancho: no hay a dónde moverla
        fijarOffset(offsetInicial + (deltaPct / (libre / 2)) * 100);
      },
      alSoltar: () => { marco.classList.remove('arrastrando'); onChange(); },
    });

    // Redimensionar: arrastrar el tirador de la esquina.
    let anchoInicial = 100;
    let margenInicial = 0;
    arrastreHorizontal(tirador, lienzo, {
      alEmpezar: () => {
        anchoInicial = anchoDeImagen(pregunta);
        margenInicial = margenIzquierdoImagen(anchoInicial, offsetDeImagen(pregunta));
        marco.classList.add('arrastrando');
      },
      alMover: (deltaPct) => fijarAncho(anchoInicial + deltaPct, margenInicial),
      alSoltar: () => { marco.classList.remove('arrastrando'); onChange(); },
    });

    sliderAncho.oninput = (e) => {
      fijarAncho(parseInt(e.target.value, 10), margenIzquierdoImagen(anchoDeImagen(pregunta), offsetDeImagen(pregunta)));
      onChange();
    };

    const botonesPosicion = [['⇤ Izquierda', -100], ['⇔ Centro', 0], ['Derecha ⇥', 100]].map(([texto, valor]) => el('button', {
      type: 'button', class: 'btn-secundario btn-posicion-imagen',
      onclick: () => { fijarOffset(valor); onChange(); },
    }, texto));

    pintarMarco();
    ajusteCont.appendChild(lienzo);
    ajusteCont.appendChild(el('div', { class: 'controles-ajuste-imagen' }, [
      el('label', {}, ['Ancho: ', sliderAncho, valorAncho]),
      el('span', { class: 'botones-posicion-imagen' }, botonesPosicion),
    ]));
    ajusteCont.appendChild(el('p', { class: 'etiqueta-chica' }, 'Arrastra la imagen dentro del recuadro para moverla y jala la esquina de abajo a la derecha para cambiar su tamaño. El recuadro representa el ancho de la hoja, así que se verá impresa igual que aquí.'));
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
  const accionesMarcadores = el('div', { class: 'acciones-marcadores' });
  const listaMarcadores = el('div', { class: 'lista-marcadores' });

  function repintarTodo() { pintarZona(); pintarAccionesMarcadores(); pintarLista(); }

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
    const wrap = el('div', { class: 'marcadores-wrap' }, [el('img', { src: pregunta.imagen, draggable: 'false', ...atributosTamano(pregunta.imagen) })]);
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
    // El número se ve igual en la imagen esté activa o no la parte — el estado
    // activo/inactivo solo se refleja en la lista de abajo (ver pintarLista);
    // así el docente sigue viendo todos los números con claridad al editar.
    pregunta.marcadores.forEach((m, i) => {
      const badge = el('div', {
        class: 'marcador-badge', style: `left:${m.x}%; top:${m.y}%;`, title: 'Arrastra para mover',
      }, String(i + 1));
      arrastrar(badge, wrap, m);
      wrap.appendChild(badge);
    });
    zonaImagen.appendChild(wrap);
  }

  function pintarAccionesMarcadores() {
    clear(accionesMarcadores);
    if (pregunta.marcadores.length < 2) return; // no aporta con 0 o 1 parte
    accionesMarcadores.appendChild(el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => { pregunta.marcadores.forEach((m) => { m.activo = false; }); onChange(); repintarTodo(); },
    }, 'Desactivar todas'));
    accionesMarcadores.appendChild(el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => { pregunta.marcadores.forEach((m) => { m.activo = true; }); onChange(); repintarTodo(); },
    }, 'Activar todas'));
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
  cont.appendChild(el('p', { class: 'etiqueta-chica' }, 'Haz clic en la imagen para agregar cada parte a identificar; puedes agregar tantas como quieras. Arrastra un número para moverlo. Escribe el nombre correcto de cada parte abajo; con "Desactivar" puedes ocultar una parte del examen sin borrarla. En el examen aparecerá la imagen con los números y un banco de palabras para que el alumno los relacione. Ojo: los números de aquí son solo para que tú las ordenes — en el examen y en la clave se reparten al azar (siempre los mismos para este reactivo) para que el alumno no pueda contestar de corrido; revísalos en la vista previa.'));
  cont.appendChild(accionesMarcadores);
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
  // width/height van a propósito: sin ellos el paginador mide la imagen antes de
  // que se decodifique y le sale altura 0 (ver js/imagenes.js).
  const img = el('img', { src: pregunta.imagen, ...atributosTamano(pregunta.imagen) });
  // Por defecto la imagen usa el formato normal (CSS). Solo si el docente activó
  // "modificar orientación" se aplican el ancho y la posición elegidos.
  aplicarAjusteImagen(img, pregunta);
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
  // Desactivar una parte solo la quita del banco de palabras (para no darle esa
  // ayuda al alumno) — el número sigue en la imagen y su renglón de respuesta
  // se sigue preguntando igual que las partes activas.
  const marcadores = pregunta.marcadores || [];
  const activas = marcadores.filter((m) => m.activo !== false);
  const cuerpo = [encabezadoReactivo(numero, pregunta, pregunta.valor)];

  // Los números del examen NO siguen el orden en que el maestro fue colocando los
  // marcadores. Ese orden casi siempre va de arriba a abajo y coincide con el
  // orden en que capturó los nombres, así que numerarlos así le permitía al alumno
  // deducir las partes por posición en vez de identificarlas. Se barajan con una
  // semilla fija del reactivo para que el examen y la clave siempre coincidan.
  const ordenExamen = shuffleDeterminista(marcadores, `${pregunta.id}#orden`).map(([m]) => m);
  const numeroDeMarcador = new Map(ordenExamen.map((m, i) => [m, i + 1]));

  if (pregunta.imagen) {
    const wrap = el('div', { class: 'identificar-imagen-wrap' }, [
      el('img', { src: pregunta.imagen, ...atributosTamano(pregunta.imagen) }),
    ]);
    // El ajuste va sobre el contenedor, no sobre la imagen: los marcadores están
    // posicionados en % dentro de él, así crecen y se mueven junto con ella.
    aplicarAjusteImagen(wrap, pregunta);
    if (pregunta.imagenModificar) wrap.classList.add('identificar-imagen-ajustada');
    marcadores.forEach((m) => {
      wrap.appendChild(el('span', { class: 'marcador-num', style: `left:${m.x}%; top:${m.y}%;` }, String(numeroDeMarcador.get(m))));
    });
    cuerpo.push(wrap);
  }

  // Banco de palabras barajado (solo en el examen; en la clave se ven las respuestas).
  if (!modoClave && activas.length) {
    const permutado = shuffleDeterminista(activas.map((m) => m.etiqueta), `${pregunta.id}#banco`);
    cuerpo.push(el('div', { class: 'banco-palabras' }, permutado.map(([et]) => el('span', { class: 'palabra-banco' }, et || '—'))));
  }

  const bloques = [{ tipo: 'pregunta-inicio', el: el('div', { class: 'reactivo' }, cuerpo) }];
  ordenExamen.forEach((m, i) => {
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
