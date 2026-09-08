// Lista de grupos del maestro y el "workspace" de un grupo (roster + pestañas
// Pase de lista / Rúbrica y calificaciones).

import { el, clear } from './dom.js';
import {
  listarGrupos, obtenerGrupo, guardarGrupo, eliminarGrupo,
} from './gruposStore.js';
import { nuevoGrupo, nuevoAlumno, usaPorcentaje } from './gruposModel.js';
import { montarListaAsistencia } from './listaAsistencia.js';
import { montarRubrica } from './rubrica.js';
import { montarEvaluacionesRubro } from './evaluacionesRubro.js';
import { exportarGrupoExcel } from './exportarExcel.js';
import { esRevisorOAdmin, rolesPorUsuario } from './auth.js';
import { coincideTexto, guardarFoco, restaurarFoco, campoBusqueda } from './filtros.js';

function fechaCorta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

let busquedaGrupo = '';
let filtroProfesorGrupo = 'todos';
// 'todos' | 'mios' | 'profesores'. Solo se muestra a revisor/administrador, que
// desde ahora llevan sus propios grupos además de ver los de toda la plantilla:
// sin esto, sus grupos quedaban perdidos entre los de la escuela entera.
let filtroAmbitoGrupo = 'todos';
// gruposCache guarda el último listarGrupos(): teclear en el buscador o
// cambiar un filtro solo re-filtra y repinta esta copia en memoria, sin
// volver a consultar Firestore en cada tecla (si no, el <input> se reemplaza
// por uno nuevo justo cuando el navegador está esperando la respuesta de red
// y pierde el foco — solo dejaba borrar de a un carácter).
let gruposCache = null;
// uid → rol, para distinguir "grupos de profesores" de los de otros revisores o
// administradores. Se guarda junto a gruposCache y por el mismo motivo: cambiar
// de filtro no debe disparar una consulta más.
let rolesCache = null;

// Ver el comentario junto a reiniciarFiltrosExamenes en main.js — mismo motivo.
export function reiniciarFiltrosGrupos() {
  busquedaGrupo = '';
  filtroProfesorGrupo = 'todos';
  filtroAmbitoGrupo = 'todos';
  gruposCache = null;
  rolesCache = null;
}

// Un grupo "de profesor" es el de alguien con rol maestro, no simplemente uno que
// no sea mío: revisores y administradores también tienen grupos propios y esos no
// son lo que se quiere revisar. Si el mapa de roles no se pudo cargar, se cae al
// criterio viejo ("no es mío") en vez de dejar el filtro vacío.
function esGrupoDeProfesor(grupo, sesion) {
  if (grupo.profesorId === sesion.uid) return false;
  if (!rolesCache) return true;
  return rolesCache.get(grupo.profesorId) === 'maestro';
}

export async function montarListaGrupos(contenedor, sesion, { onAbrirGrupo }) {
  clear(contenedor);
  // Revisor/administrador ven los grupos de toda la plantilla (con el nombre del
  // profesor en la tarjeta) y pueden corregirles el pase de lista, pero no editar
  // ni eliminar el grupo de nadie más. Crear los suyos sí: también dan clase.
  const veTodosLosGrupos = esRevisorOAdmin(sesion);

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

  const contenedorResultados = el('div', {});
  contenedor.appendChild(contenedorResultados);

  const cargando = el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'Cargando grupos…');
  contenedorResultados.appendChild(cargando);

  try {
    gruposCache = await listarGrupos(sesion);
  } catch (err) {
    cargando.textContent = `No se pudieron cargar los grupos: ${err.message}`;
    return;
  }
  // Solo hace falta para el filtro por ámbito, que solo ellos ven. Si falla, la
  // lista se pinta igual: esGrupoDeProfesor se degrada a "no es mío".
  if (veTodosLosGrupos && !rolesCache) {
    try {
      rolesCache = await rolesPorUsuario();
    } catch (err) {
      rolesCache = null;
    }
  }
  clear(contenedorResultados);
  renderizarResultadosGrupos(contenedor, contenedorResultados, sesion, { onAbrirGrupo }, veTodosLosGrupos);
}

