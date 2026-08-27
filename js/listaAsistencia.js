// Pase de lista estilo Excel: alumnos en filas, fechas en columnas.

import { el, clear } from './dom.js';
import {
  listarAsistencias, obtenerOCrearAsistencia, guardarAsistencia, guardarGrupo,
} from './gruposStore.js';
import {
  ESTADOS_ASISTENCIA, ETIQUETAS_ESTADO_ASISTENCIA, INICIALES_ESTADO_ASISTENCIA, fechaHoyISO, fechaCortaMX,
  valoresAsistenciaDeGrupo, promedioAsistenciaAlumno,
  DIAS_SEMANA_NOMBRES, calendarioDeGrupo, nuevoTrimestre, crearTrimestresEstandar, fechasDeClase,
  fechasEnTrimestre, usaPorcentaje, formatearNota,
} from './gruposModel.js';

// Ciclo al hacer clic: sin marcar → presente → falta → justificada → sin marcar.
// "retardo" ya no forma parte del ciclo (se quitó); si una celda vieja lo tiene,
// un clic la limpia (retardo → null).
const SIGUIENTE_ESTADO = { null: 'presente', presente: 'falta', falta: 'justificada', justificada: null, retardo: null };
const INICIALES_ESTADO = INICIALES_ESTADO_ASISTENCIA;

// La tabla solo muestra 10 fechas a la vez (más que eso, las columnas se ponen
// demasiado angostas) — "Faltas" y "Asistencia" no cuentan para esto: se calculan
// con todas las fechas del periodo elegido en el filtro de trimestre (todo el
// ciclo por defecto), aunque no estén visibles en la ventana actual.
const TAM_VENTANA_FECHAS = 10;

const DIAS_SEMANA_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function diaSemanaCorto(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return DIAS_SEMANA_CORTOS[new Date(anio, mes - 1, dia).getDay()];
}

