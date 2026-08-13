// Pase de lista estilo Excel: alumnos en filas, fechas en columnas.

import { el, clear } from './dom.js';
import {
  listarAsistencias, obtenerOCrearAsistencia, guardarAsistencia, guardarGrupo,
} from './gruposStore.js';
import {
  ESTADOS_ASISTENCIA, ETIQUETAS_ESTADO_ASISTENCIA, INICIALES_ESTADO_ASISTENCIA, fechaHoyISO, fechaCortaMX,
  valoresAsistenciaDeGrupo, promedioAsistenciaAlumno,
} from './gruposModel.js';

const SIGUIENTE_ESTADO = { null: 'presente', presente: 'falta', falta: 'retardo', retardo: 'justificada', justificada: null };
const INICIALES_ESTADO = INICIALES_ESTADO_ASISTENCIA;

export async function montarListaAsistencia(contenedor, grupo, { soloLectura = false } = {}) {
  clear(contenedor);
  contenedor.appendChild(el('p', {}, 'Cargando pase de lista…'));

  const dias = await listarAsistencias(grupo.id); // [{grupoId, fecha, registros, updatedAt}]
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));

  clear(contenedor);

  const alumnosActivos = (grupo.alumnos || []).filter((a) => a.activo !== false);

  const campoFecha = el('input', { type: 'date', value: fechaHoyISO() });
  const btnAgregarFecha = el('button', { type: 'button', class: 'btn-primario' }, '+ Agregar fecha');

  const contenedorTabla = el('div', { class: 'envoltura-tabla-excel' });

  function alturaFila(alumno) {
    const totales = { presente: 0, falta: 0, retardo: 0, justificada: 0 };
    for (const dia of porFecha.values()) {
      const reg = dia.registros[alumno.id];
      if (reg && reg.estado) totales[reg.estado] = (totales[reg.estado] || 0) + 1;
    }
    return totales;
  }

  function pintarTabla() {
    clear(contenedorTabla);

    if (alumnosActivos.length === 0) {
      contenedorTabla.appendChild(el('p', { class: 'aviso-vacio' }, 'Agrega alumnos al grupo para empezar a tomar asistencia.'));
      return;
    }

    const fechas = Array.from(porFecha.keys()).sort();
    const diasArray = Array.from(porFecha.values());

    const encabezado = el('tr', {}, [
      el('th', { class: 'celda-nombre-alumno' }, 'Alumno'),
      ...fechas.map((f) => el('th', { class: 'col-fecha' }, fechaCortaMX(f))),
      el('th', {}, 'Faltas'),
      el('th', {}, 'Asistencia'),
    ]);

    const filas = alumnosActivos.map((alumno) => {
      const celdas = fechas.map((f) => {
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

    contenedorTabla.appendChild(el('table', { class: 'tabla-excel' }, [
      el('thead', {}, [encabezado]),
      el('tbody', {}, filas),
    ]));
  }

  btnAgregarFecha.onclick = async () => {
    const fecha = campoFecha.value || fechaHoyISO();
    if (!porFecha.has(fecha)) {
      try {
        const nueva = await obtenerOCrearAsistencia(grupo.id, fecha);
        porFecha.set(fecha, nueva);
      } catch (err) {
        alert(`No se pudo agregar la fecha: ${err.message}`);
        return;
      }
    }
    pintarTabla();
  };

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

  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'Pase de lista'),
    el('p', { class: 'etiqueta-chica' }, soloLectura ? 'Solo lectura: no se puede editar la asistencia.' : 'Haz clic en una celda para marcar Presente → Falta → Retardo → Justificada. El ícono 📝 agrega una nota para ese alumno ese día.'),
    leyenda,
    soloLectura ? null : el('div', { class: 'barra-nueva' }, [campoFecha, btnAgregarFecha, btnValores]),
    contenedorTabla,
  ]));

  pintarTabla();
}
