// Rúbrica de evaluación estilo Excel: alumnos en filas, un rubro por columna,
// con porcentaje editable por columna, puntos extra y promedio calculado en vivo.
//
// Dos tipos de rubro se calculan solos (celda de solo lectura, con insignia "auto"):
// - Asistencia: a partir del pase de lista.
// - Cualquier rubro con evaluaciones (ej. varios exámenes dentro de "Examen"): el
//   botón con su nombre, arriba de "+ Agregar rubro", abre esa captura detallada.

import { el, clear } from './dom.js';
import { guardarGrupo, listarAsistencias } from './gruposStore.js';
import {
  nuevoRubro, nuevoRubroAsistencia, esRubroAsistencia, tieneEvaluaciones, calificacionAlumno,
  sumaPorcentajes, validarRubros, calcularPromedio, valorRubro,
} from './gruposModel.js';

export async function montarRubrica(contenedor, grupo, { onAbrirEvaluaciones } = {}) {
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

    const encabezado = el('tr', {}, [
      el('th', { class: 'celda-nombre-alumno' }, 'Alumno'),
      ...grupo.rubros.map((rubro) => {
        const esAuto = esRubroAsistencia(rubro) || tieneEvaluaciones(rubro);
        return el('th', { class: 'col-rubro' }, [
          esRubroAsistencia(rubro)
            ? el('div', { class: 'input-nombre-rubro' }, [rubro.nombre, el('span', { class: 'insignia-auto' }, 'auto')])
            : el('div', {}, [
              el('input', {
                type: 'text', class: 'input-nombre-rubro', value: rubro.nombre, placeholder: 'Nombre del rubro',
                oninput: (e) => { rubro.nombre = e.target.value; pintarBotonesRubro(); guardarConDebounce(); },
              }),
              esAuto ? el('span', { class: 'insignia-auto' }, 'auto') : null,
            ]),
          el('div', { class: 'fila-porcentaje-rubro' }, [
            el('input', {
              type: 'number', class: 'input-porcentaje-rubro', value: rubro.porcentaje, min: '0', max: '100',
              oninput: (e) => { rubro.porcentaje = parseFloat(e.target.value) || 0; pintarValidacion(); pintarTabla(); guardarConDebounce(); },
            }),
            '%',
            el('button', {
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
    ]);

    const filas = alumnosActivos.map((alumno) => {
      const cal = asegurarCalificacion(alumno.id);
      const celdaPromedio = el('td', { class: 'celda-promedio' });
      function actualizarPromedio() {
        const p = calcularPromedio(grupo, alumno.id, dias);
        celdaPromedio.textContent = p === null ? '—' : p.toFixed(2);
      }
      actualizarPromedio();

      const celdasRubro = grupo.rubros.map((rubro) => {
        if (esRubroAsistencia(rubro) || tieneEvaluaciones(rubro)) {
          const valor = valorRubro(grupo, rubro, alumno.id, dias);
          return el('td', { class: 'celda-asistencia-auto' }, valor === null ? '—' : valor.toFixed(1));
        }
        return el('td', {}, [
          el('input', {
            type: 'number', class: 'input-calificacion', min: '0', max: '10', step: '0.1',
            value: cal.valores[rubro.id] ?? '',
            oninput: (e) => {
              cal.valores[rubro.id] = e.target.value === '' ? null : parseFloat(e.target.value);
              actualizarPromedio();
              guardarConDebounce();
            },
          }),
        ]);
      });

      const celdaExtra = el('td', {}, [
        el('input', {
          type: 'number', class: 'input-calificacion', step: '0.1', value: cal.extra || 0,
          oninput: (e) => { cal.extra = parseFloat(e.target.value) || 0; actualizarPromedio(); guardarConDebounce(); },
        }),
      ]);

      return el('tr', {}, [
        el('td', { class: 'celda-nombre-alumno' }, alumno.nombre),
        ...celdasRubro,
        celdaExtra,
        celdaPromedio,
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

  const btnAgregarRubroAsistencia = el('button', {
    type: 'button', class: 'btn-secundario',
    onclick: () => {
      if ((grupo.rubros || []).some(esRubroAsistencia)) {
        alert('Ya tienes un rubro de asistencia en esta rúbrica.');
        return;
      }
      grupo.rubros.push(nuevoRubroAsistencia(0));
      pintarValidacion(); pintarBotonesRubro(); pintarTabla(); guardarConDebounce();
    },
  }, '+ Agregar rubro de asistencia');

  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, ['Rúbrica y calificaciones ', estadoGuardado]),
    el('p', { class: 'etiqueta-chica' }, 'Calificaciones en escala 0–10. Puedes agregar o quitar rubros y cambiar los porcentajes cuando quieras — el promedio se recalcula solo. Haz clic en el nombre de un rubro (abajo) para capturar varias evaluaciones dentro de él (ej. varios exámenes); su calificación se calcula sola, ya no se captura aquí.'),
    barraValidacion,
    contenedorBotonesRubro,
    el('div', { class: 'barra-nueva' }, [btnAgregarRubro, btnAgregarRubroAsistencia]),
    contenedorTabla,
  ]));

  pintarValidacion();
  pintarBotonesRubro();
  pintarTabla();
}
