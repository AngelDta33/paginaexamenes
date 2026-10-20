// Pase de lista estilo Excel: alumnos en filas, fechas en columnas.

import { el, clear } from './dom.js';
import {
  listarAsistencias, obtenerOCrearAsistencia, guardarAsistencia, guardarGrupo, eliminarAsistencia,
} from './gruposStore.js';
import {
  ESTADOS_ASISTENCIA, ETIQUETAS_ESTADO_ASISTENCIA, INICIALES_ESTADO_ASISTENCIA, fechaISO, fechaHoyISO, fechaCortaMX,
  valoresAsistenciaDeGrupo, promedioAsistenciaAlumno,
  DIAS_SEMANA_NOMBRES, calendarioDeGrupo, nuevoTrimestre, crearTrimestresEstandar, fechasDeClase,
  fechasEnTrimestre, usaPorcentaje, formatearNota, trimestresSuperpuestos, ESTADOS_CON_MOTIVO,
} from './gruposModel.js';

// Ciclo al hacer clic: sin marcar → presente → falta → justificada → retardo → sin marcar.
// El retardo va al final para no cambiarles a los maestros el orden de siempre.
const SIGUIENTE_ESTADO = { null: 'presente', presente: 'falta', falta: 'justificada', justificada: 'retardo', retardo: null };
const INICIALES_ESTADO = INICIALES_ESTADO_ASISTENCIA;

// Textos del cuadro de "motivo", que se abre igual en una falta que en un retardo.
const TEXTOS_MOTIVO = {
  falta: {
    titulo: 'Motivo de la falta',
    ayudaEnlace: 'Anotar por qué faltó el alumno (opcional)',
    ejemplo: 'Ej. se presentó con la orientadora, cita médica, permiso…',
  },
  retardo: {
    titulo: 'Motivo del retardo',
    ayudaEnlace: 'Anotar por qué llegó tarde el alumno (opcional)',
    ejemplo: 'Ej. cita médica, problema con el transporte, venía de otra actividad…',
  },
};

// La tabla solo muestra 10 fechas a la vez (más que eso, las columnas se ponen
// demasiado angostas) — "Faltas" y "Asistencia" no cuentan para esto: se calculan
// con todas las fechas del periodo elegido en el filtro de trimestre (todo el
// ciclo por defecto), aunque no estén visibles en la ventana actual.
const TAM_VENTANA_FECHAS = 10;

const AYUDA_MARCAR = 'Haz clic en una celda para marcar Presente → Falta → Justificada → Retardo. Debajo de cada falta o retardo aparece "motivo" por si quieres aclarar qué pasó — es opcional y lo puedes anotar cuando lo sepas. El ícono 📝 agrega una nota en los demás días.';

function textoAyuda(soloLectura, puedeEditarGrupo) {
  if (soloLectura) {
    return 'Solo lectura: no se puede editar la asistencia. Donde haya un motivo de falta o de retardo anotado, aparece "ver motivo" debajo de la celda para consultarlo.';
  }
  if (!puedeEditarGrupo) {
    return `${AYUDA_MARCAR} Este grupo es de otro maestro: puedes corregirle la asistencia y agregar fechas, pero los valores de asistencia y el calendario del curso solo los cambia él.`;
  }
  return AYUDA_MARCAR;
}

const DIAS_SEMANA_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function diaSemanaCorto(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return DIAS_SEMANA_CORTOS[new Date(anio, mes - 1, dia).getDay()];
}

// soloLectura: no se puede tocar la asistencia (hoy ya no lo usa nadie, pero se
// mantiene porque es el interruptor natural de esta vista).
// puedeEditarGrupo: además de marcar asistencias, se pueden abrir "Valores de
// asistencia" y "Calendario del curso" — los dos únicos botones de aquí que
// escriben el documento del grupo. Un revisor o administrador corrigiendo el pase
// de lista de otro maestro entra con soloLectura:false y puedeEditarGrupo:false.
// Semana de lunes a domingo, con fechas locales (ver fechaISO en gruposModel.js).
function sumarDias(fechaIso, dias) {
  const [anio, mes, dia] = fechaIso.split('-').map(Number);
  return fechaISO(new Date(anio, mes - 1, dia + dias));
}
function lunesDeSemana(fechaIso) {
  const [anio, mes, dia] = fechaIso.split('-').map(Number);
  return sumarDias(fechaIso, -((new Date(anio, mes - 1, dia).getDay() + 6) % 7));
}

// Un día "con lista" es uno donde se marcó al menos a un alumno.
function tieneMarcas(dia) {
  return Object.values((dia && dia.registros) || {}).some((reg) => reg && reg.estado);
}

