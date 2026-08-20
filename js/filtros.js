// Helper mínimo de búsqueda de texto, compartido por las listas de Exámenes,
// Grupos y Programas.

export function coincideTexto(consulta, ...campos) {
  if (!consulta) return true;
  const q = consulta.trim().toLowerCase();
  if (!q) return true;
  return campos.some((c) => (c || '').toString().toLowerCase().includes(q));
}
