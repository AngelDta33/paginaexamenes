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
import { esRevisorOAdmin } from './auth.js';

function fechaCorta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function montarListaGrupos(contenedor, sesion, { onAbrirGrupo }) {
  clear(contenedor);
  // Revisor/administrador solo consultan: ven los grupos de todos los maestros
  // (con el nombre del profesor en la tarjeta) pero no crean ni eliminan ninguno.
  const soloConsulta = esRevisorOAdmin(sesion);

  if (!soloConsulta) {
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
  }

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
    contenedor.appendChild(el('p', { style: 'color:#666; margin-top:1.5rem;' }, soloConsulta ? 'Todavía no hay grupos capturados.' : 'Aún no tienes grupos. Crea uno para empezar a tomar asistencia y llevar tu rúbrica de calificaciones.'));
    return;
  }

  contenedor.appendChild(el('div', { class: 'lista-examenes' }, grupos.map((grupo) => el('div', { class: 'tarjeta-examen' }, [
    el('h3', {}, grupo.nombre || 'Grupo sin nombre'),
    el('div', { class: 'meta-chica' }, `${grupo.materia || 'sin materia'} · ${grupo.grado || ''}${grupo.grupo || ''} · ${(grupo.alumnos || []).length} alumnos · editado ${fechaCorta(grupo.updatedAt)}`),
    soloConsulta ? el('div', { class: 'meta-chica' }, `Profesor(a): ${grupo.profesorNombre || 'sin nombre'}`) : null,
    el('div', { class: 'acciones-tarjeta' }, [
      el('button', { type: 'button', class: 'btn-primario', onclick: () => onAbrirGrupo(grupo.id) }, 'Abrir'),
      soloConsulta ? null : el('button', {
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

export async function montarGrupo(contenedor, grupoId, sesion, { onVolver }) {
  clear(contenedor);
  contenedor.appendChild(el('p', {}, 'Cargando grupo…'));

  const grupo = await obtenerGrupo(grupoId);
  if (!grupo) {
    clear(contenedor);
    contenedor.appendChild(el('p', {}, 'No se encontró el grupo.'));
    return;
  }

  // Solo el dueño del grupo puede editar; revisor/administrador pueden consultarlo
  // pero no cambiar nada (a menos que el grupo sea suyo, ej. un admin con su propio grupo).
  const soloLectura = esRevisorOAdmin(sesion) && grupo.profesorId !== sesion.uid;

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
  // Ya con nombre y materia capturados, este panel se colapsa por defecto: casi
  // siempre se abre el grupo para pasar lista o calificar, no para editar sus datos.
  const campoTexto = (etiqueta, valor, onInput) => el('div', { class: 'campo' }, [
    el('label', {}, etiqueta),
    el('input', {
      type: 'text', value: valor || '', disabled: soloLectura,
      oninput: (e) => { onInput(e.target.value); guardarConDebounce(); },
    }),
  ]);

  let datosColapsado = !!(grupo.nombre && grupo.materia);
  const cuerpoDatos = el('div', { class: 'rejilla-campos' }, [
    campoTexto('Nombre del grupo', grupo.nombre, (v) => { grupo.nombre = v; }),
    campoTexto('Materia', grupo.materia, (v) => { grupo.materia = v; }),
    campoTexto('Grado', grupo.grado, (v) => { grupo.grado = v; }),
    campoTexto('Grupo', grupo.grupo, (v) => { grupo.grupo = v; }),
    campoTexto('Ciclo escolar', grupo.cicloEscolar, (v) => { grupo.cicloEscolar = v; }),
  ]);
  const btnToggleDatos = el('button', {
    type: 'button', class: 'btn-icono', title: 'Mostrar/ocultar datos del grupo',
    onclick: () => { datosColapsado = !datosColapsado; actualizarColapsoDatos(); },
  }, '▾');
  function actualizarColapsoDatos() {
    cuerpoDatos.classList.toggle('oculto', datosColapsado);
    btnToggleDatos.textContent = datosColapsado ? '▸' : '▾';
  }
  const panelDatos = el('div', { class: 'panel' }, [
    el('h2', { style: 'display:flex; align-items:center; gap:0.3rem;' }, [btnToggleDatos, 'Datos del grupo ', estadoGuardado]),
    cuerpoDatos,
  ]);
  actualizarColapsoDatos();

  // --- Roster de alumnos ---
  const listaAlumnos = el('div', { class: 'lista-alumnos' });
  const contadorAlumnos = el('span', {}, `(${(grupo.alumnos || []).length})`);
  function pintarAlumnos() {
    clear(listaAlumnos);
    contadorAlumnos.textContent = `(${(grupo.alumnos || []).length})`;
    (grupo.alumnos || []).forEach((alumno) => {
      listaAlumnos.appendChild(el('div', { class: 'fila-usuario' }, [
        el('div', { class: 'info-usuario' }, [el('strong', {}, alumno.nombre)]),
        el('span', { class: alumno.activo !== false ? 'estado-activo' : 'estado-inactivo' }, alumno.activo !== false ? 'Activo' : 'Inactivo'),
        soloLectura ? null : el('button', {
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

  // Igual que "Datos del grupo": si ya hay alumnos capturados, se colapsa por
  // defecto para no interponerse entre "Abrir grupo" y el pase de lista/rúbrica.
  let alumnosColapsado = (grupo.alumnos || []).length > 0;
  const cuerpoAlumnos = el('div', {}, [
    listaAlumnos,
    soloLectura ? null : el('div', { class: 'barra-nueva' }, [campoAlumno, btnAgregarAlumno]),
    soloLectura ? null : el('div', { class: 'campo', style: 'margin-top:0.6rem;' }, [campoPegado, btnAgregarPegado]),
  ]);
  const btnToggleAlumnos = el('button', {
    type: 'button', class: 'btn-icono', title: 'Mostrar/ocultar lista de alumnos',
    onclick: () => { alumnosColapsado = !alumnosColapsado; actualizarColapsoAlumnos(); },
  }, '▾');
  function actualizarColapsoAlumnos() {
    cuerpoAlumnos.classList.toggle('oculto', alumnosColapsado);
    btnToggleAlumnos.textContent = alumnosColapsado ? '▸' : '▾';
  }
  const panelAlumnos = el('div', { class: 'panel' }, [
    el('h2', { style: 'display:flex; align-items:center; gap:0.3rem;' }, [
      btnToggleAlumnos, 'Alumnos ', contadorAlumnos,
    ]),
    cuerpoAlumnos,
  ]);
  actualizarColapsoAlumnos();

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
      montarListaAsistencia(contenedorPestana, grupo, { soloLectura });
    } else if (pestanaActiva === 'evaluaciones') {
      montarEvaluacionesRubro(contenedorPestana, grupo, rubroDetalleId, {
        soloLectura,
        onVolver: () => { pestanaActiva = 'rubrica'; pintarPestana(); },
      });
    } else {
      montarRubrica(contenedorPestana, grupo, {
        soloLectura,
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

  contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, soloLectura ? '← Volver a la lista de grupos' : '← Volver a mis grupos'));
  if (soloLectura) {
    contenedor.appendChild(el('p', { class: 'aviso-solo-lectura', style: 'margin-top:-0.4rem;' }, `Consultando el grupo de ${grupo.profesorNombre || 'otro profesor'} — solo lectura, no se puede editar.`));
  }
  contenedor.appendChild(panelDatos);
  contenedor.appendChild(panelAlumnos);
  contenedor.appendChild(el('div', { class: 'selector-pestanas' }, [btnTabLista, btnTabRubrica, btnExportarExcel]));
  contenedor.appendChild(contenedorPestana);

  pintarPestana();
}
