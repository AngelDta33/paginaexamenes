// Exporta el pase de lista y la rúbrica de un grupo a un archivo .xlsx real,
// con estilos (encabezados en color, bordes, anchos de columna) usando
// xlsx-js-style (cargado por CDN en index.html como script global `XLSX`,
// misma API que SheetJS pero con soporte de estilos en la edición gratuita).

import { listarAsistencias } from './gruposStore.js';
import {
  fechaCortaMX, calcularPromedio, valorRubro, INICIALES_ESTADO_ASISTENCIA,
  esRubroAsistencia, tieneEvaluaciones, calendarioDeGrupo, fechasEnTrimestre,
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

const ESTILO_TITULO_DESGLOSE = {
  font: { bold: true, sz: 12, color: { rgb: VERDE } },
  alignment: { horizontal: 'left', vertical: 'center' },
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

// Filas (celdas estilizadas) del bloque de un rubro para la hoja "Desglose":
// un título con el nombre y %, un encabezado y una fila por alumno. Según el tipo
// de rubro muestra sus evaluaciones desglosadas (ej. cada examen), la asistencia
// o la única calificación manual. Termina con una fila en blanco separadora.
function filasDesgloseRubro(grupo, rubro, alumnosActivos, dias) {
  const filas = [];
  filas.push([celda(`${rubro.nombre || 'Rubro'} — ${rubro.porcentaje || 0}%`, ESTILO_TITULO_DESGLOSE)]);

  if (tieneEvaluaciones(rubro)) {
    const evs = rubro.evaluaciones || [];
    filas.push([
      celda('Alumno', ESTILO_ENCABEZADO),
      ...evs.map((ev) => celda(ev.totalAciertos ? `${ev.nombre || 'Evaluación'} (/${ev.totalAciertos})` : (ev.nombre || 'Evaluación'), ESTILO_ENCABEZADO)),
      celda('Calif. del rubro (0-10)', ESTILO_ENCABEZADO),
    ]);
    alumnosActivos.forEach((alumno) => {
      const cal = grupo.calificaciones[alumno.id] || { notasEvaluacion: {} };
      const notas = cal.notasEvaluacion || {};
      const v = valorRubro(grupo, rubro, alumno.id, dias);
      filas.push([
        celda(alumno.nombre, ESTILO_CELDA_NOMBRE),
        ...evs.map((ev) => {
          const raw = notas[ev.id];
          return celda(raw === null || raw === undefined || raw === '' ? '' : Number(raw), ESTILO_CELDA_CENTRADA);
        }),
        celda(v === null ? '' : Number(v.toFixed(2)), ESTILO_CELDA_DESTACADA),
      ]);
    });
  } else {
    const etiqueta = esRubroAsistencia(rubro) ? 'Asistencia (0-10)' : 'Calificación (0-10)';
    filas.push([celda('Alumno', ESTILO_ENCABEZADO), celda(etiqueta, ESTILO_ENCABEZADO)]);
    alumnosActivos.forEach((alumno) => {
      const v = valorRubro(grupo, rubro, alumno.id, dias);
      filas.push([
        celda(alumno.nombre, ESTILO_CELDA_NOMBRE),
        celda(v === null ? '' : Number(v.toFixed(2)), esRubroAsistencia(rubro) ? ESTILO_CELDA_CENTRADA : ESTILO_CELDA_CENTRADA),
      ]);
    });
  }

  filas.push([]); // separador entre tablas
  return filas;
}

// Arma la hoja de pase de lista (Alumno | fechas... | Faltas) a partir de un
// subconjunto de días — se reutiliza tal cual para la tabla general y para cada
// tabla por trimestre, solo cambian los días que se le pasan.
function hojaPaseDeLista(diasIncluidos, alumnosActivos) {
  const encabezado = [
    celda('Alumno', ESTILO_ENCABEZADO),
    ...diasIncluidos.map((d) => celda(fechaCortaMX(d.fecha), ESTILO_ENCABEZADO)),
    celda('Faltas', ESTILO_ENCABEZADO),
  ];
  const filas = alumnosActivos.map((alumno) => {
    let faltas = 0;
    const celdasDias = diasIncluidos.map((dia) => {
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
  return hojaDesdeFilas([encabezado, ...filas], [24, ...diasIncluidos.map(() => 10), 9]);
}

// Los nombres de hoja de Excel no aceptan : \ / ? * [ ] y tienen que medir 31
// caracteres o menos; si dos trimestres terminan con el mismo nombre recortado,
// se les agrega un número para que no choquen.
function nombreHojaUnico(nombresUsados, base) {
  const limpio = (base || 'Trimestre').replace(/[:\\/?*[\]]/g, '').trim() || 'Trimestre';
  let nombre = limpio.slice(0, 31);
  let sufijo = 1;
  while (nombresUsados.has(nombre)) {
    sufijo += 1;
    const marcador = ` (${sufijo})`;
    nombre = `${limpio.slice(0, 31 - marcador.length)}${marcador}`;
  }
  nombresUsados.add(nombre);
  return nombre;
}

export async function exportarGrupoExcel(grupo) {
  if (!window.XLSX) {
    alert('No se pudo cargar el motor de Excel. Revisa tu conexión a internet e intenta de nuevo.');
    return;
  }

  const alumnosActivos = (grupo.alumnos || []).filter((a) => a.activo !== false);
  const libro = XLSX.utils.book_new();
  // Reservados de antemano para que ningún trimestre choque con ellos.
  const nombresHojas = new Set(['Rúbrica y calificaciones', 'Desglose']);

  // --- Hoja: Pase de lista (tabla general, con todos los días) ---
  const dias = await listarAsistencias(grupo.id);
  XLSX.utils.book_append_sheet(libro, hojaPaseDeLista(dias, alumnosActivos), nombreHojaUnico(nombresHojas, 'Pase de lista'));

  // --- Hojas por trimestre (solo si el calendario del curso los tiene configurados) ---
  const calendario = calendarioDeGrupo(grupo);
  for (const trimestre of calendario.trimestres) {
    const fechasDelTrimestre = fechasEnTrimestre(dias.map((d) => d.fecha), trimestre);
    if (fechasDelTrimestre.length === 0) continue; // sin fechas capturadas en ese rango, no vale la pena la hoja
    const diasDelTrimestre = dias.filter((d) => fechasDelTrimestre.includes(d.fecha));
    const nombreHoja = nombreHojaUnico(nombresHojas, trimestre.nombre || 'Trimestre');
    XLSX.utils.book_append_sheet(libro, hojaPaseDeLista(diasDelTrimestre, alumnosActivos), nombreHoja);
  }

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

  // --- Hoja: Desglose (una tabla por rubro, apiladas) ---
  if (rubros.length > 0) {
    const filasDesglose = [];
    for (const rubro of rubros) {
      filasDesglose.push(...filasDesgloseRubro(grupo, rubro, alumnosActivos, dias));
    }
    const maxCols = filasDesglose.reduce((m, f) => Math.max(m, f.length), 1);
    const anchos = [24, ...Array(Math.max(0, maxCols - 1)).fill(16)];
    const hojaDesglose = hojaDesdeFilas(filasDesglose, anchos);
    XLSX.utils.book_append_sheet(libro, hojaDesglose, 'Desglose');
  }

  XLSX.writeFile(libro, `${nombreArchivoSeguro(grupo.nombre)}.xlsx`);
}
