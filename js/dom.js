// Helpers mínimos para crear DOM sin dependencias.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  soltarFoco(node);
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Si el cursor (la selección) o el foco están dentro de lo que se va a borrar,
// se sueltan antes: se perderían de todos modos al quitar esos nodos, y si se
// quedan, el navegador los usa como referencia para su "anclaje de
// desplazamiento" y, al redibujar (ej. mover una pregunta con ▲▼ justo después
// de escribir en otra), recoloca la página cientos de píxeles más arriba —
// hasta el principio en un examen largo.
function soltarFoco(node) {
  const seleccion = window.getSelection ? window.getSelection() : null;
  if (seleccion && seleccion.rangeCount > 0 && node.contains(seleccion.anchorNode)) seleccion.removeAllRanges();
  // Quitar el foco es lo que de verdad evita el salto (soltar solo la selección
  // no alcanza). Si el campo cambió, blur() dispara su "change" aquí mismo: así
  // se aplica lo que el maestro ya había escrito, que antes se perdía al quitar
  // el campo sin avisar. Si ese handler vuelve a repintar este mismo nodo, ya no
  // hay foco que soltar y el while de clear() deja todo limpio igual.
  const activo = document.activeElement;
  if (activo && activo !== document.body && node.contains(activo)) activo.blur();
}

// Campo de contraseña con botón de "mostrar/ocultar" — para que un maestro pueda
// revisar lo que escribió antes de enviarlo, en vez de tener que confiar a ciegas.
// Devuelve { contenedor, input } — usa `contenedor` para insertarlo y `input` para
// leer/enfocar el valor como con cualquier <input>.
export function campoContrasena(attrs = {}) {
  const input = el('input', { type: 'password', ...attrs });
  const boton = el('button', {
    type: 'button', class: 'btn-ojo', title: 'Mostrar contraseña',
    onclick: () => {
      const vaAMostrar = input.type === 'password';
      input.type = vaAMostrar ? 'text' : 'password';
      boton.textContent = vaAMostrar ? '🙈' : '👁';
      boton.title = vaAMostrar ? 'Ocultar contraseña' : 'Mostrar contraseña';
    },
  }, '👁');
  const contenedor = el('div', { class: 'campo-contrasena' }, [input, boton]);
  return { contenedor, input };
}
