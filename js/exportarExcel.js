// Exporta el pase de lista y la rúbrica de un grupo a un archivo .xlsx real,
// con SheetJS (cargado por CDN en index.html como script global `XLSX`).

import { listarAsistencias } from './gruposStore.js';
import {
  fechaCortaMX, calcularPromedio, valorRubro, INICIALES_ESTADO_ASISTENCIA,
} from './gruposModel.js';

function nombreArchivoSeguro(texto) {
  return (texto || 'grupo').replace(/[\\/:*?"<>|]/g, '_');
}

export async function exportarGrupoExcel(grupo) {
  if (!window.XLSX) {
    alert('No se pudo cargar el motor de Excel. Revisa tu conexión a internet e intenta de nuevo.');
    return;
  }

  const alumnosActivos = (grupo.alumnos || []).filter((a) => a.activo !== false);
  const libro = XLSX.utils.book_new();

  // --- Hoja: Pase de lista ---
  const dias = await listarAsistencias(grupo.id);
  const encabezadoLista = ['Alumno', ...dias.map((d) => fechaCortaMX(d.fecha)), 'Faltas'];
  const filasLista = alumnosActivos.map((alumno) => {
    let faltas = 0;
    const celdas = dias.map((dia) => {
      const reg = dia.registros[alumno.id];
      const estado = reg && reg.estado;
      if (estado === 'falta') faltas += 1;
      return estado ? INICIALES_ESTADO_ASISTENCIA[estado] : '';
    });
    return [alumno.nombre, ...celdas, faltas];
  });
  const hojaLista = XLSX.utils.aoa_to_sheet([encabezadoLista, ...filasLista]);
  XLSX.utils.book_append_sheet(libro, hojaLista, 'Pase de lista');

  // --- Hoja: Rúbrica y calificaciones ---
  const rubros = grupo.rubros || [];
  const encabezadoRubrica = ['Alumno', ...rubros.map((r) => `${r.nombre || 'Rubro'} (${r.porcentaje}%)`), 'Extra', 'Promedio'];
  const filasRubrica = alumnosActivos.map((alumno) => {
    const cal = grupo.calificaciones[alumno.id] || { valores: {}, extra: 0 };
    const valores = rubros.map((r) => {
      const v = valorRubro(grupo, r, alumno.id, dias);
      return v === null ? '' : v;
    });
    const promedio = calcularPromedio(grupo, alumno.id, dias);
    return [alumno.nombre, ...valores, cal.extra || 0, promedio === null ? '' : promedio];
  });
  const hojaRubrica = XLSX.utils.aoa_to_sheet([encabezadoRubrica, ...filasRubrica]);
  XLSX.utils.book_append_sheet(libro, hojaRubrica, 'Rúbrica y calificaciones');

  XLSX.writeFile(libro, `${nombreArchivoSeguro(grupo.nombre)}.xlsx`);
}
