// Lista de grupos del maestro y el "workspace" de un grupo (roster + pestañas
// Pase de lista / Rúbrica y calificaciones).

import { el, clear } from './dom.js';
import {
  listarGrupos, obtenerGrupo, guardarGrupo, eliminarGrupo,
} from './gruposStore.js';
import { nuevoGrupo, nuevoAlumno } from './gruposModel.js';
import { montarListaAsistencia } from './listaAsistencia.js';
import { montarRubrica } from './rubrica.js';
import { montarEvaluacionesRubro } from './evaluacionesRubro.js';
import { exportarGrupoExcel } from './exportarExcel.js';

function fechaCorta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function montarListaGrupos(contenedor, sesion, { onAbrirGrupo }) {
  clear(contenedor);
  contenedor.appendChild(el('div', { class: 'barra-nueva' }, [
    el('button', {
      type: 'button', class: 'btn-primario',
      onclick: async () => {
        const grupo = nuevoGrupo(sesion);
        await guardarGrupo(grupo);
        onAbrirGrupo(grupo.id);
      },
    }, '+ Nuevo grupo'),
  ]));

  const cargando = el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'Cargando grupos…');
  contenedor.appendChild(cargando);

  let grupos;
  try {
    grupos = await listarGrupos(sesion);
  } catch (err) {
    cargando.textContent = `No se pudieron cargar los grupos: ${err.message}`;
    return;
  }
  cargando.remove();

  if (grupos.length === 0) {
    contenedor.appendChild(el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'Aún no tienes grupos. Crea uno para empezar a tomar asistencia y llevar tu rúbrica de calificaciones.'));
    return;
  }

  contenedor.appendChild(el('div', { class: 'lista-examenes' }, grupos.map((grupo) => el('div', { class: 'tarjeta-examen' }, [
    el('h3', {}, grupo.nombre || 'Grupo sin nombre'),
    el('div', { class: 'meta-chica' }, `${grupo.materia || 'sin materia'} · ${grupo.grado || ''}${grupo.grupo || ''} · ${(grupo.alumnos || []).length} alumnos · editado ${fechaCorta(grupo.updatedAt)}`),
    el('div', { class: 'acciones-tarjeta' }, [
      el('button', { type: 'button', class: 'btn-primario', onclick: () => onAbrirGrupo(grupo.id) }, 'Abrir'),
      el('button', {
        type: 'button', class: 'btn-peligro',
        onclick: async () => {
          if (confirm(`¿Eliminar el grupo "${grupo.nombre || 'sin nombre'}"? Se perderá el pase de lista y las calificaciones. Esta acción no se puede deshacer.`)) {
            await eliminarGrupo(grupo.id);
            montarListaGrupos(contenedor, sesion, { onAbrirGrupo });
          }
        },
      }, 'Eliminar'),
    ]),
  ]))));
}

