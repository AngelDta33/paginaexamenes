// Pase de lista estilo Excel: alumnos en filas, fechas en columnas.

import { el, clear } from './dom.js';
import {
  listarAsistencias, obtenerOCrearAsistencia, guardarAsistencia, guardarGrupo,
} from './gruposStore.js';
import {
  ESTADOS_ASISTENCIA, ETIQUETAS_ESTADO_ASISTENCIA, INICIALES_ESTADO_ASISTENCIA, fechaHoyISO, fechaCortaMX,
  valoresAsistenciaDeGrupo, promedioAsistenciaAlumno,
  DIAS_SEMANA_NOMBRES, calendarioDeGrupo, nuevoTrimestre, crearTrimestresEstandar,
} from './gruposModel.js';

// Ciclo al hacer clic: sin marcar → presente → falta → justificada → sin marcar.
// "retardo" ya no forma parte del ciclo (se quitó); si una celda vieja lo tiene,
// un clic la limpia (retardo → null).
const SIGUIENTE_ESTADO = { null: 'presente', presente: 'falta', falta: 'justificada', justificada: null, retardo: null };
const INICIALES_ESTADO = INICIALES_ESTADO_ASISTENCIA;

// La tabla solo muestra 10 fechas a la vez (más que eso, las columnas se ponen
// demasiado angostas) — "Faltas" y "Asistencia" no cuentan para esto: siempre se
// calculan con TODAS las fechas, aunque no estén visibles en la ventana actual.
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

  const campoFecha = el('input', { type: 'date', value: fechaHoyISO() });
  const btnAgregarFecha = el('button', { type: 'button', class: 'btn-primario' }, '+ Agregar fecha');
  const btnAgregarHoy = el('button', { type: 'button', class: 'btn-secundario' }, '+ Agregar fecha de hoy');

  const contenedorTabla = el('div', { class: 'envoltura-tabla-excel' });

  function alturaFila(alumno) {
    const totales = { presente: 0, falta: 0, retardo: 0, justificada: 0 };
    for (const dia of porFecha.values()) {
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

  function pintarTabla() {
    clear(contenedorTabla);

    if (alumnosActivos.length === 0) {
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio' }, 'Agrega alumnos al grupo para empezar a tomar asistencia.'));
      return;
    }

    const fechas = Array.from(porFecha.keys()).sort();
    const diasArray = Array.from(porFecha.values());

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
        const celda = el('td', { class: `celda-asistencia ${reg.estado ? `estado-${reg.estado}` : ''}` }, [
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
          el('button', {
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
        ]);
        return celda;
      });

      const totales = alturaFila(alumno);
      const promedio = promedioAsistenciaAlumno(grupo, alumno.id, diasArray);
      return el('tr', {}, [
        el('td', { class: 'celda-nombre-alumno' }, alumno.nombre),
        ...celdas,
        el('td', { class: 'celda-totales' }, String(totales.falta || 0)),
        el('td', { class: 'celda-promedio' }, promedio === null ? '—' : (promedio * 10).toFixed(1)),
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

    btnGuardar.onclick = async () => {
      grupo.calendario = {
        diasClase: ordenSemana.filter((indice) => checksDias[indice].checked),
        inicioCiclo: campoInicioCiclo.value || '',
        finCiclo: campoFinCiclo.value || '',
        trimestres,
      };
      btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';
      try {
        await guardarGrupo(grupo);
        overlay.remove();
      } catch (err) {
        mensaje.textContent = `No se pudo guardar: ${err.message}`;
        btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar';
      }
    };

    overlay.appendChild(el('div', { class: 'panel modal-calendario' }, [
      el('h2', {}, 'Calendario del curso'),
      el('p', { class: 'etiqueta-chica' }, 'Opcional — solo se usa para dividir el pase de lista exportado a Excel en una tabla general y una tabla por trimestre.'),
      el('label', {}, 'Días de clase'),
      filaDias,
      el('div', { class: 'rejilla-campos', style: 'margin-top:0.6rem;' }, [
        el('div', { class: 'campo' }, [el('label', {}, 'Inicio del ciclo'), campoInicioCiclo]),
        el('div', { class: 'campo' }, [el('label', {}, 'Fin del ciclo'), campoFinCiclo]),
      ]),
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
    el('p', { class: 'etiqueta-chica' }, soloLectura ? 'Solo lectura: no se puede editar la asistencia.' : 'Haz clic en una celda para marcar Presente → Falta → Justificada. El ícono 📝 agrega una nota para ese alumno ese día.'),
    leyenda,
    soloLectura ? null : el('div', { class: 'barra-nueva' }, [campoFecha, btnAgregarFecha, btnAgregarHoy, btnValores, btnCalendario]),
    contenedorTabla,
  ]));

  pintarTabla();
}