function renderizarResultadosGrupos(contenedor, contenedorResultados, sesion, { onAbrirGrupo }, veTodosLosGrupos) {
  const foco = guardarFoco(contenedorResultados, '.campo-busqueda');
  clear(contenedorResultados);
  const repintar = () => renderizarResultadosGrupos(contenedor, contenedorResultados, sesion, { onAbrirGrupo }, veTodosLosGrupos);
  let grupos = gruposCache || [];

  // El ámbito se aplica ANTES de armar el resto de la barra: así el desplegable de
  // profesores solo ofrece a quienes de verdad quedan en la lista (en "Solo mis
  // grupos" no tiene sentido ofrecer a nadie más).
  if (veTodosLosGrupos && filtroAmbitoGrupo === 'mios') {
    grupos = grupos.filter((g) => g.profesorId === sesion.uid);
  } else if (veTodosLosGrupos && filtroAmbitoGrupo === 'profesores') {
    grupos = grupos.filter((g) => esGrupoDeProfesor(g, sesion));
  }

  const barraFiltros = el('div', { class: 'barra-filtros' }, [
    campoBusqueda({ placeholder: 'Buscar por nombre, materia o grado…', valor: busquedaGrupo, onCambio: (v) => { busquedaGrupo = v; repintar(); } }),
  ]);
  if (veTodosLosGrupos) {
    barraFiltros.appendChild(el('select', {
      title: 'Acota la lista a tus propios grupos o a los de los maestros.',
      onchange: (e) => {
        filtroAmbitoGrupo = e.target.value;
        // El profesor elegido casi nunca sobrevive al cambio de ámbito (en "Solo
        // mis grupos" no queda ninguno), y dejarlo puesto vaciaba la lista sin que
        // se viera por qué — se vuelve a "Todos los profesores".
        filtroProfesorGrupo = 'todos';
        repintar();
      },
    }, [
      el('option', { value: 'todos', selected: filtroAmbitoGrupo === 'todos' }, 'Todos los grupos'),
      el('option', { value: 'mios', selected: filtroAmbitoGrupo === 'mios' }, 'Solo mis grupos'),
      el('option', { value: 'profesores', selected: filtroAmbitoGrupo === 'profesores' }, 'Grupos de profesores'),
    ]));

    const profesores = [...new Set(grupos.map((g) => g.profesorNombre).filter(Boolean))].sort();
    barraFiltros.appendChild(el('select', {
      onchange: (e) => { filtroProfesorGrupo = e.target.value; repintar(); },
    }, [
      el('option', { value: 'todos', selected: filtroProfesorGrupo === 'todos' }, 'Todos los profesores'),
      ...profesores.map((p) => el('option', { value: p, selected: filtroProfesorGrupo === p }, p)),
    ]));
  }
  contenedorResultados.appendChild(barraFiltros);
  restaurarFoco(contenedorResultados, foco);

  if (veTodosLosGrupos && filtroProfesorGrupo !== 'todos') {
    grupos = grupos.filter((g) => g.profesorNombre === filtroProfesorGrupo);
  }
  if (busquedaGrupo) {
    grupos = grupos.filter((g) => coincideTexto(busquedaGrupo, g.nombre, g.materia, g.grado, g.grupo, g.profesorNombre));
  }

  if (grupos.length === 0) {
    contenedorResultados.appendChild(el('p', { style: 'color:#666; margin-top:1.5rem;' }, veTodosLosGrupos ? 'No hay grupos que coincidan con esos filtros.' : 'Aún no tienes grupos. Crea uno para empezar a tomar asistencia y llevar tu rúbrica de calificaciones.'));
    return;
  }

  contenedorResultados.appendChild(el('div', { class: 'lista-examenes' }, grupos.map((grupo) => {
    // Eliminar el grupo (y con él su pase de lista y sus calificaciones) sigue
    // siendo cosa del dueño, aunque un revisor pueda corregirle la asistencia.
    const esMio = grupo.profesorId === sesion.uid;
    return el('div', { class: 'tarjeta-examen' }, [
      el('h3', {}, grupo.nombre || 'Grupo sin nombre'),
      el('div', { class: 'meta-chica' }, `${grupo.materia || 'sin materia'} · ${grupo.grado || ''}${grupo.grupo || ''} · ${(grupo.alumnos || []).length} alumnos · editado ${fechaCorta(grupo.updatedAt)}`),
      veTodosLosGrupos && !esMio ? el('div', { class: 'meta-chica' }, `Profesor(a): ${grupo.profesorNombre || 'sin nombre'}`) : null,
      el('div', { class: 'acciones-tarjeta' }, [
        el('button', { type: 'button', class: 'btn-primario', onclick: () => onAbrirGrupo(grupo.id) }, 'Abrir'),
        esMio ? el('button', {
          type: 'button', class: 'btn-peligro',
          onclick: async () => {
            if (confirm(`¿Eliminar el grupo "${grupo.nombre || 'sin nombre'}"? Se perderá el pase de lista y las calificaciones. Esta acción no se puede deshacer.`)) {
              await eliminarGrupo(grupo.id);
              montarListaGrupos(contenedor, sesion, { onAbrirGrupo });
            }
          },
        }, 'Eliminar') : null,
      ]),
    ]);
  })));
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

  // Dos permisos distintos, no uno solo. Sobre el grupo de otro maestro, revisor y
  // administrador siguen sin poder tocar datos generales, roster, rúbrica ni
  // calificaciones (soloLectura) — pero sí corrigen el pase de lista: llega un
  // justificante a Coordinación, el maestro marcó la fila equivocada, faltó pasar
  // lista un día. Por eso la asistencia se pasa aparte: vive en asistencias/{id},
  // no en el documento del grupo, y firestore.rules abre justo esa colección.
  const soloLectura = esRevisorOAdmin(sesion) && grupo.profesorId !== sesion.uid;
  const puedeEditarAsistencia = !soloLectura || esRevisorOAdmin(sesion);

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
      // puedeEditarGrupo apaga "Valores de asistencia" y "Calendario del curso":
      // son los dos únicos botones del pase de lista que escriben el documento del
      // grupo, y los valores de asistencia además son un parámetro de evaluación.
      montarListaAsistencia(contenedorPestana, grupo, {
        soloLectura: !puedeEditarAsistencia,
        puedeEditarGrupo: !soloLectura,
      });
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

  // Escala de todo el grupo: base 10 (por defecto) o porcentaje. Vive en la barra
  // de pestañas, no dentro de una pestaña, porque afecta al pase de lista, a la
  // rúbrica, a la captura de evaluaciones y al Excel por igual. Solo cambia cómo
  // se ve y cómo se captura: lo guardado sigue siendo base 10 (ver gruposModel.js).
  const chkPorcentaje = el('input', {
    type: 'checkbox', checked: usaPorcentaje(grupo),
    onchange: (e) => {
      grupo.mostrarPorcentaje = e.target.checked;
      // Un revisor/administrador no puede escribir en el grupo de otro maestro:
      // para ellos el recuadro cambia la vista y el Excel de esta sesión, pero no
      // se guarda (si se intentara, Firestore rechazaría la escritura).
      if (!soloLectura) guardarConDebounce();
      pintarPestana();
    },
  });
  const recuadroPorcentaje = el('label', {
    class: 'chip-escala', style: 'margin-left:auto;',
    title: 'Muestra y captura las calificaciones de 0 a 100% en vez de 0 a 10. Se refleja igual en el Excel exportado.',
  }, [chkPorcentaje, 'Mostrar como porcentaje']);

  const btnExportarExcel = el('button', {
    type: 'button', class: 'btn-primario',
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
    contenedor.appendChild(el('p', { class: 'aviso-solo-lectura', style: 'margin-top:-0.4rem;' }, `Grupo de ${grupo.profesorNombre || 'otro profesor'}: puedes corregir el pase de lista, pero los datos del grupo, los alumnos, la rúbrica y las calificaciones son solo lectura.`));
  }
  contenedor.appendChild(panelDatos);
  contenedor.appendChild(panelAlumnos);
  contenedor.appendChild(el('div', { class: 'selector-pestanas' }, [btnTabLista, btnTabRubrica, recuadroPorcentaje, btnExportarExcel]));
  contenedor.appendChild(contenedorPestana);

  pintarPestana();
}