export async function montarGrupo(contenedor, grupoId, { onVolver }) {
  clear(contenedor);
  contenedor.appendChild(el('p', {}, 'Cargando grupo…'));

  const grupo = await obtenerGrupo(grupoId);
  if (!grupo) {
    clear(contenedor);
    contenedor.appendChild(el('p', {}, 'No se encontró el grupo.'));
    return;
  }

  clear(contenedor);
  let pestanaActiva = 'lista'; // 'lista' | 'rubrica' | 'evaluaciones'
  let rubroDetalleId = null;
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

  // --- Datos generales del grupo ---
  const campoTexto = (etiqueta, valor, onInput) => el('div', { class: 'campo' }, [
    el('label', {}, etiqueta),
    el('input', { type: 'text', value: valor || '', oninput: (e) => { onInput(e.target.value); guardarConDebounce(); } }),
  ]);

  const panelDatos = el('div', { class: 'panel' }, [
    el('h2', {}, ['Datos del grupo ', estadoGuardado]),
    el('div', { class: 'rejilla-campos' }, [
      campoTexto('Nombre del grupo', grupo.nombre, (v) => { grupo.nombre = v; }),
      campoTexto('Materia', grupo.materia, (v) => { grupo.materia = v; }),
      campoTexto('Grado', grupo.grado, (v) => { grupo.grado = v; }),
      campoTexto('Grupo', grupo.grupo, (v) => { grupo.grupo = v; }),
      campoTexto('Ciclo escolar', grupo.cicloEscolar, (v) => { grupo.cicloEscolar = v; }),
    ]),
  ]);

  // --- Roster de alumnos ---
  const listaAlumnos = el('div', { class: 'lista-alumnos' });
  function pintarAlumnos() {
    clear(listaAlumnos);
    (grupo.alumnos || []).forEach((alumno) => {
      listaAlumnos.appendChild(el('div', { class: 'fila-usuario' }, [
        el('div', { class: 'info-usuario' }, [el('strong', {}, alumno.nombre)]),
        el('span', { class: alumno.activo !== false ? 'estado-activo' : 'estado-inactivo' }, alumno.activo !== false ? 'Activo' : 'Inactivo'),
        el('button', {
          type: 'button', class: 'btn-secundario',
          onclick: () => { alumno.activo = alumno.activo === false; pintarAlumnos(); pintarPestana(); guardarConDebounce(); },
        }, alumno.activo !== false ? 'Desactivar' : 'Activar'),
      ]));
    });
  }
  pintarAlumnos();

  const campoAlumno = el('input', { type: 'text', placeholder: 'Nombre del alumno' });
  const btnAgregarAlumno = el('button', {
    type: 'button', class: 'btn-secundario',
    onclick: () => {
      if (!campoAlumno.value.trim()) return;
      grupo.alumnos.push(nuevoAlumno(campoAlumno.value));
      campoAlumno.value = '';
      pintarAlumnos(); pintarPestana(); guardarConDebounce();
    },
  }, '+ Agregar alumno');

  const campoPegado = el('textarea', { rows: '3', placeholder: 'O pega aquí una lista de nombres, uno por línea…' });
  const btnAgregarPegado = el('button', {
    type: 'button', class: 'btn-secundario',
    onclick: () => {
      const nombres = campoPegado.value.split('\n').map((n) => n.trim()).filter(Boolean);
      nombres.forEach((n) => grupo.alumnos.push(nuevoAlumno(n)));
      campoPegado.value = '';
      pintarAlumnos(); pintarPestana(); guardarConDebounce();
    },
  }, '+ Agregar todos');

  const panelAlumnos = el('div', { class: 'panel' }, [
    el('h2', {}, 'Alumnos'),
    listaAlumnos,
    el('div', { class: 'barra-nueva' }, [campoAlumno, btnAgregarAlumno]),
    el('div', { class: 'campo', style: 'margin-top:0.6rem;' }, [campoPegado, btnAgregarPegado]),
  ]);

  // --- Pestañas ---
  const contenedorPestana = el('div', {});
  const btnTabLista = el('button', { type: 'button', class: 'btn-secundario' }, '🗓 Pase de lista');
  const btnTabRubrica = el('button', { type: 'button', class: 'btn-secundario' }, '📊 Rúbrica y calificaciones');

  function actualizarBotonesTab() {
    btnTabLista.style.fontWeight = pestanaActiva === 'lista' ? 'bold' : 'normal';
    btnTabRubrica.style.fontWeight = pestanaActiva === 'rubrica' || pestanaActiva === 'evaluaciones' ? 'bold' : 'normal';
  }
  function pintarPestana() {
    actualizarBotonesTab();
    if (pestanaActiva === 'lista') {
      montarListaAsistencia(contenedorPestana, grupo);
    } else if (pestanaActiva === 'evaluaciones') {
      montarEvaluacionesRubro(contenedorPestana, grupo, rubroDetalleId, {
        onVolver: () => { pestanaActiva = 'rubrica'; pintarPestana(); },
      });
    } else {
      montarRubrica(contenedorPestana, grupo, {
        onAbrirEvaluaciones: (rubroId) => { pestanaActiva = 'evaluaciones'; rubroDetalleId = rubroId; pintarPestana(); },
      });
    }
  }
  btnTabLista.onclick = () => { pestanaActiva = 'lista'; pintarPestana(); };
  btnTabRubrica.onclick = () => { pestanaActiva = 'rubrica'; pintarPestana(); };

  const btnExportarExcel = el('button', {
    type: 'button', class: 'btn-primario', style: 'margin-left:auto;',
    onclick: async () => {
      btnExportarExcel.disabled = true; btnExportarExcel.textContent = 'Generando…';
      try {
        await exportarGrupoExcel(grupo);
      } catch (err) {
        alert(`No se pudo exportar: ${err.message}`);
      } finally {
        btnExportarExcel.disabled = false; btnExportarExcel.textContent = '⬇ Exportar a Excel';
      }
    },
  }, '⬇ Exportar a Excel');

  contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, '← Volver a mis grupos'));
  contenedor.appendChild(panelDatos);
  contenedor.appendChild(panelAlumnos);
  contenedor.appendChild(el('div', { class: 'selector-pestanas' }, [btnTabLista, btnTabRubrica, btnExportarExcel]));
  contenedor.appendChild(contenedorPestana);

  pintarPestana();
}