export async function montarListaAsistencia(contenedor, grupo, { soloLectura = false } = {}) {
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

  // Filtro por trimestre: con los trimestres capturados en "Calendario del curso",
  // acota la tabla (y sus totales) a las fechas de uno solo, para no tener que
  // navegar todo el ciclo de 10 en 10. Se muestra también en solo lectura, porque
  // revisores y administradores lo necesitan igual que los maestros — por eso va
  // fuera de la barra de botones de captura, que sí se les oculta.
  const trimestres = (calendarioDeGrupo(grupo).trimestres || []).filter((t) => t.inicio && t.fin);
  let filtroTrimestre = 'todos';
  const barraFiltroTrimestre = el('div', { class: 'barra-filtros' });
  let selectTrimestre = null;
  if (trimestres.length > 0) {
    barraFiltroTrimestre.appendChild(el('span', { class: 'etiqueta-chica' }, 'Ver:'));
    selectTrimestre = el('select', {
      title: 'Muestra solo las fechas de un trimestre; "Faltas" y "Asistencia" se recalculan sobre él.',
      onchange: (e) => {
        filtroTrimestre = e.target.value;
        // Se recalcula la ventana igual que al entrar: las 10 fechas MÁS
        // RECIENTES del periodo elegido. Arrancar al principio del trimestre
        // dejaba al maestro en agosto teniendo que avanzar de 10 en 10 hasta hoy,
        // que es justo donde necesita pasar lista.
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

  // El motivo de una falta casi nunca se sabe en el momento de marcarla (el alumno
  // aparece después, o avisa la orientadora), así que NO se pregunta al marcarla:
  // las celdas en falta muestran un enlace "motivo" debajo y el modal solo se abre
  // si el maestro lo pide. El texto se guarda en la misma nota del día que usa el
  // ícono 📝 del resto de las celdas, para no tener dos textos por alumno y día.
  // En solo lectura (revisor/administrador consultando el grupo de otro maestro)
  // el mismo modal sirve para CONSULTAR el motivo: se ve el texto completo, pero
  // el campo va bloqueado y no hay botón de guardar — pueden saber por qué faltó
  // el alumno sin poder cambiar lo que anotó el maestro.
  function abrirModalMotivo(alumno, fecha, dia, reg) {
    const overlay = el('div', { class: 'overlay-modal tema-verde' });
    const campo = el('textarea', {
      rows: '3', disabled: soloLectura,
      placeholder: soloLectura ? 'El maestro no anotó ningún motivo.' : 'Ej. se presentó con la orientadora, cita médica, permiso…',
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
      el('h2', {}, 'Motivo de la falta'),
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
      ventanaInicio = maxVentanaInicio; // por defecto, mostrar las 10 fechas más recientes
      ventanaInicializada = true;
    }
    ventanaInicio = Math.min(Math.max(0, ventanaInicio), maxVentanaInicio);
    const fechasVisibles = fechas.slice(ventanaInicio, ventanaInicio + TAM_VENTANA_FECHAS);

    function crearBarraNavegacion() {
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
      ])),
      el('th', {}, 'Faltas'),
      el('th', {}, 'Asistencia'),
    ]);

    const filas = alumnosActivos.map((alumno) => {
      const celdas = fechasVisibles.map((f) => {
        const dia = porFecha.get(f);
        const reg = dia.registros[alumno.id] || { estado: null, nota: '' };
        // En una falta, la nota del día ES el motivo: en vez del ícono 📝 genérico
        // se ofrece un enlace "motivo" con todas sus letras debajo de la celda,
        // que el maestro usa solo si tiene algo que aclarar.
        const esFalta = reg.estado === 'falta';
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
          esFalta ? null : el('button', {
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
          !esFalta || (soloLectura && !reg.nota) ? null : el('button', {
            type: 'button', class: `btn-motivo-falta ${reg.nota ? 'tiene-motivo' : ''}`,
            title: reg.nota ? reg.nota : 'Anotar por qué faltó el alumno (opcional)',
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

    const barraArriba = crearBarraNavegacion();
    if (barraArriba) contenedorTabla.appendChild(barraArriba);
    contenedorTabla.appendChild(el('table', { class: 'tabla-excel' }, [
      el('thead', {}, [encabezado]),
      el('tbody', {}, filas),
    ]));
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
    // Salta la ventana visible hasta el final, para que la fecha recién
    // agregada (siempre la más reciente) quede a la vista de inmediato.
    asegurarFechaVisible(fecha);
    ventanaInicio = Number.MAX_SAFE_INTEGER;
    ventanaInicializada = true;
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
    function pintarTrimestres() {
      clear(contenedorTrimestres);
      if (trimestres.length === 0) {
        contenedorTrimestres.appendChild(el('p', { class: 'aviso-vacio' }, 'Sin trimestres — el Excel solo traerá la tabla general.'));
      }
      trimestres.forEach((tri, i) => {
        contenedorTrimestres.appendChild(el('div', { class: 'fila-trimestre' }, [
          el('input', {
            type: 'text', placeholder: `Trimestre ${i + 1}`, value: tri.nombre,
            oninput: (e) => { tri.nombre = e.target.value; },
          }),
          el('input', { type: 'date', value: tri.inicio || '', oninput: (e) => { tri.inicio = e.target.value; } }),
          el('input', { type: 'date', value: tri.fin || '', oninput: (e) => { tri.fin = e.target.value; } }),
          el('button', {
            type: 'button', class: 'btn-icono btn-eliminar', title: 'Quitar trimestre',
            onclick: () => { trimestres = trimestres.filter((t) => t.id !== tri.id); pintarTrimestres(); },
          }, '✕'),
        ]));
      });
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
      el('div', { class: 'barra-nueva' }, [btnAgregarTrimestre, btnTrimestresEstandar]),
      el('div', { class: 'acciones-modal' }, [btnGuardar, btnCancelar]),
      mensaje,
    ]));
    document.body.appendChild(overlay);
  }

  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'Pase de lista'),
    el('p', { class: 'etiqueta-chica' }, soloLectura
      ? 'Solo lectura: no se puede editar la asistencia. Donde haya un motivo de falta anotado, aparece "ver motivo" debajo de la celda para consultarlo.'
      : 'Haz clic en una celda para marcar Presente → Falta → Justificada. Debajo de cada falta aparece "motivo" por si quieres aclarar por qué faltó el alumno — es opcional y lo puedes anotar cuando lo sepas. El ícono 📝 agrega una nota en los demás días.'),
    leyenda,
    soloLectura ? null : el('div', { class: 'barra-nueva' }, [campoFecha, btnAgregarFecha, btnAgregarHoy, btnValores, btnCalendario]),
    barraFiltroTrimestre,
    contenedorTabla,
  ]));

  pintarTabla();
}
