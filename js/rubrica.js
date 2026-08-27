// Rúbrica de evaluación estilo Excel: alumnos en filas, un rubro por columna,
// con porcentaje editable por columna, puntos extra y promedio calculado en vivo.
//
// Se calculan solos (celda de solo lectura, con insignia "auto"):
// - Cualquier rubro con evaluaciones (ej. varios exámenes dentro de "Examen"): el
//   botón con su nombre, arriba de "+ Agregar rubro", abre esa captura detallada.
// - El viejo rubro "Asistencia", en los grupos que todavía lo tengan: ya no se
//   puede agregar (lo reemplazó la columna informativa de pase de lista), pero se
//   sigue mostrando y contando para no alterar rúbricas ya armadas.

import { el, clear } from './dom.js';
import { guardarGrupo, listarAsistencias } from './gruposStore.js';
import {
  nuevoRubro, esRubroAsistencia, tieneEvaluaciones, calificacionAlumno,
  sumaPorcentajes, validarRubros, calcularPromedio, valorRubro, crearRubrosEstandar,
  usaPorcentaje, formatearNota, notaAEscala, escalaANota, atributosInputNota, calificacionFinal,
  columnasPaseDeLista, columnasPaseDeListaOcultas, trimestresConFechas, porcentajeAsistencia,
  umbralDerechoExamen,
} from './gruposModel.js';

