// Modelo de datos del examen: defaults, ids, cálculo de puntos y validaciones.

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Encabezado oficial fijo que llevan los exámenes de inglés (membrete de
// Gobierno del Estado de México) — se precarga en "Datos de la escuela" la
// primera vez que se abre ese campo, pero se puede editar ahí si cambia.
export const ENCABEZADO_INGLES_DEFECTO = [
  'Gobierno del Estado de México',
  'Secretaría de Educación',
  'Subsecretaría de Educación Básica y Normal',
  'Dirección General de Educación Básica',
  'Subdirección Regional de Educación Básica Nezahualcóyotl',
  'Supervisión Escolar No. S-098',
  'Esc. Particular 0223 "Colegio Cultural México-Aragón, S. C.',
].join('\n');

// Membrete oficial del formato normal (punto I de "Elaboración de exámenes").
// Va dentro de una caja con borde, con el logo de la escuela a la izquierda. Ojo:
// NO es el mismo que el de inglés — cambian la supervisión escolar y la última
// línea —, por eso son dos constantes y dos campos de configuración distintos.
export const ENCABEZADO_OFICIAL_DEFECTO = [
  'Gobierno del Estado de México',
  'Secretaría de Educación',
  'Subsecretaría de Educación Básica y Normal',
  'Dirección General de Educación Básica',
  'Subdirección Regional de Educación Básica Nezahualcóyotl',
  'Supervisión Escolar S102',
  'Esc. Part. 0223 "Colegio Cultural México-Aragón, S.C."',
].join('\n');

// Punto III: "Indicar siempre una instrucción general". Este es el texto tal cual
// viene en el formato oficial; el docente puede cambiarlo en "Datos generales".
export const INSTRUCCIONES_GENERALES_DEFECTO = 'Lee detenidamente y contesta de manera legible cada uno de los siguientes reactivos. Deberás responder el examen sólo con tinta negra, señala la respuesta correcta con marca texto amarillo. No se permite el uso de corrector. Recuerda que, si algún reactivo tiene doble respuesta o ésta no se entiende, quedará cancelado.';

// sesion = { uid, nombre } de quien lo crea — se guarda como dueño del examen.
// formato: 'normal' (el formato de siempre, con logo de la escuela) o
// 'ingles' (membrete oficial y título libre, ver paginate.js).
export function nuevoExamen(sesion, formato = 'normal') {
  const ahora = new Date().toISOString();
  return {
    id: uid('exam'),
    createdAt: ahora,
    updatedAt: ahora,
    tipoExamen: 'A',
    formato,
    // Tamaño de hoja con el que se arma la vista previa y se imprime (ver
    // TAMANOS_PAPEL en js/paginate.js). Los exámenes guardados antes de que
    // existiera este campo caen solos en oficio, que era el fijo de antes.
    tamanoPapel: 'oficio',
    duplicadoDeId: null,
    revisadoDistinto: false,
    profesorId: sesion ? sesion.uid : null,
    profesorNombre: sesion ? sesion.nombre : '',
    estado: 'borrador', // 'borrador' | 'en_revision' | 'aprobado'
    revisadoPor: null,
    revisadoEn: null,
    // Comentarios que el revisor/administrador deja al regresar el examen a
    // borrador (qué debe corregir el docente). Cada uno: { autor, fecha, texto }.
    comentariosRevision: [],
    meta: {
      grado: '',
      grupo: '',
      materia: '',
      profesor: '',
      trimestre: '',
      // Ciclo escolar impreso en el título ("EXAMEN PRIMER TRIMESTRE 2026-2027").
      // Va en el examen y no solo en la configuración de la escuela para poder
      // reciclar un examen del año pasado cambiando nada más este campo. Vacío
      // = se usa el de "Datos de la escuela" (ver cicloDeExamen en paginate.js).
      cicloEscolar: '',
      // Fecha de aplicación. No se imprime —en la hoja va la raya en blanco,
      // porque se llena a mano el día del examen—, sirve para ubicar el examen
      // dentro de la app.
      fecha: '',
      // "Total de puntos" del encabezado: lo que vale el examen en puntos. Es el
      // número contra el que se validan los reactivos (punto V: "La cantidad de
      // puntos en el examen debe ser igual al valor del mismo").
      totalPuntos: 100,
      valorExamen: 100,
      // Título libre centrado que llevan los exámenes de inglés (ej. "THIRD-GRADE
      // ENGLISH INTER" / "THIRD TRIMESTRAL EXAM 2025-2026") — varía tanto de
      // redacción entre exámenes que no vale la pena tratar de generarlo solo.
      tituloIngles: '',
    },
    instruccionesGenerales: formato === 'ingles' ? '' : INSTRUCCIONES_GENERALES_DEFECTO,
    secciones: [nuevaSeccion()],
  };
}

export function nuevaSeccion() {
  return {
    id: uid('sec'),
    titulo: '',
    instrucciones: '',
    preguntas: [],
  };
}

const DEFAULTS_POR_TIPO = {
  opcion_multiple: () => ({
    enunciado: '',
    valor: 1,
    imagen: null,
    opciones: ['', ''],
    respuestaCorrecta: 0,
  }),
  relacion_columnas: () => ({
    enunciado: '',
    valor: 1,
    imagen: null,
    columnaA: [''],
    columnaB: [''],
    relaciones: [0], // relaciones[i] = índice en columnaB que corresponde a columnaA[i]
  }),
  abierta: () => ({
    enunciado: '',
    valor: 1,
    imagen: null,
    lineasRespuesta: 3,
    respuestaModelo: '',
  }),
  verdadero_falso: () => ({
    enunciado: '',
    valor: 1,
    imagen: null,
    respuestaCorrecta: true,
    formatoIngles: false, // muestra True/False en vez de Verdadero/Falso
  }),
  lectura_comprension: () => ({
    enunciado: '',
    valor: 0,
    imagen: null,
    textoLectura: '',
    subpreguntas: [],
  }),
  // Identificar partes señaladas en una imagen: el docente coloca marcadores
  // numerados sobre la imagen (x,y en % relativo) y escribe el nombre correcto de
  // cada uno. En el examen se ve la imagen con los números + un banco de palabras.
  identificar_imagen: () => ({
    enunciado: 'Escribe el nombre de cada parte señalada.',
    valor: 1,
    imagen: null,
    marcadores: [], // { id, x, y, etiqueta }
  }),
};

export const ETIQUETAS_ESTADO = {
  borrador: 'Borrador',
  en_revision: 'En revisión',
  aprobado: 'Aprobado',
};

export const ETIQUETAS_ROL = {
  maestro: 'Maestro',
  revisor: 'Revisor',
  administrador: 'Administrador',
};

export const TIPOS_PREGUNTA = [
  { valor: 'opcion_multiple', etiqueta: 'Opción múltiple' },
  { valor: 'relacion_columnas', etiqueta: 'Relación de columnas' },
  { valor: 'abierta', etiqueta: 'Respuesta abierta/restringida' },
  { valor: 'verdadero_falso', etiqueta: 'Verdadero / Falso' },
  { valor: 'identificar_imagen', etiqueta: 'Identificar en imagen' },
  { valor: 'lectura_comprension', etiqueta: 'Lectura de comprensión' },
];

export function nuevaPregunta(tipo) {
  const base = DEFAULTS_POR_TIPO[tipo] ? DEFAULTS_POR_TIPO[tipo]() : DEFAULTS_POR_TIPO.abierta();
  return { id: uid('preg'), tipo, ...base };
}

export function nuevaSubpregunta(tipo) {
  return nuevaPregunta(tipo);
}

// --- Cálculo de puntos ---

function valorPregunta(p) {
  if (p.tipo === 'lectura_comprension') {
    return (p.subpreguntas || []).reduce((acc, sp) => acc + (Number(sp.valor) || 0), 0);
  }
  return Number(p.valor) || 0;
}

export function subtotalSeccion(seccion) {
  return (seccion.preguntas || []).reduce((acc, p) => acc + valorPregunta(p), 0);
}

export function totalExamen(examen) {
  return (examen.secciones || []).reduce((acc, s) => acc + subtotalSeccion(s), 0);
}

// Numeración continua de reactivos: la lectura de comprensión es un contenedor de instrucciones
// (no cuenta como reactivo); cada una de sus subpreguntas sí cuenta y recibe el siguiente número.
export function numerarReactivos(examen) {
  let n = 0;
  const numeros = {}; // id (pregunta o subpregunta) -> número
  for (const seccion of examen.secciones || []) {
    for (const p of seccion.preguntas || []) {
      if (p.tipo === 'lectura_comprension') {
        for (const sp of p.subpreguntas || []) {
          n += 1;
          numeros[sp.id] = n;
        }
      } else {
        n += 1;
        numeros[p.id] = n;
      }
    }
  }
  return numeros;
}

// --- Validaciones ---

const INCREMENTOS_PROHIBIDOS = new Set([0.25, 0.75]);

function esValorProhibido(valor) {
  const frac = Math.abs(valor % 1);
  return INCREMENTOS_PROHIBIDOS.has(Math.round(frac * 100) / 100);
}

// "Total de puntos" del encabezado. Los exámenes guardados antes de que existiera
// el campo se quedan con el valor del examen, que era el que se validaba entonces.
export function puntosDeclarados(examen) {
  const meta = examen.meta || {};
  const total = meta.totalPuntos != null ? meta.totalPuntos : meta.valorExamen;
  return Number(total) || 0;
}

export function validarExamen(examen) {
  const avisos = [];
  const total = totalExamen(examen);
  const declarado = puntosDeclarados(examen);

  if (Math.abs(total - declarado) > 0.001) {
    avisos.push({
      tipo: 'total',
      mensaje: `La suma de los puntos de los reactivos (${total}) no coincide con el total de puntos declarado en el encabezado (${declarado}).`,
    });
  }

  // Punto III del formato: "Indicar siempre una instrucción general y las
  // específicas en cada sección".
  if (!(examen.instruccionesGenerales || '').trim()) {
    avisos.push({ tipo: 'instrucciones', mensaje: 'Falta la instrucción general del examen (el formato pide siempre una).' });
  }
  (examen.secciones || []).forEach((seccion, i) => {
    if ((seccion.preguntas || []).length > 0 && !(seccion.instrucciones || '').trim()) {
      avisos.push({ tipo: 'instrucciones', mensaje: `La sección ${i + 1}${seccion.titulo ? ` ("${seccion.titulo}")` : ''} no tiene instrucciones específicas.` });
    }
  });

  for (const seccion of examen.secciones || []) {
    for (const p of seccion.preguntas || []) {
      if (p.tipo === 'lectura_comprension') {
        for (const sp of p.subpreguntas || []) {
          if (esValorProhibido(Number(sp.valor) || 0)) {
            avisos.push({ tipo: 'valor', mensaje: `Una subpregunta de lectura tiene un valor de ${sp.valor} pts (evita .25/.75).` });
          }
        }
      } else if (esValorProhibido(Number(p.valor) || 0)) {
        avisos.push({ tipo: 'valor', mensaje: `El reactivo "${(p.enunciado || 'sin enunciado').slice(0, 40)}" tiene un valor de ${p.valor} pts (evita .25/.75).` });
      }
    }
  }

  return avisos;
}
