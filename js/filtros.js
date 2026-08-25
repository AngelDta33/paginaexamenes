// Helper mínimo de búsqueda de texto, compartido por las listas de Exámenes,
// Grupos y Programas.

import { el } from './dom.js';

export function coincideTexto(consulta, ...campos) {
  if (!consulta) return true;
  const q = consulta.trim().toLowerCase();
  if (!q) return true;
  return campos.some((c) => (c || '').toString().toLowerCase().includes(q));
}

// Las listas se repintan por completo (clear + reconstruir) en cada tecleo del
// campo de búsqueda para reflejar el filtro; eso reemplaza el <input> por uno
// nuevo y le hace perder el foco, así que solo se podía borrar de a un
// carácter (había que volver a hacer clic después de cada borrado). Guardar
// el foco/posición del cursor antes de repintar y restaurarlo después evita
// eso.
export function guardarFoco(contenedor, selector) {
  const activo = document.activeElement;
  if (!activo || !contenedor.contains(activo) || !activo.matches(selector)) return null;
  return { selector, inicio: activo.selectionStart, fin: activo.selectionEnd };
}

export function restaurarFoco(contenedor, foco) {
  if (!foco) return;
  const campo = contenedor.querySelector(foco.selector);
  if (!campo) return;
  campo.focus();
  if (typeof campo.setSelectionRange === 'function' && foco.inicio != null) {
    campo.setSelectionRange(foco.inicio, foco.fin);
  }
}

// <input> de búsqueda usado en Exámenes/Grupos/Programas. Cuando se escribe
// un acento o una letra compuesta (é, ñ, etc. armadas con tecla muerta o IME),
// el navegador dispara "input" a medio componer (isComposing: true) antes del
// evento final; si eso dispara un repintado que reemplaza el <input> a medio
// camino, el navegador pierde la composición en curso y el acento no se
// llega a escribir. Por eso solo se repinta cuando la composición ya terminó.
export function campoBusqueda({ placeholder, valor, onCambio }) {
  return el('input', {
    type: 'text', placeholder, class: 'campo-busqueda', value: valor,
    oninput: (e) => {
      if (e.isComposing) return;
      onCambio(e.target.value);
    },
    oncompositionend: (e) => { onCambio(e.target.value); },
  });
}