export async function montarRubrica(contenedor, grupo, { onAbrirEvaluaciones, soloLectura = false } = {}) {
  clear(contenedor);
  contenedor.appendChild(el('p', {}, 'Cargando rúbrica…'));

  let dias = [];
  try {
    dias = await listarAsistencias(grupo.id);
  } catch (err) {
    // Si falla la carga de asistencia, la rúbrica sigue funcionando para los
    // rubros normales; el rubro de asistencia simplemente mostrará "—".
  }

  clear(contenedor);
  // Base 10 o porcentaje: solo cambia lo que se ve y lo que se captura, nunca lo
  // que se guarda (ver usaPorcentaje en gruposModel.js). El recuadro que lo
  // prende vive en la barra de pestañas del grupo y vuelve a montar esta vista.
  const escalaPorcentaje = usaPorcentaje(grupo);
  const attrsNota = atributosInputNota(escalaPorcentaje);
  let guardarTimeout = null;
  const estadoGuardado = el('span', { class: 'estado-guardado' });

  function guardarConDebounce() {
    clearTimeout(guardarTimeout);
    estadoGuardado.textContent = 'Guardando…';
    estadoGuardado.className = 'estado-guardado';
    guardarTimeout = setTimeout(() => {
      guardarGrupo(grupo)
        .then(() => { estadoGuardado.textContent = 'Guardado ✓'; estadoGuardado.className = 'estado-guardado ok'; })
        .catch((err) => { estadoGuardado.textContent = `No se pudo guardar: ${err.message}`; estadoGuardado.className = 'estado-guardado error'; });
    }, 400);
  }

  const barraValidacion = el('div', { class: 'barra-validacion' });
  function pintarValidacion() {
    clear(barraValidacion);
    const avisos = validarRubros(grupo);
    if (avisos.length === 0) {
      barraValidacion.className = 'barra-validacion ok';
      barraValidacion.appendChild(el('span', {}, `✔ Los porcentajes suman ${sumaPorcentajes(grupo)}%.`));
    } else {
      barraValidacion.className = 'barra-validacion aviso';
      barraValidacion.appendChild(el('ul', {}, avisos.map((a) => el('li', {}, a.mensaje))));
    }
  }

  const contenedorBotonesRubro = el('div', { class: 'barra-nueva' });
  function pintarBotonesRubro() {
    clear(contenedorBotonesRubro);
    (grupo.rubros || []).filter((r) => !esRubroAsistencia(r)).forEach((rubro) => {
      contenedorBotonesRubro.appendChild(el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => onAbrirEvaluaciones && onAbrirEvaluaciones(rubro.id),
      }, rubro.nombre || 'Rubro sin nombre'));
    });
  }

  const contenedorTabla = el('div', { class: 'envoltura-tabla-excel' });

  function asegurarCalificacion(alumnoId) {
    if (!grupo.calificaciones[alumnoId]) grupo.calificaciones[alumnoId] = { valores: {}, extra: 0, notasEvaluacion: {} };
    return grupo.calificaciones[alumnoId];
  }

  function esPaseDeListaPorTrimestre() {
    return grupo.columnaPaseDeLista === 'trimestral';
  }

  // La "✕" de una columna de pase de lista. Con la lista por trimestre esconde
  // SOLO ese trimestre —el maestro cierra el primero y quiere seguir viendo los
  // otros dos—; el pase de lista completo se quita nada más cuando ya no queda
  // ninguna columna a la vista (o cuando la lista es la del ciclo, que es una
  // sola columna). Volver a elegirla en "+ Agregar pase de lista" las regresa.
  function ocultarColumnaPase(columnaId) {
    if (!esPaseDeListaPorTrimestre()) {
      grupo.columnaPaseDeLista = null;
      grupo.paseDeListaOcultos = [];
    } else {
      const ocultas = [...columnasPaseDeListaOcultas(grupo), columnaId];
      grupo.paseDeListaOcultos = ocultas;
      if (columnasPaseDeLista(grupo, dias).length === 0) {
        grupo.columnaPaseDeLista = null;
        grupo.paseDeListaOcultos = [];
      }
    }
    pintarTabla(); guardarConDebounce();
  }

  function pintarTabla() {
    clear(contenedorTabla);
    const alumnosActivos = (grupo.alumnos || []).filter((a) => a.activo !== false);

    if ((grupo.rubros || []).length === 0) {
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio' }, 'Agrega al menos un rubro (por ejemplo "Examen 40%", "Tareas 30%"…) para empezar a calificar.'));
      return;
    }
    if (alumnosActivos.length === 0) {
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio' }, 'Agrega alumnos al grupo para empezar a calificar.'));
      return;
    }

    const columnasPase = columnasPaseDeLista(grupo, dias);
    const umbral = umbralDerechoExamen(grupo);

    // Recalcular el promedio de cada alumno sin reconstruir la tabla — así el
    // input de porcentaje no pierde el foco entre teclas (antes se llamaba a
    // pintarTabla() en cada oninput y solo se alcanzaba a escribir un dígito).
    const actualizadoresPromedio = [];

    const encabezado = el('tr', {}, [
      el('th', { class: 'celda-nombre-alumno' }, 'Alumno'),
      ...grupo.rubros.map((rubro) => {
        const esAuto = esRubroAsistencia(rubro) || tieneEvaluaciones(rubro);
        return el('th', { class: 'col-rubro' }, [
          esRubroAsistencia(rubro)
            ? el('div', { class: 'input-nombre-rubro' }, [rubro.nombre, el('span', { class: 'insignia-auto' }, 'auto')])
            : el('div', {}, [
              el('input', {
                type: 'text', class: 'input-nombre-rubro', value: rubro.nombre, placeholder: 'Nombre del rubro', disabled: soloLectura,
                oninput: (e) => { rubro.nombre = e.target.value; pintarBotonesRubro(); guardarConDebounce(); },
              }),
              esAuto ? el('span', { class: 'insignia-auto' }, 'auto') : null,
            ]),
          el('div', { class: 'fila-porcentaje-rubro' }, [
            el('input', {
              type: 'number', class: 'input-porcentaje-rubro', value: rubro.porcentaje, min: '0', max: '100', disabled: soloLectura,
              oninput: (e) => { rubro.porcentaje = parseFloat(e.target.value) || 0; pintarValidacion(); actualizadoresPromedio.forEach((fn) => fn()); guardarConDebounce(); },
            }),
            '%',
            soloLectura ? null : el('button', {
              type: 'button', class: 'btn-icono btn-eliminar', title: 'Eliminar rubro',
              onclick: () => {
                grupo.rubros = grupo.rubros.filter((r) => r.id !== rubro.id);
                for (const cal of Object.values(grupo.calificaciones)) {
                  delete cal.valores[rubro.id];
                  if (cal.notasEvaluacion) {
                    for (const ev of rubro.evaluaciones || []) delete cal.notasEvaluacion[ev.id];
                  }
                }
                pintarValidacion(); pintarBotonesRubro(); pintarTabla(); guardarConDebounce();
              },
            }, '✕'),
          ]),
        ]);
      }),
      el('th', {}, 'Extra'),
      el('th', {}, 'Promedio'),
      el('th', { class: 'col-calificacion-final', title: 'El promedio redondeado: de 6 en adelante el .5 sube (6.5 → 7), pero abajo de 6 siempre baja (5.9 → 5).' }, 'Calificación Final'),
      ...columnasPase.map((col) => el('th', { class: 'col-pase-lista' }, [
        el('div', {}, col.titulo),
        el('div', { class: 'fila-porcentaje-rubro' }, [
          el('span', { class: 'insignia-info' }, 'informativa'),
          soloLectura ? null : el('button', {
            type: 'button', class: 'btn-icono btn-eliminar',
            title: esPaseDeListaPorTrimestre()
              ? `Ocultar solo la columna "${col.titulo}" (las de los demás trimestres se quedan)`
              : 'Quitar el pase de lista de la rúbrica',
            onclick: () => { ocultarColumnaPase(col.id); },
          }, '✕'),
        ]),
      ])),
    ]);

    const filas = alumnosActivos.map((alumno) => {
      const cal = asegurarCalificacion(alumno.id);
      const celdaPromedio = el('td', { class: 'celda-promedio' });
      const celdaFinal = el('td', { class: 'celda-calificacion-final' });
      function actualizarPromedio() {
        const p = calcularPromedio(grupo, alumno.id, dias);
        celdaPromedio.textContent = formatearNota(p, escalaPorcentaje, 2);
        // El redondeo vive solo aquí: "Promedio" sigue mostrando la calificación
        // real para que el maestro vea de dónde salió la que va a boleta.
        celdaFinal.textContent = formatearNota(calificacionFinal(p), escalaPorcentaje, 0);
      }
      actualizarPromedio();
      actualizadoresPromedio.push(actualizarPromedio);

      const celdasRubro = grupo.rubros.map((rubro) => {
        if (esRubroAsistencia(rubro) || tieneEvaluaciones(rubro)) {
          const valor = valorRubro(grupo, rubro, alumno.id, dias);
          return el('td', { class: 'celda-asistencia-auto' }, formatearNota(valor, escalaPorcentaje, 1));
        }
        return el('td', {}, [
          el('input', {
            type: 'number', class: 'input-calificacion', min: '0', max: attrsNota.max, step: attrsNota.step, disabled: soloLectura,
            value: notaAEscala(cal.valores[rubro.id], escalaPorcentaje),
            oninput: (e) => {
              cal.valores[rubro.id] = escalaANota(e.target.value, escalaPorcentaje);
              actualizarPromedio();
              guardarConDebounce();
            },
          }),
        ]);
      });

      const celdaExtra = el('td', {}, [
        el('input', {
          type: 'number', class: 'input-calificacion', step: attrsNota.step,
          value: notaAEscala(cal.extra || 0, escalaPorcentaje), disabled: soloLectura,
          oninput: (e) => { cal.extra = escalaANota(e.target.value, escalaPorcentaje) || 0; actualizarPromedio(); guardarConDebounce(); },
        }),
      ]);

      // Siempre en porcentaje, aunque el grupo esté en base 10: lo que el maestro
      // compara aquí es contra el 80% de asistencia que da derecho a examen.
      const celdasPase = columnasPase.map((col) => {
        const pct = porcentajeAsistencia(grupo, alumno.id, col.dias);
        const cumple = pct !== null && pct >= umbral;
        return el('td', {
          class: `celda-pase-lista ${pct === null ? '' : (cumple ? 'con-derecho' : 'sin-derecho')}`,
          title: pct === null
            ? 'Sin días marcados en este periodo.'
            : `${cumple ? 'Cumple' : 'No cumple'} el ${umbral}% de asistencia para tener derecho a examen.`,
        }, pct === null ? '—' : `${pct.toFixed(0)}%`);
      });

      return el('tr', {}, [
        el('td', { class: 'celda-nombre-alumno' }, alumno.nombre),
        ...celdasRubro,
        celdaExtra,
        celdaPromedio,
        celdaFinal,
        ...celdasPase,
      ]);
    });

    contenedorTabla.appendChild(el('table', { class: 'tabla-excel' }, [
      el('thead', {}, [encabezado]),
      el('tbody', {}, filas),
    ]));
  }

  const btnAgregarRubro = el('button', {
    type: 'button', class: 'btn-primario',
    onclick: () => {
      grupo.rubros.push(nuevoRubro('', 0));
      pintarValidacion(); pintarBotonesRubro(); pintarTabla(); guardarConDebounce();
    },
  }, '+ Agregar rubro');

  // Columna(s) de pase de lista: no califican, solo dejan ver quién llega al 80%
  // de asistencia y tiene derecho a examen. El maestro elige si las quiere por
  // trimestre o una sola del ciclo completo.
  const btnPaseDeLista = el('button', {
    type: 'button', class: 'btn-secundario',
    onclick: () => abrirModalPaseDeLista(),
  }, '+ Agregar pase de lista');

  function abrirModalPaseDeLista() {
    const overlay = el('div', { class: 'overlay-modal tema-verde' });
    const mensaje = el('p', { class: 'mensaje-login' });

    function alPresionarTecla(e) { if (e.key === 'Escape') cerrar(); }
    function cerrar() {
      document.removeEventListener('keydown', alPresionarTecla);
      overlay.remove();
    }
    document.addEventListener('keydown', alPresionarTecla);

    function elegir(modo) {
      if (modo === 'trimestral' && trimestresConFechas(grupo).length === 0) {
        mensaje.textContent = 'Este grupo todavía no tiene trimestres con fechas. Captúralos en "Calendario del curso", dentro de la pestaña Pase de lista.';
        return;
      }
      grupo.columnaPaseDeLista = modo;
      grupo.paseDeListaOcultos = []; // vuelven a aparecer las columnas que se hayan escondido antes
      cerrar();
      pintarTabla();
      guardarConDebounce();
    }

    // Engranaje: el mínimo de asistencia que da derecho a examen es 80% en la
    // escuela, pero varía por materia, así que se puede ajustar por grupo. Va
    // plegado para no estorbarle a quien solo viene a elegir la lista.
    const campoUmbral = el('input', {
      type: 'number', min: '0', max: '100', step: '1', value: umbralDerechoExamen(grupo),
      oninput: (e) => {
        const n = parseFloat(e.target.value);
        if (!Number.isFinite(n) || n < 0 || n > 100) return; // se ignora hasta que sea válido
        grupo.umbralDerechoExamen = n;
        textoUmbral.textContent = textoAyudaUmbral();
        pintarTabla(); // recolorea las columnas al vuelo
        guardarConDebounce();
      },
    });
    const panelConfig = el('div', { class: 'config-pase-lista oculto' }, [
      el('div', { class: 'campo' }, [
        el('label', {}, 'Porcentaje mínimo necesario para examen'),
        el('div', { class: 'fila-umbral' }, [campoUmbral, el('span', {}, '%')]),
      ]),
      el('p', { class: 'etiqueta-chica' }, 'Se guarda en este grupo: cada materia puede pedir un porcentaje distinto. Las columnas de pase de lista se pintan en verde a partir de este valor y en rojo por debajo.'),
    ]);
    const btnConfig = el('button', {
      type: 'button', class: 'btn-icono btn-config-pase-lista', title: 'Configuración',
      onclick: () => {
        const oculto = panelConfig.classList.toggle('oculto');
        if (!oculto) campoUmbral.focus();
      },
    }, '⚙');

    const textoAyudaUmbral = () => `Agrega a la rúbrica el porcentaje de asistencia de cada alumno. No cuenta para el promedio ni para la calificación final: sirve para ver de un vistazo quién llega al ${umbralDerechoExamen(grupo)}% y tiene derecho a examen.`;
    const textoUmbral = el('p', { class: 'etiqueta-chica' }, textoAyudaUmbral());

    overlay.appendChild(el('div', { class: 'panel modal-pase-lista' }, [
      el('div', { class: 'titulo-modal-pase-lista' }, [
        el('h2', {}, 'Elige la lista que deseas importar'),
        btnConfig,
      ]),
      textoUmbral,
      panelConfig,
      el('div', { class: 'opciones-duplicar' }, [
        el('button', {
          type: 'button', class: 'opcion-duplicar opcion-pase-lista', onclick: () => elegir('trimestral'),
        }, [
          el('span', { class: 'etiqueta-opcion-duplicar' }, 'Trimestral'),
          el('span', { class: 'etiqueta-chica' }, 'Una columna por cada trimestre del calendario del curso, con la asistencia de ese periodo. Puedes esconder los trimestres uno por uno con su "✕"; volver a elegir esta opción los muestra todos otra vez.'),
        ]),
        el('button', {
          type: 'button', class: 'opcion-duplicar opcion-pase-lista', onclick: () => elegir('ciclo'),
        }, [
          el('span', { class: 'etiqueta-opcion-duplicar' }, 'Ciclo completo'),
          el('span', { class: 'etiqueta-chica' }, 'Una sola columna con la asistencia acumulada de todo el ciclo escolar.'),
        ]),
      ]),
      mensaje,
      el('div', { class: 'acciones-modal' }, [
        el('button', { type: 'button', class: 'btn-secundario', onclick: cerrar }, 'Cancelar'),
      ]),
    ]));
    document.body.appendChild(overlay);
  }

  // Genera de un golpe las 5 rúbricas estándar (Examen, Tareas, Actividades,
  // Proyectos, Participación). No duplica las que ya existan por nombre, así que
  // se puede usar aunque ya haya algún rubro capturado.
  const btnRubrosEstandar = el('button', {
    type: 'button', class: 'btn-secundario',
    onclick: () => {
      const existentes = new Set((grupo.rubros || []).map((r) => (r.nombre || '').trim().toLowerCase()));
      const nuevos = crearRubrosEstandar().filter((r) => !existentes.has(r.nombre.toLowerCase()));
      if (nuevos.length === 0) { alert('Ya tienes las 5 rúbricas estándar.'); return; }
      grupo.rubros.push(...nuevos);
      pintarValidacion(); pintarBotonesRubro(); pintarTabla(); guardarConDebounce();
    },
  }, '✨ Generar rúbricas estándar');

  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, ['Rúbrica y calificaciones ', estadoGuardado]),
    el('p', { class: 'etiqueta-chica' }, soloLectura
      ? `Solo lectura: no se puede editar la rúbrica ni las calificaciones. Escala: ${escalaPorcentaje ? '0 a 100%' : '0 a 10'}.`
      : `Calificaciones en escala ${escalaPorcentaje ? '0–100% (el recuadro "Mostrar como porcentaje" está activo)' : '0–10'}. Puedes agregar o quitar rubros y cambiar los porcentajes cuando quieras — el promedio se recalcula solo. Haz clic en el nombre de un rubro (abajo) para capturar varias evaluaciones dentro de él (ej. varios exámenes); su calificación se calcula sola, ya no se captura aquí. La columna "Calificación Final" es el promedio ya redondeado: el .5 sube solo a partir del 6 (6.5 → 7), abajo de 6 siempre baja (5.9 → 5).`),
    barraValidacion,
    contenedorBotonesRubro,
    soloLectura ? null : el('div', { class: 'barra-nueva' }, [btnRubrosEstandar, btnAgregarRubro, btnPaseDeLista]),
    contenedorTabla,
  ]));

  pintarValidacion();
  pintarBotonesRubro();
  pintarTabla();
}
