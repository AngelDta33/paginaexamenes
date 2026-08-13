// Fórmulas matemáticas dentro de cualquier texto de un reactivo: se guardan como
// $$...$$ (doble signo de pesos, para no chocar con precios como "$50" escritos
// a mano) y se renderizan con KaTeX. Para que el maestro NUNCA tenga que escribir
// esa sintaxis a mano, se componen con MathLive: un editor visual tipo
// calculadora/Photomath donde se navega entre casillas (numerador, exponente,
// etc.) tocando o con las flechas, en vez de escribir texto con símbolos.

import { el } from './dom.js';
import { MathfieldElement } from 'https://cdn.jsdelivr.net/npm/mathlive@0.110.0/mathlive.min.mjs';

MathfieldElement.soundsDirectory = null;

const REGEX_FORMULA = /\$\$([^$]+?)\$\$/g;

// Devuelve un arreglo de strings y <span> ya renderizados con KaTeX, listo para
// usarse como children de el(...) — el() ya sabe mezclar strings y nodos.
// Con { editable: true, onEditar } cada fórmula se puede tocar para reabrir el
// editor visual y modificarla o borrarla — usado en el campo de captura (que ya
// no muestra el texto crudo "$$...$$" en ningún lado, solo la fórmula tal cual
// se va a ver); nunca en la vista de examen/PDF/clave, que es de solo lectura.
export function renderTextoFormulas(texto, { editable = false, onEditar } = {}) {
  if (!texto) return [];
  const partes = [];
  let ultimo = 0;
  let m;
  REGEX_FORMULA.lastIndex = 0;
  while ((m = REGEX_FORMULA.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    partes.push(renderFormulaSpan(m[1], { editable, onEditar }));
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

// Crea (o repinta) el <span> de una fórmula. Cuando es editable queda marcado
// contentEditable=false para que, dentro del campo de captura, el navegador lo
// trate como una sola "ficha" (se selecciona y se borra de un golpe, no se
// puede escribir texto adentro) — y un clic reabre el editor visual sobre ella.
function renderFormulaSpan(latex, { editable = false, onEditar } = {}) {
  const span = document.createElement('span');
  span.className = 'formula-katex';
  span.dataset.latex = latex;
  if (editable) {
    span.contentEditable = 'false';
    span.classList.add('formula-editable');
    span.title = 'Toca para editar esta fórmula';
    span.onclick = () => onEditar(latex, span);
  }
  pintarKatexEnSpan(span, latex);
  return span;
}

function pintarKatexEnSpan(span, latex) {
  if (window.katex) {
    try {
      window.katex.render(latex, span, { throwOnError: false, output: 'html' });
      return;
    } catch (err) {
      // sigue abajo al respaldo de texto plano
    }
  }
  span.textContent = `$$${latex}$$`;
  span.title = 'No se pudo interpretar la fórmula';
}

// Plantillas rápidas: insertan la estructura (fracción, potencia, raíz…) con
// casillas punteadas ya listas para llenar, en vez de esperar a que el maestro
// sepa que "/" o "^" arman una fracción o un exponente en el teclado normal.
const PLANTILLAS_RAPIDAS = [
  { etiqueta: 'Fracción', simbolo: '½', texto: '\\frac{#0}{#0}' },
  { etiqueta: 'Potencia (exponente)', simbolo: 'xⁿ', texto: '{#0}^{#0}' },
  { etiqueta: 'Subíndice', simbolo: 'x₂', texto: '{#0}_{#0}' },
  { etiqueta: 'Raíz cuadrada', simbolo: '√', texto: '\\sqrt{#0}' },
  { etiqueta: 'Raíz n-ésima', simbolo: 'ⁿ√', texto: '\\sqrt[#0]{#0}' },
];

// Abre el editor visual de fórmulas (MathLive) en una ventana modal.
// alConfirmar(latex) se llama con el LaTeX final, o con null si el maestro
// eligió "Eliminar fórmula" (solo disponible cuando ya había una).
function abrirEditorFormula(latexInicial, alConfirmar) {
  const mathField = document.createElement('math-field');
  mathField.className = 'campo-mathlive';
  mathField.setAttribute('math-virtual-keyboard-policy', 'manual');
  mathField.value = latexInicial || '';

  const barraPlantillas = el('div', { class: 'barra-plantillas-formula' }, PLANTILLAS_RAPIDAS.map((plantilla) => el('button', {
    type: 'button', class: 'btn-formula', title: plantilla.etiqueta,
    onclick: () => { mathField.focus(); mathField.executeCommand(['insert', plantilla.texto]); },
  }, plantilla.simbolo)));

  const btnConfirmar = el('button', { type: 'button', class: 'btn-primario' }, latexInicial ? 'Guardar cambios' : 'Insertar');
  const btnCancelar = el('button', { type: 'button', class: 'btn-secundario' }, 'Cancelar');
  const btnEliminar = latexInicial
    ? el('button', {
      type: 'button', class: 'btn-peligro',
      onclick: () => { alConfirmar(null); cerrar(); },
    }, 'Eliminar fórmula')
    : null;

  const overlay = el('div', { class: 'overlay-modal' }, [
    el('div', { class: 'panel modal-formula' }, [
      el('h2', {}, latexInicial ? 'Editar fórmula' : 'Insertar fórmula'),
      el('p', { class: 'etiqueta-chica' }, 'Toca una plantilla para armar la estructura, o escribe directo. Toca una casilla punteada, o usa las flechas, para moverte dentro de la fórmula — igual que en Photomath.'),
      barraPlantillas,
      mathField,
      el('div', { class: 'acciones-modal' }, [btnConfirmar, btnCancelar, btnEliminar].filter(Boolean)),
    ]),
  ]);

  function cerrar() {
    if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide();
    overlay.remove();
  }

  btnConfirmar.onclick = () => { alConfirmar(mathField.value); cerrar(); };
  btnCancelar.onclick = cerrar;

  document.body.appendChild(overlay);
  setTimeout(() => {
    mathField.focus();
    if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.show({ animate: true });
  }, 50);
}

function crearRangoAlFinal(contenedor) {
  const rango = document.createRange();
  rango.selectNodeContents(contenedor);
  rango.collapse(false);
  return rango;
}

// Campo de texto (varias líneas) donde las fórmulas se ven SIEMPRE ya
// renderizadas dentro del propio texto — nunca como "$$...$$" — con un botón
// para insertar una nueva. Por dentro se guarda como $$...$$ (mismo formato
// que usa el resto de la app para examen/PDF/clave), pero el maestro nunca ve
// ni escribe esa sintaxis: solo escribe texto normal y toca fórmulas ya
// puestas para editarlas o borrarlas.
// Devuelve { contenedor, textarea } — igual patrón que campoContrasena
// (`textarea` aquí es el campo editable, no un <textarea> real).
export function campoTextoConFormulas({
  placeholder = '', valor = '', filas = '2', oninput,
} = {}) {
  const editor = el('div', {
    class: 'input-enunciado campo-editable-formulas', contenteditable: 'true', 'data-placeholder': placeholder,
  });
  editor.style.setProperty('--filas-min', filas);

  function serializar() {
    let resultado = '';
    editor.childNodes.forEach((nodo) => {
      if (nodo.nodeType === Node.TEXT_NODE) resultado += nodo.textContent;
      else if (nodo.nodeName === 'BR') resultado += '\n';
      else if (nodo.dataset && nodo.dataset.latex !== undefined) resultado += `$$${nodo.dataset.latex}$$`;
      else resultado += nodo.textContent || '';
    });
    return resultado;
  }

  function dispararCambio() {
    if (oninput) oninput(serializar());
  }

  function editarSpan(latexActual, nodoSpan) {
    abrirEditorFormula(latexActual, (latexNuevo) => {
      if (latexNuevo === null) {
        nodoSpan.remove();
      } else {
        nodoSpan.dataset.latex = latexNuevo;
        pintarKatexEnSpan(nodoSpan, latexNuevo);
      }
      dispararCambio();
    });
  }

  function pintarDesdeTexto(texto) {
    editor.innerHTML = '';
    renderTextoFormulas(texto, { editable: true, onEditar: editarSpan }).forEach((parte) => {
      editor.appendChild(typeof parte === 'string' ? document.createTextNode(parte) : parte);
    });
  }
  pintarDesdeTexto(valor);

  editor.addEventListener('input', dispararCambio);

  // Enter inserta un <br> simple en vez del <div> por línea que ponen los
  // navegadores por defecto en contenteditable, para que serializar() no
  // tenga que lidiar con estructuras anidadas.
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const seleccion = window.getSelection();
    const rango = seleccion.rangeCount > 0 ? seleccion.getRangeAt(0) : crearRangoAlFinal(editor);
    rango.deleteContents();
    const br = document.createElement('br');
    rango.insertNode(br);
    rango.setStartAfter(br);
    rango.collapse(true);
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
    dispararCambio();
  });

  // Al pegar, solo se acepta texto plano — así nunca entra HTML con formato
  // (de Word, por ejemplo) que serializar() no sabría representar.
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const texto = (e.clipboardData || window.clipboardData).getData('text/plain');
    const seleccion = window.getSelection();
    const rango = seleccion.rangeCount > 0 ? seleccion.getRangeAt(0) : crearRangoAlFinal(editor);
    rango.deleteContents();
    const nodo = document.createTextNode(texto);
    rango.insertNode(nodo);
    rango.setStartAfter(nodo);
    rango.collapse(true);
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
    dispararCambio();
  });

  // El botón de insertar fórmula le roba el foco al campo, así que la
  // posición del cursor se guarda en "mousedown" (antes de que eso pase) y se
  // restaura justo antes de insertar la fórmula nueva ahí mismo.
  let rangoGuardado = null;
  function guardarRango() {
    const seleccion = window.getSelection();
    rangoGuardado = (seleccion.rangeCount > 0 && editor.contains(seleccion.anchorNode))
      ? seleccion.getRangeAt(0).cloneRange()
      : crearRangoAlFinal(editor);
  }

  function insertarEnRangoGuardado(nodo) {
    editor.focus();
    const rango = rangoGuardado || crearRangoAlFinal(editor);
    const seleccion = window.getSelection();
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
    rango.deleteContents();
    rango.insertNode(nodo);
    rango.setStartAfter(nodo);
    rango.collapse(true);
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
  }

  const btnNuevaFormula = el('button', {
    type: 'button', class: 'btn-secundario btn-alternar-formulas',
    onmousedown: (e) => { e.preventDefault(); guardarRango(); },
    onclick: () => {
      abrirEditorFormula('', (latex) => {
        if (!latex || !latex.trim()) return;
        insertarEnRangoGuardado(renderFormulaSpan(latex, { editable: true, onEditar: editarSpan }));
        dispararCambio();
      });
    },
  }, '∑ Insertar fórmula');

  const contenedor = el('div', { class: 'campo-formulas' }, [btnNuevaFormula, editor]);
  return { contenedor, textarea: editor };
}
