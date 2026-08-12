// Exporta el pase de lista y la rúbrica de un grupo a un archivo .xlsx real,
// con estilos (encabezados en color, bordes, anchos de columna) usando
// xlsx-js-style (cargado por CDN en index.html como script global `XLSX`,
// misma API que SheetJS pero con soporte de estilos en la edición gratuita).

import { listarAsistencias } from './gruposStore.js';
import {
  fechaCortaMX, calcularPromedio, valorRubro, INICIALES_ESTADO_ASISTENCIA,
} from './gruposModel.js';

function nombreArchivoSeguro(texto) {
  return (texto || 'grupo').replace(/[\\/:*?"<>|]/g, '_');
}

const VERDE = '1F8A4C';
const VERDE_SUAVE = 'E6F6EC';
const GRIS_BORDE = 'CCCCCC';

const BORDE_FINO = { style: 'thin', color: { rgb: GRIS_BORDE } };
const BORDES = {
  top: BORDE_FINO, bottom: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO,
};

const ESTILO_ENCABEZADO = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
  fill: { fgColor: { rgb: VERDE } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDES,
};

const ESTILO_CELDA_NOMBRE = {
  font: { sz: 11 },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: BORDES,
};

const ESTILO_CELDA_CENTRADA = {
  font: { sz: 11 },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: BORDES,
};

const ESTILO_CELDA_DESTACADA = {
  font: { sz: 11, bold: true },
  fill: { fgColor: { rgb: VERDE_SUAVE } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: BORDES,
};

function celda(valor, estilo) {
  const tipo = typeof valor === 'number' ? 'n' : 's';
  return { v: valor === '' || valor === null || valor === undefined ? '' : valor, t: valor === '' || valor === null || valor === undefined ? 's' : tipo, s: estilo };
}

// Arma una hoja a partir de filas de celdas ya estilizadas (no de aoa_to_sheet,
// para poder aplicar `.s` a cada celda individualmente).
function hojaDesdeFilas(filas, anchos) {
  const hoja = {};
  let filaMax = 0;
  let colMax = 0;
  filas.forEach((fila, r) => {
    fila.forEach((c, col) => {
      const ref = XLSX.utils.encode_cell({ r, c: col });
      hoja[ref] = c;
      if (col > colMax) colMax = col;
    });
    if (r > filaMax) filaMax = r;
  });
  hoja['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filaMax, c: colMax } });
  hoja['!cols'] = anchos.map((wch) => ({ wch }));
  hoja['!rows'] = [{ hpt: 24 }];
  return hoja;
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
  const encabezadoLista = [
    celda('Alumno', ESTILO_ENCABEZADO),
    ...dias.map((d) => celda(fechaCortaMX(d.fecha), ESTILO_ENCABEZADO)),
    celda('Faltas', ESTILO_ENCABEZADO),
  ];
  const filasLista = alumnosActivos.map((alumno) => {
    let faltas = 0;
    const celdasDias = dias.map((dia) => {
      const reg = dia.registros[alumno.id];
      const estado = reg && reg.estado;
      if (estado === 'falta') faltas += 1;
      return celda(estado ? INICIALES_ESTADO_ASISTENCIA[estado] : '', ESTILO_CELDA_CENTRADA);
    });
    return [
      celda(alumno.nombre, ESTILO_CELDA_NOMBRE),
      ...celdasDias,
      celda(faltas, ESTILO_CELDA_DESTACADA),
    ];
  });
  const hojaLista = hojaDesdeFilas(
    [encabezadoLista, ...filasLista],
    [24, ...dias.map(() => 10), 9],
  );
  XLSX.utils.book_append_sheet(libro, hojaLista, 'Pase de lista');

  // --- Hoja: Rúbrica y calificaciones ---
  const rubros = grupo.rubros || [];
  const encabezadoRubrica = [
    celda('Alumno', ESTILO_ENCABEZADO),
    ...rubros.map((r) => celda(`${r.nombre || 'Rubro'} (${r.porcentaje}%)`, ESTILO_ENCABEZADO)),
    celda('Extra', ESTILO_ENCABEZADO),
    celda('Promedio', ESTILO_ENCABEZADO),
  ];
  const filasRubrica = alumnosActivos.map((alumno) => {
    const cal = grupo.calificaciones[alumno.id] || { valores: {}, extra: 0 };
    const celdasValores = rubros.map((r) => {
      const v = valorRubro(grupo, r, alumno.id, dias);
      return celda(v === null ? '' : v, ESTILO_CELDA_CENTRADA);
    });
    const promedio = calcularPromedio(grupo, alumno.id, dias);
    return [
      celda(alumno.nombre, ESTILO_CELDA_NOMBRE),
      ...celdasValores,
      celda(cal.extra || 0, ESTILO_CELDA_CENTRADA),
      celda(promedio === null ? '' : promedio, ESTILO_CELDA_DESTACADA),
    ];
  });
  const hojaRubrica = hojaDesdeFilas(
    [encabezadoRubrica, ...filasRubrica],
    [24, ...rubros.map(() => 18), 9, 11],
  );
  XLSX.utils.book_append_sheet(libro, hojaRubrica, 'Rúbrica y calificaciones');

  XLSX.writeFile(libro, `${nombreArchivoSeguro(grupo.nombre)}.xlsx`);
}
