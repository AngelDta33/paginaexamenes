// Helper mínimo de búsqueda de texto, compartido por las listas de Exámenes,
// Grupos y Programas.

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
