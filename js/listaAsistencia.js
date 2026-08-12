// Pase de lista estilo Excel: alumnos en filas, fechas en columnas.

import { el, clear } from './dom.js';
import { listarAsistencias, obtenerOCrearAsistencia, guardarAsistencia } from './gruposStore.js';
import { ESTADOS_ASISTENCIA, ETIQUETAS_ESTADO_ASISTENCIA, fechaHoyISO, fechaCortaMX } from './gruposModel.js';

const SIGUIENTE_ESTADO = { null: 'presente', presente: 'falta', falta: 'retardo', retardo: 'justificada', justificada: null };
const INICIALES_ESTADO = { presente: 'P', falta: 'F', retardo: 'R', justificada: 'J' };

export async function montarListaAsistencia(contenedor, grupo) {
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

    const encabezado = el('tr', {}, [
      el('th', { class: 'celda-nombre-alumno' }, 'Alumno'),
      ...fechas.map((f) => el('th', { class: 'col-fecha' }, fechaCortaMX(f))),
      el('th', {}, 'Faltas'),
    ]);

    const filas = alumnosActivos.map((alumno) => {
      const celdas = fechas.map((f) => {
        const dia = porFecha.get(f);
        const reg = dia.registros[alumno.id] || { estado: null, nota: '' };
        const celda = el('td', { class: `celda-asistencia ${reg.estado ? `estado-${reg.estado}` : ''}` }, [
          el('button', {
            type: 'button', class: 'btn-celda-estado', title: ETIQUETAS_ESTADO_ASISTENCIA[reg.estado] || 'Sin marcar',
            onclick: async () => {
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
            type: 'button', class: `btn-nota-dia ${reg.nota ? 'tiene-nota' : ''}`, title: reg.nota ? `Nota: ${reg.nota}` : 'Agregar nota',
            onclick: async () => {
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
      return el('tr', {}, [
        el('td', { class: 'celda-nombre-alumno' }, alumno.nombre),
        ...celdas,
        el('td', { class: 'celda-totales' }, String(totales.falta || 0)),
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

  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'Pase de lista'),
    el('p', { class: 'etiqueta-chica' }, 'Haz clic en una celda para marcar Presente → Falta → Retardo → Justificada. El ícono 📝 agrega una nota para ese alumno ese día.'),
    el('div', { class: 'barra-nueva' }, [campoFecha, btnAgregarFecha]),
    contenedorTabla,
  ]));

  pintarTabla();
}
