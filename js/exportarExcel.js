// Exporta el pase de lista y la rúbrica de un grupo a un archivo .xlsx real,
// con estilos (encabezados en color, bordes, anchos de columna) usando
// xlsx-js-style (cargado por CDN en index.html como script global `XLSX`,
// misma API que SheetJS pero con soporte de estilos en la edición gratuita).

import { listarAsistencias } from './gruposStore.js';
import {
  fechaCortaMX, calcularPromedio, valorRubro, INICIALES_ESTADO_ASISTENCIA,
  esRubroAsistencia, tieneEvaluaciones, calendarioDeGrupo, fechasEnTrimestre,
  promedioAsistenciaAlumno, usaPorcentaje, calificacionFinal,
  columnasPaseDeLista, porcentajeAsistencia,
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

// Las calificaciones calculadas (promedio de exámenes, promedio general,
// asistencia) salen de divisiones y arrastran la cola de decimales del binario
// —8.333333333333334—, que en Excel se veía completa. Se redondean a 2 decimales
// al escribirlas; el formato numérico de la celda lo pone celdaNota, para que se
// vea pareja aunque el maestro la edite después.
function redondear2(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : '';
}

const ESTILO_TITULO_DESGLOSE = {
  font: { bold: true, sz: 12, color: { rgb: VERDE } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

// Una calificación base 10 lista para escribirse en la hoja. Con el recuadro
// "Mostrar como porcentaje" activo se guarda como porcentaje REAL de Excel (0.85
// con formato "85%") en vez de un número suelto: así la celda sigue siendo
// numérica y el maestro puede seguir operando con ella. `decimales` es el detalle
// en base 10; en porcentaje se muestra uno menos, igual que en pantalla.
function celdaNota(valor, estiloBase, escalaPorcentaje, decimales = 2) {
  if (valor === null || valor === undefined || valor === '') return celda('', estiloBase);
  const n = Number(valor);
  if (!Number.isFinite(n)) return celda('', estiloBase);
  if (escalaPorcentaje) {
    const formatos = { 0: '0%', 1: '0%', 2: '0.0%' };
    return celda(Math.round(n * 1000) / 10000, { ...estiloBase, numFmt: formatos[decimales] || '0.0%' });
  }
  const formatos = { 0: '0', 1: '0.0', 2: '0.00' };
  return celda(redondear2(n), { ...estiloBase, numFmt: formatos[decimales] || '0.00' });
}

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
function filasDesgloseRubro(grupo, rubro, alumnosActivos, dias, escalaPorcentaje) {
  const filas = [];
  filas.push([celda(`${rubro.nombre || 'Rubro'} — ${rubro.porcentaje || 0}%`, ESTILO_TITULO_DESGLOSE)]);

  if (tieneEvaluaciones(rubro)) {
    const evs = rubro.evaluaciones || [];
    filas.push([
      celda('Alumno', ESTILO_ENCABEZADO),
      ...evs.map((ev) => celda(ev.totalAciertos ? `${ev.nombre || 'Evaluación'} (/${ev.totalAciertos})` : (ev.nombre || 'Evaluación'), ESTILO_ENCABEZADO)),
      celda(escalaPorcentaje ? 'Calif. del rubro (0-100%)' : 'Calif. del rubro (0-10)', ESTILO_ENCABEZADO),
    ]);
    alumnosActivos.forEach((alumno) => {
      const cal = grupo.calificaciones[alumno.id] || { notasEvaluacion: {} };
      const notas = cal.notasEvaluacion || {};
      const v = valorRubro(grupo, rubro, alumno.id, dias);
      filas.push([
        celda(alumno.nombre, ESTILO_CELDA_NOMBRE),
        ...evs.map((ev) => {
          const raw = notas[ev.id];
          // Con "total de aciertos" lo capturado son aciertos, no una
          // calificación: se escribe tal cual y no cambia de escala.
          if (ev.totalAciertos) return celda(raw === null || raw === undefined || raw === '' ? '' : Number(raw), ESTILO_CELDA_CENTRADA);
          return celdaNota(raw, ESTILO_CELDA_CENTRADA, escalaPorcentaje);
        }),
        celdaNota(v, ESTILO_CELDA_DESTACADA, escalaPorcentaje),
      ]);
    });
  } else {
    const escala = escalaPorcentaje ? '0-100%' : '0-10';
    const etiqueta = esRubroAsistencia(rubro) ? `Asistencia (${escala})` : `Calificación (${escala})`;
    filas.push([celda('Alumno', ESTILO_ENCABEZADO), celda(etiqueta, ESTILO_ENCABEZADO)]);
    alumnosActivos.forEach((alumno) => {
      filas.push([
        celda(alumno.nombre, ESTILO_CELDA_NOMBRE),
        celdaNota(valorRubro(grupo, rubro, alumno.id, dias), ESTILO_CELDA_CENTRADA, escalaPorcentaje),
      ]);
    });
  }

  filas.push([]); // separador entre tablas
  return filas;
}

// Arma la hoja de pase de lista (Alumno | fechas... | Faltas | promedios) a partir
// de un subconjunto de días — se reutiliza tal cual para la tabla general y para
// cada tabla por trimestre, solo cambian los días que se le pasan.
//
// `columnasAsistencia` son las columnas de promedio que van al final, cada una
// { titulo, dias }: la hoja general lleva una por trimestre más la del ciclo
// completo, y las hojas de un trimestre llevan solo la suya.
function hojaPaseDeLista(grupo, diasIncluidos, alumnosActivos, columnasAsistencia, escalaPorcentaje) {
  const encabezado = [
    celda('Alumno', ESTILO_ENCABEZADO),
    ...diasIncluidos.map((d) => celda(fechaCortaMX(d.fecha), ESTILO_ENCABEZADO)),
    celda('Faltas', ESTILO_ENCABEZADO),
    ...columnasAsistencia.map((c) => celda(c.titulo, ESTILO_ENCABEZADO)),
  ];
  const filas = alumnosActivos.map((alumno) => {
    let faltas = 0;
    const celdasDias = diasIncluidos.map((dia) => {
      const reg = dia.registros[alumno.id];
      const estado = reg && reg.estado;
      if (estado === 'falta') faltas += 1;
      return celda(estado ? INICIALES_ESTADO_ASISTENCIA[estado] : '', ESTILO_CELDA_CENTRADA);
    });
    const celdasPromedio = columnasAsistencia.map((col) => {
      // promedioAsistenciaAlumno viene en escala 0-1; ×10 lo deja en base 10,
      // igual que la columna "Asistencia" de la pantalla.
      const prom = promedioAsistenciaAlumno(grupo, alumno.id, col.dias);
      return celdaNota(prom === null ? null : prom * 10, ESTILO_CELDA_DESTACADA, escalaPorcentaje, 1);
    });
    return [
      celda(alumno.nombre, ESTILO_CELDA_NOMBRE),
      ...celdasDias,
      celda(faltas, ESTILO_CELDA_DESTACADA),
      ...celdasPromedio,
    ];
  });
  return hojaDesdeFilas(
    [encabezado, ...filas],
    [24, ...diasIncluidos.map(() => 10), 9, ...columnasAsistencia.map(() => 16)],
  );
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
  // El recuadro "Mostrar como porcentaje" del grupo se refleja tal cual aquí: si
  // está activo, las calificaciones salen como porcentaje en vez de base 10.
  const escalaPorcentaje = usaPorcentaje(grupo);
  const libro = XLSX.utils.book_new();
  // Reservados de antemano para que ningún trimestre choque con ellos.
  const nombresHojas = new Set(['Rúbrica y calificaciones', 'Desglose']);

  const dias = await listarAsistencias(grupo.id);

  // Trimestres con fechas capturadas dentro (los vacíos no generan hoja).
  const calendario = calendarioDeGrupo(grupo);
  const trimestresConDias = (calendario.trimestres || []).map((trimestre) => {
    const fechasDelTrimestre = fechasEnTrimestre(dias.map((d) => d.fecha), trimestre);
    return { trimestre, dias: dias.filter((d) => fechasDelTrimestre.includes(d.fecha)) };
  }).filter((t) => t.dias.length > 0);

  // --- Hoja: Pase de lista (tabla general, con todos los días) ---
  // Solo lleva la asistencia del ciclo completo: el desglose por trimestre ya
  // vive en la hoja de cada trimestre, y repetirlo aquí solo estorbaba.
  XLSX.utils.book_append_sheet(
    libro,
    hojaPaseDeLista(grupo, dias, alumnosActivos, [{ titulo: 'Asist. del ciclo', dias }], escalaPorcentaje),
    nombreHojaUnico(nombresHojas, 'Pase de lista'),
  );

  // --- Hojas por trimestre (solo si el calendario del curso los tiene configurados) ---
  for (const { trimestre, dias: diasDelTrimestre } of trimestresConDias) {
    const nombreHoja = nombreHojaUnico(nombresHojas, trimestre.nombre || 'Trimestre');
    XLSX.utils.book_append_sheet(
      libro,
      hojaPaseDeLista(grupo, diasDelTrimestre, alumnosActivos, [{ titulo: 'Asistencia', dias: diasDelTrimestre }], escalaPorcentaje),
      nombreHoja,
    );
  }

  // --- Hoja: Rúbrica y calificaciones ---
  const rubros = grupo.rubros || [];
  // Las mismas columnas informativas de pase de lista que se ven en pantalla (si
  // el maestro las agregó). Van siempre en porcentaje: el umbral que le importa
  // es el 80% de asistencia para tener derecho a examen.
  const columnasPase = columnasPaseDeLista(grupo, dias);
  const encabezadoRubrica = [
    celda('Alumno', ESTILO_ENCABEZADO),
    ...rubros.map((r) => celda(`${r.nombre || 'Rubro'} (${r.porcentaje}%)`, ESTILO_ENCABEZADO)),
    celda('Extra', ESTILO_ENCABEZADO),
    celda('Promedio', ESTILO_ENCABEZADO),
    celda('Calificación Final', ESTILO_ENCABEZADO),
    ...columnasPase.map((c) => celda(`${c.titulo} (asistencia)`, ESTILO_ENCABEZADO)),
  ];
  const filasRubrica = alumnosActivos.map((alumno) => {
    const cal = grupo.calificaciones[alumno.id] || { valores: {}, extra: 0 };
    const celdasValores = rubros.map((r) => celdaNota(valorRubro(grupo, r, alumno.id, dias), ESTILO_CELDA_CENTRADA, escalaPorcentaje));
    const promedio = calcularPromedio(grupo, alumno.id, dias);
    return [
      celda(alumno.nombre, ESTILO_CELDA_NOMBRE),
      ...celdasValores,
      celdaNota(cal.extra || 0, ESTILO_CELDA_CENTRADA, escalaPorcentaje),
      // "Promedio" va sin redondear y "Calificación Final" es esa misma cifra ya
      // redondeada (ver calificacionFinal): el maestro necesita las dos para
      // justificar la que se sube a boleta.
      celdaNota(promedio, ESTILO_CELDA_DESTACADA, escalaPorcentaje),
      celdaNota(calificacionFinal(promedio), ESTILO_CELDA_DESTACADA, escalaPorcentaje, 0),
      ...columnasPase.map((c) => {
        const pct = porcentajeAsistencia(grupo, alumno.id, c.dias);
        return pct === null
          ? celda('', ESTILO_CELDA_CENTRADA)
          : celda(Math.round(pct) / 100, { ...ESTILO_CELDA_CENTRADA, numFmt: '0%' });
      }),
    ];
  });
  const hojaRubrica = hojaDesdeFilas(
    [encabezadoRubrica, ...filasRubrica],
    [24, ...rubros.map(() => 18), 9, 11, 16, ...columnasPase.map(() => 18)],
  );
  XLSX.utils.book_append_sheet(libro, hojaRubrica, 'Rúbrica y calificaciones');

  // --- Hoja: Desglose (una tabla por rubro, apiladas) ---
  if (rubros.length > 0) {
    const filasDesglose = [];
    for (const rubro of rubros) {
      filasDesglose.push(...filasDesgloseRubro(grupo, rubro, alumnosActivos, dias, escalaPorcentaje));
    }
    const maxCols = filasDesglose.reduce((m, f) => Math.max(m, f.length), 1);
    const anchos = [24, ...Array(Math.max(0, maxCols - 1)).fill(16)];
    const hojaDesglose = hojaDesdeFilas(filasDesglose, anchos);
    XLSX.utils.book_append_sheet(libro, hojaDesglose, 'Desglose');
  }

  XLSX.writeFile(libro, `${nombreArchivoSeguro(grupo.nombre)}.xlsx`);
}
