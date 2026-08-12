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
  while (node.firstChild) node.removeChild(node.firstChild);
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
