// Detalle de un rubro: varias evaluaciones (ej. varios exámenes dentro del rubro
// "Examen"), cada una con su propio porcentaje y su calificación por alumno — igual
// que los rubros de la rúbrica general. El resultado alimenta automáticamente la
// celda de ese rubro en "Rúbrica y calificaciones", sin importar cómo se llame.

import { el, clear } from './dom.js';
import { guardarGrupo } from './gruposStore.js';
import {
  nuevaEvaluacion, calificacionAlumno, sumaPorcentajesEvaluaciones, validarEvaluaciones,
} from './gruposModel.js';

export function montarEvaluacionesRubro(contenedor, grupo, rubroId, { onVolver }) {
  clear(contenedor);
  const rubro = (grupo.rubros || []).find((r) => r.id === rubroId);
  if (!rubro) {
    contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver }, '← Volver a la rúbrica'));
    contenedor.appendChild(el('p', {}, 'No se encontró el rubro (puede que lo hayas eliminado).'));
    return;
  }

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

  const alumnosActivos = (grupo.alumnos || []).filter((a) => a.activo !== false);
  const nombreRubro = rubro.nombre || 'este rubro';

  const campoNombre = el('input', { type: 'text', placeholder: `Ej. "${nombreRubro} 1"` });
  const campoDescripcion = el('input', { type: 'text', placeholder: 'Descripción breve (opcional)' });
  const campoFecha = el('input', { type: 'date' });
  const btnAgregar = el('button', { type: 'button', class: 'btn-primario' }, `+ Agregar ${nombreRubro}`);

  const barraValidacion = el('div', { class: 'barra-validacion' });
  function pintarValidacion() {
    clear(barraValidacion);
    if (!(rubro.evaluaciones || []).length) { barraValidacion.className = 'barra-validacion oculto'; return; }
    const avisos = validarEvaluaciones(rubro);
    if (avisos.length === 0) {
      barraValidacion.className = 'barra-validacion ok';
      barraValidacion.appendChild(el('span', {}, `✔ Los porcentajes suman ${sumaPorcentajesEvaluaciones(rubro)}%.`));
    } else {
      barraValidacion.className = 'barra-validacion aviso';
      barraValidacion.appendChild(el('ul', {}, avisos.map((a) => el('li', {}, a.mensaje))));
    }
  }

  const contenedorTabla = el('div', { class: 'envoltura-tabla-excel' });

  function asegurarCalificacion(alumnoId) {
    if (!grupo.calificaciones[alumnoId]) grupo.calificaciones[alumnoId] = { valores: {}, extra: 0, notasEvaluacion: {} };
    const cal = grupo.calificaciones[alumnoId];
    if (!cal.notasEvaluacion) cal.notasEvaluacion = {};
    return cal;
  }

  function pintarTabla() {
    clear(contenedorTabla);
    const evaluaciones = rubro.evaluaciones || [];

    if (evaluaciones.length === 0) {
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio' }, `Agrega la primera "${nombreRubro}" arriba para empezar a capturar calificaciones.`));
      return;
    }
    if (alumnosActivos.length === 0) {
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio' }, 'Agrega alumnos al grupo para empezar a calificar.'));
      return;
    }

    const encabezado = el('tr', {}, [
      el('th', { class: 'celda-nombre-alumno' }, 'Alumno'),
      ...evaluaciones.map((ev) => el('th', { class: 'col-rubro' }, [
        el('div', {}, ev.nombre || 'Sin nombre'),
        ev.fecha ? el('div', { class: 'etiqueta-chica' }, ev.fecha) : null,
        el('div', { class: 'fila-porcentaje-rubro' }, [
          el('input', {
            type: 'number', class: 'input-porcentaje-rubro', value: ev.porcentaje ?? 0, min: '0', max: '100',
            oninput: (e) => { ev.porcentaje = parseFloat(e.target.value) || 0; pintarValidacion(); pintarTabla(); guardarConDebounce(); },
          }),
          '%',
          el('button', {
            type: 'button', class: 'btn-icono btn-eliminar', title: `Eliminar ${ev.nombre || 'esta evaluación'}`,
            onclick: () => {
              rubro.evaluaciones = rubro.evaluaciones.filter((e2) => e2.id !== ev.id);
              for (const cal of Object.values(grupo.calificaciones)) {
                if (cal.notasEvaluacion) delete cal.notasEvaluacion[ev.id];
              }
              pintarValidacion(); pintarTabla(); guardarConDebounce();
            },
          }, '✕'),
        ]),
      ])),
      el('th', {}, 'Promedio'),
    ]);

    const filas = alumnosActivos.map((alumno) => {
      const cal = asegurarCalificacion(alumno.id);
      const celdaPromedio = el('td', { class: 'celda-promedio' });
      function actualizarPromedio() {
        let suma = 0;
        let porcentajeCapturado = 0;
        for (const ev of evaluaciones) {
          const nota = cal.notasEvaluacion[ev.id];
          if (nota === null || nota === undefined || nota === '') continue;
          suma += Number(nota) * (Number(ev.porcentaje) || 0) / 100;
          porcentajeCapturado += Number(ev.porcentaje) || 0;
        }
        celdaPromedio.textContent = porcentajeCapturado === 0 ? '—' : suma.toFixed(2);
      }
      actualizarPromedio();

      const celdas = evaluaciones.map((ev) => el('td', {}, [
        el('input', {
          type: 'number', class: 'input-calificacion', min: '0', max: '10', step: '0.1',
          value: cal.notasEvaluacion[ev.id] ?? '',
          oninput: (e) => {
            cal.notasEvaluacion[ev.id] = e.target.value === '' ? null : parseFloat(e.target.value);
            actualizarPromedio();
            guardarConDebounce();
          },
        }),
      ]));

      return el('tr', {}, [
        el('td', { class: 'celda-nombre-alumno' }, alumno.nombre),
        ...celdas,
        celdaPromedio,
      ]);
    });

    contenedorTabla.appendChild(el('table', { class: 'tabla-excel' }, [
      el('thead', {}, [encabezado]),
      el('tbody', {}, filas),
    ]));
  }

  btnAgregar.onclick = () => {
    if (!campoNombre.value.trim()) { alert(`Ponle un nombre (ej. "${nombreRubro} 1").`); return; }
    rubro.evaluaciones = rubro.evaluaciones || [];
    rubro.evaluaciones.push(nuevaEvaluacion(campoNombre.value.trim(), campoDescripcion.value.trim(), campoFecha.value));
    campoNombre.value = '';
    campoDescripcion.value = '';
    campoFecha.value = '';
    pintarValidacion();
    pintarTabla();
    guardarConDebounce();
  };

  contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, '← Volver a la rúbrica'));
  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, [`${nombreRubro} `, estadoGuardado]),
    el('p', { class: 'etiqueta-chica' }, `Cada "${nombreRubro}" que agregues aquí (por ejemplo, cada examen) es una captura distinta, con su propio porcentaje — igual que los rubros de la rúbrica. El resultado alimenta sola la calificación de este rubro en "Rúbrica y calificaciones"; ya no se captura nada allá para "${nombreRubro}".`),
    el('div', { class: 'rejilla-campos' }, [
      el('div', { class: 'campo' }, [el('label', {}, 'Nombre'), campoNombre]),
      el('div', { class: 'campo' }, [el('label', {}, 'Descripción (opcional)'), campoDescripcion]),
      el('div', { class: 'campo' }, [el('label', {}, 'Fecha de aplicación'), campoFecha]),
    ]),
    btnAgregar,
    barraValidacion,
    contenedorTabla,
  ]));

  pintarValidacion();
  pintarTabla();
}