export async function montarListaAsistencia(contenedor, grupo, { soloLectura = false, puedeEditarGrupo = !soloLectura } = {}) {
  clear(contenedor);
  contenedor.appendChild(el('p', {}, 'Cargando pase de lista…'));

  const dias = await listarAsistencias(grupo.id); // [{grupoId, fecha, registros, updatedAt}]
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));

  clear(contenedor);

  const alumnosActivos = (grupo.alumnos || []).filter((a) => a.activo !== false);
  // Misma escala que la rúbrica: la columna "Asistencia" se ve 0-10 o 0-100%
  // según el recuadro del grupo (ver usaPorcentaje en gruposModel.js).
  const escalaPorcentaje = usaPorcentaje(grupo);

  const campoFecha = el('input', { type: 'date', value: fechaHoyISO() });
  const btnAgregarFecha = el('button', { type: 'button', class: 'btn-primario' }, '+ Agregar fecha');
  const btnAgregarHoy = el('button', { type: 'button', class: 'btn-secundario' }, '+ Agregar fecha de hoy');

  const contenedorTabla = el('div', { class: 'envoltura-tabla-excel' });

  // Cuenta los estados de un alumno dentro de los días que se le pasen — no de
  // todo el ciclo: con un trimestre seleccionado, "Faltas" y "Asistencia" se
  // recalculan sobre ese trimestre para que el maestro pueda cerrarlo de un
  // vistazo (con "Todo el ciclo" vuelven a ser el acumulado de siempre).
  function totalesDeAlumno(alumno, diasIncluidos) {
    const totales = { presente: 0, falta: 0, retardo: 0, justificada: 0 };
    for (const dia of diasIncluidos) {
      const reg = dia.registros[alumno.id];
      if (reg && reg.estado) totales[reg.estado] = (totales[reg.estado] || 0) + 1;
    }
    return totales;
  }

  // Índice (dentro de `fechas`, ya ordenadas) donde empieza la ventana de 10
  // fechas que se muestra — se ajusta con las flechas y se recalcula en cada
  // pintarTabla() por si se agregó o quitó una fecha mientras tanto.
  let ventanaInicio = 0;
  let ventanaInicializada = false;

  // Fecha donde arranca la vista: el último día en que se pasó lista; si
  // todavía no se marca nada, el último día capturado hasta hoy. (Antes era la
  // fecha más reciente, que con los días de clase del ciclo dados de alta de
  // un jalón mandaba al maestro al final del ciclo, lejos de donde va.)
  function fechaDeInicio(fechas) {
    const conMarcas = fechas.filter((f) => tieneMarcas(porFecha.get(f)));
    if (conMarcas.length) return conMarcas[conMarcas.length - 1];
    const hoy = fechaHoyISO();
    const pasadas = fechas.filter((f) => f <= hoy);
    return pasadas.length ? pasadas[pasadas.length - 1] : (fechas[fechas.length - 1] || null);
  }

  // Vista por semana: con un día elegido se ven solo las fechas de su semana
  // (lunes a domingo), sin tener que desplazarse. Es solo una vista: "Faltas" y
  // "Asistencia" siguen contando todo el periodo (ciclo o trimestre), igual que
  // con la ventana de 10 fechas. Al abrir el grupo arranca en la semana del
  // último día en que se pasó lista.
  const fechaArranque = fechaDeInicio(Array.from(porFecha.keys()).sort());
  let semanaDe = fechaArranque ? lunesDeSemana(fechaArranque) : null;
  const campoSemana = el('input', {
    type: 'date', value: fechaArranque || fechaHoyISO(),
    title: 'Elige cualquier día: se muestra su semana completa (lunes a domingo).',
    onchange: (e) => { if (e.target.value) verSemana(e.target.value); },
  });
  const btnVerTodas = el('button', {
    type: 'button', class: 'btn-secundario',
    title: 'Volver a ver todas las fechas, de 10 en 10.',
    onclick: () => verTodasLasFechas(),
  }, 'Ver todas las fechas');

  // Filtro por trimestre: con los trimestres capturados en "Calendario del curso",
  // acota la tabla (y sus totales) a las fechas de uno solo, para no tener que
  // navegar todo el ciclo de 10 en 10. Se muestra también en solo lectura, porque
  // revisores y administradores lo necesitan igual que los maestros — por eso va
  // fuera de la barra de botones de captura, que sí se les oculta.
  const trimestres = (calendarioDeGrupo(grupo).trimestres || []).filter((t) => t.inicio && t.fin);
  let filtroTrimestre = 'todos';
  const barraFiltroTrimestre = el('div', { class: 'barra-filtros' });
  let selectTrimestre = null;
  barraFiltroTrimestre.appendChild(el('span', { class: 'etiqueta-chica' }, 'Ver la semana del día:'));
  barraFiltroTrimestre.appendChild(campoSemana);
  barraFiltroTrimestre.appendChild(btnVerTodas);
  if (trimestres.length > 0) {
    barraFiltroTrimestre.appendChild(el('span', { class: 'etiqueta-chica' }, 'Periodo:'));
    selectTrimestre = el('select', {
      title: 'Muestra solo las fechas de un trimestre; "Faltas" y "Asistencia" se recalculan sobre él.',
      onchange: (e) => {
        filtroTrimestre = e.target.value;
        // Se recalcula la ventana igual que al entrar: alrededor del último día
        // con lista del periodo elegido. Arrancar al principio del trimestre
        // dejaba al maestro en agosto teniendo que avanzar de 10 en 10 hasta hoy,
        // que es justo donde necesita pasar lista. Elegir un periodo es querer
        // verlo completo, así que se sale de la vista por semana.
        semanaDe = null;
        ventanaInicializada = false;
        pintarTabla();
      },
    }, [
      el('option', { value: 'todos' }, 'Todo el ciclo'),
      ...trimestres.map((t, i) => el('option', { value: t.id }, t.nombre || `Trimestre ${i + 1}`)),
    ]);
    barraFiltroTrimestre.appendChild(selectTrimestre);
  }

  // Una fecha nueva que cae fuera del trimestre filtrado no se vería, y el
  // maestro solo notaría que "no pasó nada" al agregarla: se quita el filtro.
  function asegurarFechaVisible(fecha) {
    const trimestreActivo = trimestres.find((t) => t.id === filtroTrimestre);
    if (!trimestreActivo) return;
    if (fechasEnTrimestre([fecha], trimestreActivo).length > 0) return;
    filtroTrimestre = 'todos';
    if (selectTrimestre) selectTrimestre.value = 'todos';
  }

  function verSemana(diaElegido) {
    semanaDe = lunesDeSemana(diaElegido);
    campoSemana.value = diaElegido;
    // Mismo motivo que asegurarFechaVisible: una semana fuera del trimestre
    // filtrado se vería vacía aunque sí tenga fechas.
    const trimestreActivo = trimestres.find((t) => t.id === filtroTrimestre);
    if (trimestreActivo && (sumarDias(semanaDe, 6) < trimestreActivo.inicio || semanaDe > trimestreActivo.fin)) {
      filtroTrimestre = 'todos';
      if (selectTrimestre) selectTrimestre.value = 'todos';
    }
    pintarTabla();
  }

  // Al salir de la vista por semana, la ventana de 10 arranca en esa semana
  // para no perder el lugar donde estaba el maestro.
  function verTodasLasFechas() {
    if (semanaDe) {
      const trimestreActivo = trimestres.find((t) => t.id === filtroTrimestre) || null;
      const todas = Array.from(porFecha.keys()).sort();
      const fechas = trimestreActivo ? fechasEnTrimestre(todas, trimestreActivo) : todas;
      const indice = fechas.findIndex((f) => f >= semanaDe);
      ventanaInicio = indice === -1 ? Number.MAX_SAFE_INTEGER : indice;
      ventanaInicializada = true;
    }
    semanaDe = null;
    pintarTabla();
  }

  // Quita una fecha completa del pase de lista (la columna de ese día, con todo
  // lo marcado en ella). Solo borra ese día de este grupo; antes de hacerlo
  // dice exactamente qué se perdería.
  async function quitarFecha(fecha) {
    const dia = porFecha.get(fecha);
    const registros = Object.values((dia && dia.registros) || {});
    const marcas = registros.filter((reg) => reg && reg.estado).length;
    const notas = registros.filter((reg) => reg && reg.nota && reg.nota.trim()).length;
    const nombreDia = `${diaSemanaCorto(fecha)} ${fechaCortaMX(fecha)}`;
    const detalle = marcas || notas
      ? `\n\nOJO: ese día ya tiene ${marcas} alumno(s) marcado(s)${notas ? ` y ${notas} nota(s) o motivo(s)` : ''}. Se borrarán y no se puede deshacer; las faltas y la asistencia de los alumnos se recalcularán sin ese día.`
      : '\n\nEse día no tiene nada marcado.';
    if (!confirm(`¿Quitar el ${nombreDia} del pase de lista de este grupo?${detalle}`)) return;
    try {
      await eliminarAsistencia(grupo.id, fecha);
    } catch (err) {
      alert(`No se pudo quitar la fecha: ${err.message}`);
      return;
    }
    porFecha.delete(fecha);
    pintarTabla();
  }

  // El motivo de una falta o de un retardo casi nunca se sabe en el momento de
  // marcarlo (el alumno aparece después, o avisa la orientadora), así que NO se
  // pregunta al marcarlo: esas celdas muestran un enlace "motivo" debajo y el
  // modal solo se abre si el maestro lo pide. El texto se guarda en la misma
  // nota del día que usa el ícono 📝 del resto de las celdas, para no tener dos
  // textos por alumno y día. En solo lectura (revisor/administrador consultando
  // el grupo de otro maestro) el mismo modal sirve para CONSULTAR el motivo: se
  // ve el texto completo, pero el campo va bloqueado y no hay botón de guardar.
  function abrirModalMotivo(alumno, fecha, dia, reg) {
    const textos = TEXTOS_MOTIVO[reg.estado] || TEXTOS_MOTIVO.falta;
    const overlay = el('div', { class: 'overlay-modal tema-verde' });
    const campo = el('textarea', {
      rows: '3', disabled: soloLectura,
      placeholder: soloLectura ? 'El maestro no anotó ningún motivo.' : textos.ejemplo,
    });
    campo.value = reg.nota || '';
    const mensaje = el('p', { class: 'mensaje-login' });
    const btnGuardar = el('button', { type: 'button', class: 'btn-primario' }, 'Guardar motivo');
    const btnCancelar = el('button', { type: 'button', class: 'btn-secundario' }, soloLectura ? 'Cerrar' : 'Cancelar');

    function alPresionarTecla(e) { if (e.key === 'Escape') cerrar(); }
    function cerrar() {
      document.removeEventListener('keydown', alPresionarTecla);
      overlay.remove();
    }
    document.addEventListener('keydown', alPresionarTecla);
    btnCancelar.onclick = cerrar;

    btnGuardar.onclick = async () => {
      reg.nota = campo.value.trim();
      dia.registros[alumno.id] = reg;
      btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';
      try {
        await guardarAsistencia(dia);
      } catch (err) {
        mensaje.textContent = `No se pudo guardar el motivo: ${err.message}`;
        btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar motivo';
        return;
      }
      cerrar();
      pintarTabla();
    };

    overlay.appendChild(el('div', { class: 'panel modal-motivo-falta' }, [
      el('h2', {}, textos.titulo),
      el('p', { class: 'etiqueta-chica' }, soloLectura
        ? `${alumno.nombre} — ${fechaCortaMX(fecha)}. Solo lectura: puedes consultar el motivo, pero no cambiarlo.`
        : `${alumno.nombre} — ${fechaCortaMX(fecha)}. Déjalo vacío y guarda si quieres borrar el motivo que ya tenía.`),
      campo,
      el('div', { class: 'acciones-modal' }, soloLectura ? [btnCancelar] : [btnGuardar, btnCancelar]),
      mensaje,
    ]));
    document.body.appendChild(overlay);
    if (!soloLectura) campo.focus();
  }

  function pintarTabla() {
    // Cada clic en una celda repinta la tabla completa (para recalcular los
    // totales) y el recuadro de desplazamiento se crea de nuevo, que arranca
    // arriba: sin esto, al marcar a un alumno de abajo en una lista larga la
    // tabla regresaba al primero. Se guarda dónde estaba y se restaura abajo.
    const cajaAnterior = contenedorTabla.querySelector('.desplazamiento-tabla-excel');
    const desplazamientoPrevio = cajaAnterior ? { arriba: cajaAnterior.scrollTop, izquierda: cajaAnterior.scrollLeft } : null;
    clear(contenedorTabla);

    if (alumnosActivos.length === 0) {
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio' }, 'Agrega alumnos al grupo para empezar a tomar asistencia.'));
      return;
    }

    const trimestreActivo = trimestres.find((t) => t.id === filtroTrimestre) || null;
    const todasLasFechas = Array.from(porFecha.keys()).sort();
    const fechas = trimestreActivo ? fechasEnTrimestre(todasLasFechas, trimestreActivo) : todasLasFechas;
    const diasArray = fechas.map((f) => porFecha.get(f));

    if (trimestreActivo && fechas.length === 0) {
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio' }, `No hay fechas capturadas dentro de "${trimestreActivo.nombre || 'ese trimestre'}" (${trimestreActivo.inicio} a ${trimestreActivo.fin}).`));
      return;
    }

    const maxVentanaInicio = Math.max(0, fechas.length - TAM_VENTANA_FECHAS);
    if (!ventanaInicializada) {
      // Por defecto, la ventana termina un día después del último día con lista
      // (ver fechaDeInicio): se ve lo último que se pasó y la clase que sigue.
      const indice = fechas.indexOf(fechaDeInicio(fechas));
      ventanaInicio = indice === -1 ? maxVentanaInicio : indice - (TAM_VENTANA_FECHAS - 2);
      ventanaInicializada = true;
    }
    ventanaInicio = Math.min(Math.max(0, ventanaInicio), maxVentanaInicio);

    const finSemana = semanaDe ? sumarDias(semanaDe, 6) : null;
    const fechasVisibles = semanaDe
      ? fechas.filter((f) => f >= semanaDe && f <= finSemana)
      : fechas.slice(ventanaInicio, ventanaInicio + TAM_VENTANA_FECHAS);

    function crearBarraSemana() {
      const moverSemana = (dias) => {
        semanaDe = sumarDias(semanaDe, dias);
        campoSemana.value = semanaDe;
        pintarTabla();
      };
      return el('div', { class: 'barra-navegacion-fechas' }, [
        el('button', {
          type: 'button', class: 'btn-nav-fechas', title: 'Ver la semana anterior',
          onclick: () => moverSemana(-7),
        }, '◀ Semana anterior'),
        el('span', { class: 'etiqueta-nav-fechas' }, `Semana del ${diaSemanaCorto(semanaDe)} ${fechaCortaMX(semanaDe)} al ${diaSemanaCorto(finSemana)} ${fechaCortaMX(finSemana)}`),
        el('button', {
          type: 'button', class: 'btn-nav-fechas', title: 'Ver la semana siguiente',
          onclick: () => moverSemana(7),
        }, 'Semana siguiente ▶'),
      ]);
    }

    if (semanaDe && fechasVisibles.length === 0) {
      contenedorTabla.appendChild(crearBarraSemana());
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio aviso-semana-vacia' }, soloLectura
        ? 'No hay fechas en el pase de lista en esta semana.'
        : 'No hay fechas en el pase de lista en esta semana. Si hubo clase, agrégala con "+ Agregar fecha".'));
      return;
    }

    function crearBarraNavegacion() {
      if (semanaDe) return null;
      if (fechas.length <= TAM_VENTANA_FECHAS) return null;
      const inicioMostrado = ventanaInicio + 1;
      const finMostrado = Math.min(ventanaInicio + TAM_VENTANA_FECHAS, fechas.length);
      return el('div', { class: 'barra-navegacion-fechas' }, [
        el('button', {
          type: 'button', class: 'btn-nav-fechas', disabled: ventanaInicio <= 0,
          title: 'Ver las 10 fechas anteriores',
          onclick: () => { ventanaInicio = Math.max(0, ventanaInicio - TAM_VENTANA_FECHAS); pintarTabla(); },
        }, '▲ Anteriores'),
        el('span', { class: 'etiqueta-nav-fechas' }, `Fechas ${inicioMostrado}–${finMostrado} de ${fechas.length}`),
        el('button', {
          type: 'button', class: 'btn-nav-fechas', disabled: ventanaInicio >= maxVentanaInicio,
          title: 'Ver las siguientes 10 fechas',
          onclick: () => { ventanaInicio = Math.min(maxVentanaInicio, ventanaInicio + TAM_VENTANA_FECHAS); pintarTabla(); },
        }, 'Siguientes ▼'),
      ]);
    }

    const encabezado = el('tr', {}, [
      el('th', { class: 'celda-nombre-alumno' }, 'Alumno'),
      ...fechasVisibles.map((f) => el('th', { class: 'col-fecha' }, [
        el('div', { class: 'dia-semana-corto' }, diaSemanaCorto(f)),
        el('div', {}, fechaCortaMX(f)),
        soloLectura ? null : el('button', {
          type: 'button', class: 'btn-quitar-fecha', title: `Quitar el ${fechaCortaMX(f)} del pase de lista`,
          onclick: () => quitarFecha(f),
        }, '✕ quitar'),
      ])),
      el('th', {}, 'Faltas'),
      el('th', {}, 'Asistencia'),
    ]);

    const filas = alumnosActivos.map((alumno) => {
      const celdas = fechasVisibles.map((f) => {
        const dia = porFecha.get(f);
        const reg = dia.registros[alumno.id] || { estado: null, nota: '' };
        // En una falta o un retardo, la nota del día ES el motivo: en vez del
        // ícono 📝 genérico se ofrece un enlace "motivo" con todas sus letras
        // debajo de la celda, que el maestro usa solo si tiene algo que aclarar.
        const llevaMotivo = ESTADOS_CON_MOTIVO.has(reg.estado);
        const celda = el('td', { class: `celda-asistencia ${reg.estado ? `estado-${reg.estado}` : ''}` }, [
          el('div', { class: 'fila-celda-asistencia' }, [
          el('button', {
            type: 'button', class: 'btn-celda-estado', disabled: soloLectura,
            title: ETIQUETAS_ESTADO_ASISTENCIA[reg.estado] || 'Sin marcar',
            onclick: soloLectura ? undefined : async () => {
              const actual = reg.estado || null;
              const siguiente = SIGUIENTE_ESTADO[actual === null ? 'null' : actual];
              reg.estado = siguiente;
              dia.registros[alumno.id] = reg;
              try {
                await guardarAsistencia(dia);
              } catch (err) {
                alert(`No se pudo guardar: ${err.message}`);
              }
              pintarTabla();
            },
          }, reg.estado ? INICIALES_ESTADO[reg.estado] : '·'),
          llevaMotivo ? null : el('button', {
            type: 'button', class: `btn-nota-dia ${reg.nota ? 'tiene-nota' : ''}`, disabled: soloLectura,
            title: reg.nota ? `Nota: ${reg.nota}` : 'Agregar nota',
            onclick: soloLectura ? undefined : async () => {
              const nueva = prompt(`Nota para ${alumno.nombre} el ${fechaCortaMX(f)}:`, reg.nota || '');
              if (nueva === null) return;
              reg.nota = nueva.trim();
              dia.registros[alumno.id] = reg;
              try {
                await guardarAsistencia(dia);
              } catch (err) {
                alert(`No se pudo guardar: ${err.message}`);
              }
              pintarTabla();
            },
          }, '📝'),
          ]),
          // En solo lectura no hay nada que agregar, así que el enlace solo
          // aparece cuando ya hay un motivo escrito — pero sí se puede abrir:
          // revisores y administradores necesitan leerlo completo (el title se
          // queda corto con textos largos), aunque no puedan modificarlo.
          !llevaMotivo || (soloLectura && !reg.nota) ? null : el('button', {
            type: 'button', class: `btn-motivo-falta ${reg.nota ? 'tiene-motivo' : ''}`,
            title: reg.nota ? reg.nota : TEXTOS_MOTIVO[reg.estado].ayudaEnlace,
            onclick: () => abrirModalMotivo(alumno, f, dia, reg),
          }, soloLectura ? 'ver motivo' : (reg.nota ? 'motivo ✓' : 'motivo')),
        ]);
        return celda;
      });

      const totales = totalesDeAlumno(alumno, diasArray);
      const promedio = promedioAsistenciaAlumno(grupo, alumno.id, diasArray);
      return el('tr', {}, [
        el('td', { class: 'celda-nombre-alumno' }, alumno.nombre),
        ...celdas,
        el('td', { class: 'celda-totales' }, String(totales.falta || 0)),
        el('td', { class: 'celda-promedio' }, formatearNota(promedio === null ? null : promedio * 10, escalaPorcentaje, 1)),
      ]);
    });

    const barraArriba = semanaDe ? crearBarraSemana() : crearBarraNavegacion();
    if (barraArriba) contenedorTabla.appendChild(barraArriba);
    // La tabla se desplaza dentro de su propio recuadro (con alto máximo) para
    // que el renglón de fechas se quede fijo arriba al recorrer la lista: si
    // se desplazara con la página, el overflow-x de .envoltura-tabla-excel
    // anula el position: sticky del encabezado y las fechas se pierden de vista.
    const caja = el('div', { class: 'desplazamiento-tabla-excel' }, [
      el('table', { class: 'tabla-excel' }, [
        el('thead', {}, [encabezado]),
        el('tbody', {}, filas),
      ]),
    ]);
    contenedorTabla.appendChild(caja);
    if (desplazamientoPrevio) {
      caja.scrollTop = desplazamientoPrevio.arriba;
      caja.scrollLeft = desplazamientoPrevio.izquierda;
    }
    const barraAbajo = crearBarraNavegacion();
    if (barraAbajo) contenedorTabla.appendChild(barraAbajo);
  }

  async function agregarFecha(fecha) {
    if (!porFecha.has(fecha)) {
      try {
        const nueva = await obtenerOCrearAsistencia(grupo.id, fecha);
        porFecha.set(fecha, nueva);
      } catch (err) {
        alert(`No se pudo agregar la fecha: ${err.message}`);
        return;
      }
    }
    // Lleva la vista hasta la fecha recién agregada para que quede a la vista
    // de inmediato: en la vista por semana, a su semana; si no, la ventana de
    // 10 fechas se mueve hasta ella.
    asegurarFechaVisible(fecha);
    if (semanaDe) {
      semanaDe = lunesDeSemana(fecha);
      campoSemana.value = fecha;
    } else {
      const trimestreActivo = trimestres.find((t) => t.id === filtroTrimestre) || null;
      const todas = Array.from(porFecha.keys()).sort();
      const fechas = trimestreActivo ? fechasEnTrimestre(todas, trimestreActivo) : todas;
      ventanaInicio = fechas.indexOf(fecha) - (TAM_VENTANA_FECHAS - 1);
      ventanaInicializada = true;
    }
    pintarTabla();
  }

  btnAgregarFecha.onclick = () => agregarFecha(campoFecha.value || fechaHoyISO());
  btnAgregarHoy.onclick = () => agregarFecha(fechaHoyISO());

  const leyenda = el('div', { class: 'leyenda-asistencia' });
  function pintarLeyenda() {
    clear(leyenda);
    const valores = valoresAsistenciaDeGrupo(grupo);
    ESTADOS_ASISTENCIA.forEach((estado) => {
      leyenda.appendChild(el('span', { class: 'leyenda-item' }, [
        el('span', { class: `leyenda-swatch estado-${estado}` }, INICIALES_ESTADO_ASISTENCIA[estado]),
        `${ETIQUETAS_ESTADO_ASISTENCIA[estado]} (${valores[estado]})`,
      ]));
    });
  }
  pintarLeyenda();

  const btnValores = el('button', { type: 'button', class: 'btn-secundario', onclick: () => abrirModalValores() }, '⚙ Valores de asistencia');

  function abrirModalValores() {
    const valores = valoresAsistenciaDeGrupo(grupo);
    const overlay = el('div', { class: 'overlay-modal tema-verde' });
    const campos = {};
    const filasCampos = ESTADOS_ASISTENCIA.map((estado) => {
      const input = el('input', {
        type: 'number', step: '0.05', min: '0', max: '1', value: valores[estado],
      });
      campos[estado] = input;
      return el('div', { class: 'campo' }, [
        el('label', {}, `${ETIQUETAS_ESTADO_ASISTENCIA[estado]} (${INICIALES_ESTADO_ASISTENCIA[estado]})`),
        input,
      ]);
    });
    const mensaje = el('p', { class: 'mensaje-login' });
    const btnGuardar = el('button', { type: 'button', class: 'btn-primario' }, 'Guardar');
    const btnCancelar = el('button', { type: 'button', class: 'btn-secundario', onclick: () => overlay.remove() }, 'Cancelar');

    btnGuardar.onclick = async () => {
      const nuevosValores = {};
      for (const estado of ESTADOS_ASISTENCIA) {
        const v = parseFloat(campos[estado].value);
        nuevosValores[estado] = Number.isFinite(v) ? v : 0;
      }
      grupo.valoresAsistencia = nuevosValores;
      btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';
      try {
        await guardarGrupo(grupo);
        overlay.remove();
        pintarLeyenda();
        pintarTabla();
      } catch (err) {
        mensaje.textContent = `No se pudo guardar: ${err.message}`;
        btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar';
      }
    };

    overlay.appendChild(el('div', { class: 'panel modal-cambiar-clave' }, [
      el('h2', {}, 'Valores de asistencia'),
      el('p', { class: 'etiqueta-chica' }, 'Puntos que vale cada tipo (escala 0 a 1) para calcular la columna "Asistencia" de cada alumno.'),
      ...filasCampos,
      el('div', { class: 'acciones-modal' }, [btnGuardar, btnCancelar]),
      mensaje,
    ]));
    document.body.appendChild(overlay);
  }

  // --- Calendario del curso (opcional) ---
  // Días de clase, inicio/fin de ciclo y, si el maestro quiere, trimestres con
  // sus propias fechas — solo se usa para dividir el Excel exportado del pase de
  // lista en una tabla general y una tabla por trimestre; nada de esto afecta la
  // tabla que se ve en pantalla.
  const btnCalendario = el('button', { type: 'button', class: 'btn-secundario', onclick: () => abrirModalCalendario() }, '🗓 Calendario del curso');

  function abrirModalCalendario() {
    const cal = calendarioDeGrupo(grupo);
    const overlay = el('div', { class: 'overlay-modal tema-verde' });

    const ordenSemana = [1, 2, 3, 4, 5, 6, 0]; // lunes primero, para que se vea como una semana normal
    const checksDias = {};
    const filaDias = el('div', { class: 'fila-dias-clase' }, ordenSemana.map((indice) => {
      const input = el('input', { type: 'checkbox', checked: cal.diasClase.includes(indice) });
      checksDias[indice] = input;
      return el('label', { class: 'chip-dia-clase' }, [input, DIAS_SEMANA_NOMBRES[indice].slice(0, 3)]);
    }));

    const campoInicioCiclo = el('input', { type: 'date', value: cal.inicioCiclo || '' });
    const campoFinCiclo = el('input', { type: 'date', value: cal.finCiclo || '' });

    let trimestres = cal.trimestres.map((t) => ({ ...t }));
    const contenedorTrimestres = el('div', {});
    // El aviso vive en su propio contenedor, fuera de las filas: si estuviera
    // adentro, actualizarlo en cada tecla de una fecha forzaría un pintarTrimestres()
    // completo que reconstruye (clear + appendChild) el mismísimo <input> en el que
    // el maestro sigue escribiendo — el navegador truena con "removeChild" a media
    // pulsación (mismo motivo por el que campoBusqueda, en filtros.js, no repinta
    // el campo en cada tecla).
    const contenedorAvisoTrimestres = el('div', {});
    function actualizarAvisoSuperpuestos() {
      clear(contenedorAvisoTrimestres);
      const superpuestos = trimestresSuperpuestos(trimestres);
      if (superpuestos.length > 0) {
        contenedorAvisoTrimestres.appendChild(el('p', { class: 'aviso-vacio aviso-trimestres-superpuestos' },
          `⚠ ${superpuestos.map(([a, b]) => `"${a.nombre || 'Trimestre'}" y "${b.nombre || 'Trimestre'}"`).join(', ')} comparten fechas — esos días se contarían dos veces en Faltas/Asistencia y en el Excel. Ajusta que un trimestre empiece justo un día después de que termine el anterior.`));
      }
    }
    function pintarTrimestres() {
      clear(contenedorTrimestres);
      if (trimestres.length === 0) {
        contenedorTrimestres.appendChild(el('p', { class: 'aviso-vacio' }, 'Sin trimestres — el Excel solo traerá la tabla general.'));
      }
      trimestres.forEach((tri, i) => {
        contenedorTrimestres.appendChild(el('div', { class: 'fila-trimestre' }, [
          el('input', {
            type: 'text', placeholder: `Trimestre ${i + 1}`, value: tri.nombre,
            oninput: (e) => { tri.nombre = e.target.value; actualizarAvisoSuperpuestos(); },
          }),
          el('input', { type: 'date', value: tri.inicio || '', oninput: (e) => { tri.inicio = e.target.value; actualizarAvisoSuperpuestos(); } }),
          el('input', { type: 'date', value: tri.fin || '', oninput: (e) => { tri.fin = e.target.value; actualizarAvisoSuperpuestos(); } }),
          el('button', {
            type: 'button', class: 'btn-icono btn-eliminar', title: 'Quitar trimestre',
            onclick: () => { trimestres = trimestres.filter((t) => t.id !== tri.id); pintarTrimestres(); },
          }, '✕'),
        ]));
      });
      actualizarAvisoSuperpuestos();
    }
    pintarTrimestres();

    const btnAgregarTrimestre = el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => { trimestres.push(nuevoTrimestre('')); pintarTrimestres(); },
    }, '+ Agregar trimestre');
    const btnTrimestresEstandar = el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => { trimestres = crearTrimestresEstandar(); pintarTrimestres(); },
    }, '✨ Usar los 3 trimestres estándar');

    const mensaje = el('p', { class: 'mensaje-login' });
    const btnGuardar = el('button', { type: 'button', class: 'btn-primario' }, 'Guardar');
    const btnCancelar = el('button', { type: 'button', class: 'btn-secundario', onclick: () => overlay.remove() }, 'Cancelar');

    // Lo que hay capturado en el modal ahora mismo — lo usan tanto "Guardar" como
    // "Agregar días de clase", para que este último no dependa de guardar primero.
    function calendarioDelFormulario() {
      return {
        diasClase: ordenSemana.filter((indice) => checksDias[indice].checked),
        inicioCiclo: campoInicioCiclo.value || '',
        finCiclo: campoFinCiclo.value || '',
        trimestres,
      };
    }

    btnGuardar.onclick = async () => {
      grupo.calendario = calendarioDelFormulario();
      btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';
      try {
        await guardarGrupo(grupo);
        overlay.remove();
      } catch (err) {
        mensaje.textContent = `No se pudo guardar: ${err.message}`;
        btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar';
      }
    };

    // Genera de un golpe todas las fechas del ciclo que caen en los días de clase
    // marcados y las da de alta en el pase de lista, para no tener que agregarlas
    // una por una a lo largo del año.
    const btnAgregarDiasClase = el('button', { type: 'button', class: 'btn-primario' }, '📅 Agregar días de clase al pase de lista');
    btnAgregarDiasClase.onclick = async () => {
      const calendario = calendarioDelFormulario();
      if (calendario.diasClase.length === 0) { mensaje.textContent = 'Marca al menos un día de clase.'; return; }
      if (!calendario.inicioCiclo || !calendario.finCiclo) { mensaje.textContent = 'Captura el inicio y el fin del ciclo.'; return; }
      if (calendario.finCiclo < calendario.inicioCiclo) { mensaje.textContent = 'El fin del ciclo no puede ser antes del inicio.'; return; }

      const todas = fechasDeClase(calendario);
      const nuevas = todas.filter((f) => !porFecha.has(f));
      if (nuevas.length === 0) {
        mensaje.textContent = todas.length === 0
          ? 'No hay días de clase en ese rango de fechas.'
          : 'Todas las fechas de clase de ese rango ya están en el pase de lista.';
        return;
      }
      const yaEstaban = todas.length - nuevas.length;
      const detalle = yaEstaban > 0 ? ` (otras ${yaEstaban} ya estaban).` : '.';
      if (!confirm(`Se agregarán ${nuevas.length} fechas al pase de lista${detalle}\n\nDel ${calendario.inicioCiclo} al ${calendario.finCiclo}, los días marcados. ¿Continuar?`)) return;

      mensaje.textContent = '';
      btnAgregarDiasClase.disabled = true; btnGuardar.disabled = true; btnCancelar.disabled = true;
      try {
        grupo.calendario = calendario;
        await guardarGrupo(grupo);
        let hechas = 0;
        for (const fecha of nuevas) {
          // obtenerOCrearAsistencia y no nuevaAsistencia a secas: si otro
          // dispositivo ya había capturado ese día, se respeta lo que tenga en vez
          // de sobrescribirlo con un día vacío.
          const dia = await obtenerOCrearAsistencia(grupo.id, fecha);
          await guardarAsistencia(dia);
          porFecha.set(fecha, dia);
          hechas += 1;
          btnAgregarDiasClase.textContent = `Agregando ${hechas} de ${nuevas.length}…`;
        }
        overlay.remove();
        ventanaInicio = 0; // las fechas nuevas arrancan al inicio del ciclo
        ventanaInicializada = true;
        pintarTabla();
      } catch (err) {
        mensaje.textContent = `No se pudieron agregar todas las fechas: ${err.message}`;
        btnAgregarDiasClase.disabled = false; btnGuardar.disabled = false; btnCancelar.disabled = false;
        btnAgregarDiasClase.textContent = '📅 Agregar días de clase al pase de lista';
        pintarTabla(); // deja a la vista las que sí alcanzaron a crearse
      }
    };

    overlay.appendChild(el('div', { class: 'panel modal-calendario' }, [
      el('h2', {}, 'Calendario del curso'),
      el('p', { class: 'etiqueta-chica' }, 'Con los días de clase y las fechas del ciclo puedes dar de alta todo el pase de lista de un jalón (botón de abajo). Los trimestres, además, dividen el pase de lista exportado a Excel en una tabla general y una por trimestre.'),
      el('label', {}, 'Días de clase'),
      filaDias,
      el('div', { class: 'rejilla-campos', style: 'margin-top:0.6rem;' }, [
        el('div', { class: 'campo' }, [el('label', {}, 'Inicio del ciclo'), campoInicioCiclo]),
        el('div', { class: 'campo' }, [el('label', {}, 'Fin del ciclo'), campoFinCiclo]),
      ]),
      el('div', { class: 'barra-nueva' }, [btnAgregarDiasClase]),
      el('p', { class: 'etiqueta-chica' }, 'Da de alta de una vez todas las fechas del ciclo que caen en los días marcados arriba, para no ir agregándolas una por una. Las fechas que ya tengas capturadas no se tocan.'),
      el('h2', { style: 'margin-top:1rem;' }, 'Trimestres (opcional)'),
      contenedorTrimestres,
      contenedorAvisoTrimestres,
      el('div', { class: 'barra-nueva' }, [btnAgregarTrimestre, btnTrimestresEstandar]),
      el('div', { class: 'acciones-modal' }, [btnGuardar, btnCancelar]),
      mensaje,
    ]));
    document.body.appendChild(overlay);
  }

  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'Pase de lista'),
    el('p', { class: 'etiqueta-chica' }, textoAyuda(soloLectura, puedeEditarGrupo)),
    leyenda,
    soloLectura ? null : el('div', { class: 'barra-nueva' }, [
      // Agregar una fecha sí entra en "corregir el pase de lista" (sin columna no
      // hay dónde marcar el día que faltó capturar); los valores de asistencia y el
      // calendario no: escriben el grupo y son configuración del curso.
      campoFecha, btnAgregarFecha, btnAgregarHoy,
      puedeEditarGrupo ? btnValores : null,
      puedeEditarGrupo ? btnCalendario : null,
    ]),
    barraFiltroTrimestre,
    contenedorTabla,
  ]));

  pintarTabla();
}
