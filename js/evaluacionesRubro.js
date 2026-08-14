// Detalle de un rubro: varias evaluaciones (ej. varios exámenes dentro del rubro
// "Examen"), cada una con su propio porcentaje y su calificación por alumno — igual
// que los rubros de la rúbrica general. El resultado alimenta automáticamente la
// celda de ese rubro en "Rúbrica y calificaciones", sin importar cómo se llame.

import { el, clear } from './dom.js';
import { guardarGrupo } from './gruposStore.js';
import {
  nuevaEvaluacion, calificacionAlumno, sumaPorcentajesEvaluaciones, validarEvaluaciones,
  notaDeEvaluacion, redistribuirPorcentajesEvaluaciones,
} from './gruposModel.js';

export function montarEvaluacionesRubro(contenedor, grupo, rubroId, { onVolver, soloLectura = false }) {
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
  const campoTotalAciertos = el('input', { type: 'number', min: '1', step: '1', placeholder: 'Ej. 20' });
  const btnAgregar = el('button', { type: 'button', class: 'btn-primario' }, `+ Agregar ${nombreRubro}`);

  // Actualiza el "= 8.5" que aparece junto a la casilla de aciertos, mostrando la
  // calificación en base 10 que se está calculando en vivo para ese alumno.
  function actualizarHintNota(ev, hint, cal) {
    const nota = notaDeEvaluacion(ev, cal.notasEvaluacion[ev.id]);
    hint.textContent = nota === null ? '' : `= ${nota.toFixed(1)}`;
  }

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

    // Ver rubrica.js: recalcular promedios en vivo sin reconstruir la tabla, para
    // que el input de porcentaje no pierda el foco entre teclas.
    const actualizadoresPromedio = [];
    // Referencia a cada <input> de porcentaje para poder actualizar el valor de las
    // OTRAS evaluaciones (las que se redistribuyen solas) sin reconstruir toda la
    // tabla — si no, se pierde el foco de la que el maestro está escribiendo.
    const inputsPorcentaje = new Map();

    function construirEncabezadoEvaluacion(ev) {
      const campoPorcentaje = el('input', {
        type: 'number', class: 'input-porcentaje-rubro', value: ev.porcentaje ?? 0, min: '0', max: '100', disabled: soloLectura,
        oninput: (e) => {
          ev.porcentaje = parseFloat(e.target.value) || 0;
          ev.porcentajeManual = true;
          redistribuirPorcentajesEvaluaciones(rubro);
          evaluaciones.forEach((otra) => {
            if (otra.id === ev.id) return;
            const otroInput = inputsPorcentaje.get(otra.id);
            if (otroInput) otroInput.value = otra.porcentaje;
          });
          pintarValidacion(); actualizadoresPromedio.forEach((fn) => fn()); guardarConDebounce();
        },
      });
      inputsPorcentaje.set(ev.id, campoPorcentaje);
      return el('th', { class: 'col-rubro' }, [
        el('div', {}, ev.nombre || 'Sin nombre'),
        ev.fecha ? el('div', { class: 'etiqueta-chica' }, ev.fecha) : null,
        el('div', { class: 'fila-porcentaje-rubro' }, [
          campoPorcentaje,
          '%',
          soloLectura ? null : el('button', {
            type: 'button', class: 'btn-icono btn-eliminar', title: `Eliminar ${ev.nombre || 'esta evaluación'}`,
            onclick: () => {
              rubro.evaluaciones = rubro.evaluaciones.filter((e2) => e2.id !== ev.id);
              for (const cal of Object.values(grupo.calificaciones)) {
                if (cal.notasEvaluacion) delete cal.notasEvaluacion[ev.id];
              }
              redistribuirPorcentajesEvaluaciones(rubro);
              pintarValidacion(); pintarTabla(); guardarConDebounce();
            },
          }, '✕'),
        ]),
        // Calificar por aciertos (opcional): si se pone un total, las casillas de
        // abajo piden aciertos y la calificación 0-10 se saca sola. Usa onchange
        // (al salir del campo) para no reconstruir la tabla en cada tecla.
        el('label', { class: 'fila-aciertos-rubro', title: 'Deja vacío para capturar la calificación 0-10 directamente' }, [
          '/ ',
          el('input', {
            type: 'number', class: 'input-total-aciertos', min: '1', step: '1',
            value: ev.totalAciertos ?? '', placeholder: '—', disabled: soloLectura,
            onchange: (e) => {
              const v = parseInt(e.target.value, 10);
              ev.totalAciertos = Number.isFinite(v) && v > 0 ? v : null;
              pintarTabla(); guardarConDebounce();
            },
          }),
          ' aciertos',
        ]),
      ]);
    }

    const encabezado = el('tr', {}, [
      el('th', { class: 'celda-nombre-alumno' }, 'Alumno'),
      ...evaluaciones.map((ev) => construirEncabezadoEvaluacion(ev)),
      el('th', {}, 'Promedio'),
    ]);

    const filas = alumnosActivos.map((alumno) => {
      const cal = asegurarCalificacion(alumno.id);
      const celdaPromedio = el('td', { class: 'celda-promedio' });
      function actualizarPromedio() {
        let suma = 0;
        let porcentajeCapturado = 0;
        for (const ev of evaluaciones) {
          const nota = notaDeEvaluacion(ev, cal.notasEvaluacion[ev.id]);
          if (nota === null) continue;
          suma += nota * (Number(ev.porcentaje) || 0) / 100;
          porcentajeCapturado += Number(ev.porcentaje) || 0;
        }
        celdaPromedio.textContent = porcentajeCapturado === 0 ? '—' : suma.toFixed(2);
      }
      actualizarPromedio();
      actualizadoresPromedio.push(actualizarPromedio);

      const celdas = evaluaciones.map((ev) => {
        const total = Number(ev.totalAciertos) || 0;
        const hint = total > 0 ? el('span', { class: 'hint-nota-aciertos' }) : null;
        const input = el('input', {
          type: 'number', class: 'input-calificacion',
          min: '0', max: total > 0 ? String(total) : '10', step: total > 0 ? '1' : '0.1',
          disabled: soloLectura,
          value: cal.notasEvaluacion[ev.id] ?? '',
          title: total > 0 ? `Escribe los aciertos (de ${total}); la calificación se calcula sola.` : 'Calificación 0-10',
          oninput: (e) => {
            cal.notasEvaluacion[ev.id] = e.target.value === '' ? null : parseFloat(e.target.value);
            if (hint) actualizarHintNota(ev, hint, cal);
            actualizarPromedio();
            guardarConDebounce();
          },
        });
        if (hint) actualizarHintNota(ev, hint, cal);
        return el('td', { class: total > 0 ? 'celda-aciertos' : '' }, [input, hint]);
      });

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
    rubro.evaluaciones.push(nuevaEvaluacion(campoNombre.value.trim(), campoDescripcion.value.trim(), campoFecha.value, campoTotalAciertos.value));
    redistribuirPorcentajesEvaluaciones(rubro);
    campoNombre.value = '';
    campoDescripcion.value = '';
    campoFecha.value = '';
    campoTotalAciertos.value = '';
    pintarValidacion();
    pintarTabla();
    guardarConDebounce();
  };

  contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, '← Volver a la rúbrica'));
  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, [`${nombreRubro} `, estadoGuardado]),
    el('p', { class: 'etiqueta-chica' }, soloLectura ? 'Solo lectura: no se puede editar esta captura.' : `Cada "${nombreRubro}" que agregues aquí (por ejemplo, cada examen) es una captura distinta, con su propio porcentaje — igual que los rubros de la rúbrica. El resultado alimenta sola la calificación de este rubro en "Rúbrica y calificaciones"; ya no se captura nada allá para "${nombreRubro}". Si pones un "total de aciertos", captura los aciertos de cada alumno y la calificación en base 10 se calcula sola.`),
    soloLectura ? null : el('div', { class: 'rejilla-campos' }, [
      el('div', { class: 'campo' }, [el('label', {}, 'Nombre'), campoNombre]),
      el('div', { class: 'campo' }, [el('label', {}, 'Descripción (opcional)'), campoDescripcion]),
      el('div', { class: 'campo' }, [el('label', {}, 'Fecha (opcional)'), campoFecha]),
      el('div', { class: 'campo' }, [el('label', {}, 'Total de aciertos (opcional)'), campoTotalAciertos]),
    ]),
    soloLectura ? null : btnAgregar,
    barraValidacion,
    contenedorTabla,
  ]));

  pintarValidacion();
  pintarTabla();
}
