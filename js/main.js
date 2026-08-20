import { el, clear, campoContrasena } from './dom.js';
import {
  observarSesion, iniciarSesion, cerrarSesion, cambiarContrasena, esRevisorOAdmin,
} from './auth.js';
import {
  listarExamenes, obtenerExamen, guardarExamen, eliminarExamen,
  obtenerConfig, guardarConfig, exportarExamenJSON, importarExamenJSON,
} from './store.js';
import {
  nuevoExamen, uid, ETIQUETAS_ESTADO, ETIQUETAS_ROL, ENCABEZADO_INGLES_DEFECTO,
} from './model.js';
import { montarEditor } from './editor.js';
import { montarPanelAdmin } from './admin.js';
import { redimensionarImagen } from './questionTypes.js';
import { montarListaGrupos, montarGrupo } from './grupos.js';
import { montarSoporte } from './soporte.js';

const vistaLogin = document.getElementById('vista-login');
const vistaLista = document.getElementById('vista-lista');
const vistaEditor = document.getElementById('vista-editor');
const vistaConfig = document.getElementById('vista-config');
const vistaAdmin = document.getElementById('vista-admin');
const vistaGrupos = document.getElementById('vista-grupos');
const vistaGrupo = document.getElementById('vista-grupo');
const infoSesion = document.getElementById('info-sesion');
const selectorModulo = document.getElementById('selector-modulo');
const btnModuloExamenes = document.getElementById('btn-modulo-examenes');
const btnModuloGrupos = document.getElementById('btn-modulo-grupos');
const todasLasVistas = [vistaLogin, vistaLista, vistaEditor, vistaConfig, vistaAdmin, vistaGrupos, vistaGrupo];

let sesion = null; // { uid, email, nombre, rol, activo } | null

function mostrarVista(vista) {
  todasLasVistas.forEach((v) => v.classList.toggle('oculto', v !== vista));
}

function marcarModuloActivo(modulo) {
  btnModuloExamenes.classList.toggle('activo', modulo === 'examenes');
  btnModuloGrupos.classList.toggle('activo', modulo === 'grupos');
}

// --- Sesión (barra superior) ---

function pintarInfoSesion() {
  clear(infoSesion);
  const sesionValida = sesion && sesion.rol && sesion.activo !== false;
  selectorModulo.classList.toggle('oculto', !sesionValida);
  if (!sesion) return;
  infoSesion.appendChild(el('span', { class: 'nombre-sesion' }, sesion.nombre || sesion.email));
  infoSesion.appendChild(el('span', { class: 'insignia-rol' }, ETIQUETAS_ROL[sesion.rol] || 'Sin rol'));
  if (sesion.rol === 'administrador') {
    infoSesion.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: irAAdmin }, 'Usuarios'));
  }
  infoSesion.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: abrirModalCambiarContrasena }, 'Cambiar contraseña'));
  infoSesion.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: () => cerrarSesion() }, 'Cerrar sesión'));
}

// --- Modal: cambiar contraseña (autoservicio, cualquier rol) ---

function abrirModalCambiarContrasena() {
  const overlay = el('div', { class: 'overlay-modal' });
  const { contenedor: campoNuevaCont, input: campoNueva } = campoContrasena({ placeholder: 'Mínimo 6 caracteres' });
  const { contenedor: campoConfirmarCont, input: campoConfirmar } = campoContrasena({ placeholder: 'Repite la contraseña' });
  const mensaje = el('p', { class: 'mensaje-login' });
  const btnGuardar = el('button', { type: 'button', class: 'btn-primario' }, 'Guardar');
  const btnCancelar = el('button', { type: 'button', class: 'btn-secundario', onclick: () => overlay.remove() }, 'Cancelar');

  btnGuardar.onclick = async () => {
    if (campoNueva.value.length < 6) { mensaje.className = 'mensaje-login'; mensaje.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
    if (campoNueva.value !== campoConfirmar.value) { mensaje.className = 'mensaje-login'; mensaje.textContent = 'Las contraseñas no coinciden.'; return; }
    btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…';
    try {
      await cambiarContrasena(campoNueva.value);
      mensaje.className = 'mensaje-login ok';
      mensaje.textContent = '✔ Contraseña actualizada.';
      setTimeout(() => overlay.remove(), 1200);
    } catch (err) {
      mensaje.className = 'mensaje-login';
      mensaje.textContent = `No se pudo cambiar: ${err.message}`;
      btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar';
    }
  };

  overlay.appendChild(el('div', { class: 'panel modal-cambiar-clave' }, [
    el('h2', {}, 'Cambiar contraseña'),
    el('div', { class: 'campo' }, [el('label', {}, 'Nueva contraseña'), campoNuevaCont]),
    el('div', { class: 'campo' }, [el('label', {}, 'Confirmar'), campoConfirmarCont]),
    el('div', { class: 'acciones-modal' }, [btnGuardar, btnCancelar]),
    mensaje,
  ]));
  document.body.appendChild(overlay);
}

// --- Login ---

function pintarLogin() {
  clear(vistaLogin);
  const campoEmail = el('input', { type: 'email', placeholder: 'correo@escuela.mx' });
  const { contenedor: campoPassCont, input: campoPass } = campoContrasena({ placeholder: 'Contraseña' });
  const mensaje = el('p', { class: 'mensaje-login' });
  const btn = el('button', { type: 'button', class: 'btn-primario' }, 'Entrar');

  async function intentar() {
    if (!campoEmail.value.trim() || !campoPass.value) {
      mensaje.textContent = 'Escribe tu correo y contraseña.';
      return;
    }
    btn.disabled = true; btn.textContent = 'Entrando…'; mensaje.textContent = '';
    try {
      await iniciarSesion(campoEmail.value.trim(), campoPass.value);
      // observarSesion se encarga de redibujar la app cuando el login se confirme.
    } catch (err) {
      mensaje.textContent = 'No se pudo iniciar sesión: revisa tu correo y contraseña.';
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  }

  btn.onclick = intentar;
  campoPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') intentar(); });

  vistaLogin.appendChild(el('div', { class: 'pantalla-login' }, [
    el('div', { class: 'panel panel-login' }, [
      el('h2', {}, '📋 Panel de control CCUMA'),
      el('div', { class: 'campo' }, [el('label', {}, 'Correo'), campoEmail]),
      el('div', { class: 'campo' }, [el('label', {}, 'Contraseña'), campoPassCont]),
      btn,
      mensaje,
    ]),
  ]));
}

function pintarSinAcceso() {
  clear(vistaLogin);
  vistaLogin.appendChild(el('div', { class: 'pantalla-login' }, [
    el('div', { class: 'panel panel-login' }, [
      el('h2', {}, 'Tu cuenta no tiene acceso'),
      el('p', {}, 'Inicia sesión pero no encontramos un rol asignado (o está desactivada). Pide a un administrador que revise tu cuenta.'),
      el('button', { type: 'button', class: 'btn-secundario', onclick: () => cerrarSesion() }, 'Cerrar sesión'),
    ]),
  ]));
}

// --- Navegación ---
//
// location.hash es la única fuente de verdad de "qué se ve". Las funciones ir*() solo
// cambian el hash; quien de verdad dibuja la vista es manejarHash() (disparado por el
// evento hashchange). Si no cambia el hash (ya estamos ahí), hashchange no se dispara,
// así que se llama a manejarHash() a mano. Esto evita el bug de doble-render que había
// antes: cambiar el hash Y dibujar de una vez, más el hashchange disparando otra vez.

function cambiarRuta(hash) {
  if (location.hash === hash) manejarHash();
  else location.hash = hash;
}

function irALista() { cambiarRuta(''); }
function irAEditor(examenId) { cambiarRuta(`#examen/${examenId}`); }
function irAAdmin() { cambiarRuta('#usuarios'); }
function irAGrupos() { cambiarRuta('#grupos'); }
function irAGrupo(grupoId) { cambiarRuta(`#grupo/${grupoId}`); }

btnModuloExamenes.onclick = irALista;
btnModuloGrupos.onclick = irAGrupos;

async function renderLista() {
  marcarModuloActivo('examenes');
  mostrarVista(vistaLista);
  pintarLista();
}

async function renderEditor(examenId) {
  marcarModuloActivo('examenes');
  const examen = await obtenerExamen(examenId);
  if (!examen) { irALista(); return; }
  montarEditor(vistaEditor, examen, { sesion, onVolver: irALista });
  mostrarVista(vistaEditor);
}

function renderAdmin() {
  marcarModuloActivo('examenes');
  mostrarVista(vistaAdmin);
  montarPanelAdmin(vistaAdmin, { onVolver: irALista });
}

function renderGrupos() {
  marcarModuloActivo('grupos');
  mostrarVista(vistaGrupos);
  montarListaGrupos(vistaGrupos, sesion, { onAbrirGrupo: irAGrupo });
}

function renderGrupo(grupoId) {
  marcarModuloActivo('grupos');
  mostrarVista(vistaGrupo);
  montarGrupo(vistaGrupo, grupoId, sesion, { onVolver: irAGrupos });
}

// --- Lista de exámenes ---

function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

let filtroEstado = 'todos';

async function pintarLista() {
  clear(vistaLista);

  const puedeVerTodos = esRevisorOAdmin(sesion);

  const controles = [
    el('button', {
      type: 'button', class: 'btn-primario',
      onclick: async () => {
        const examen = nuevoExamen(sesion);
        await guardarExamen(examen);
        irAEditor(examen.id);
      },
    }, '+ Nuevo examen'),
    el('button', {
      type: 'button', class: 'btn-primario',
      title: 'Examen con el membrete oficial y formato usados para las materias de inglés',
      onclick: async () => {
        const examen = nuevoExamen(sesion, 'ingles');
        await guardarExamen(examen);
        irAEditor(examen.id);
      },
    }, '+ Nuevo examen inglés'),
  ];
  if (sesion.rol === 'administrador') {
    controles.push(el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: () => { mostrarVista(vistaConfig); pintarConfig(irALista); },
    }, '⚙ Datos de la escuela'));
  }
  controles.push(el('label', { class: 'btn-secundario', style: 'display:inline-block;' }, [
    '⬆ Importar respaldo (.json)',
    el('input', {
      type: 'file', accept: 'application/json', style: 'display:none;',
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const examen = await importarExamenJSON(file);
          examen.id = uid('exam');
          examen.profesorId = sesion.uid;
          examen.profesorNombre = sesion.nombre;
          examen.estado = 'borrador';
          examen.revisadoPor = null;
          examen.revisadoEn = null;
          await guardarExamen(examen);
          irAEditor(examen.id);
        } catch (err) {
          alert('No se pudo importar el archivo: ' + err.message);
        }
        e.target.value = '';
      },
    }),
  ]));

  if (puedeVerTodos) {
    const selector = el('select', {
      onchange: (e) => { filtroEstado = e.target.value; pintarLista(); },
    }, [
      el('option', { value: 'todos', selected: filtroEstado === 'todos' }, 'Todos los estados'),
      ...Object.entries(ETIQUETAS_ESTADO).map(([valor, etiqueta]) => el('option', { value: valor, selected: filtroEstado === valor }, etiqueta)),
    ]);
    controles.push(selector);
  }

  vistaLista.appendChild(el('div', { class: 'barra-nueva' }, controles));

  const cargando = el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'Cargando exámenes…');
  vistaLista.appendChild(cargando);

  let examenes;
  try {
    examenes = await listarExamenes(sesion);
  } catch (err) {
    cargando.textContent = `No se pudieron cargar los exámenes: ${err.message}`;
    return;
  }
  cargando.remove();

  if (puedeVerTodos && filtroEstado !== 'todos') {
    examenes = examenes.filter((ex) => ex.estado === filtroEstado);
  }

  if (examenes.length === 0) {
    vistaLista.appendChild(el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'No hay exámenes que mostrar aquí todavía.'));
    return;
  }

  vistaLista.appendChild(el('div', { class: 'lista-examenes' }, examenes.map((examen) => el('div', { class: 'tarjeta-examen' }, [
    el('h3', {}, [
      `${examen.meta.materia || 'Sin materia'} `,
      el('span', { class: 'etiqueta-tipo-examen' }, `Tipo ${examen.tipoExamen}`),
      examen.formato === 'ingles' ? el('span', { class: 'etiqueta-tipo-examen' }, 'Inglés') : null,
    ]),
    el('div', { class: 'meta-chica' }, [
      `${examen.meta.grado || '—'}${examen.meta.grupo || ''} · ${examen.meta.trimestre || 'sin trimestre'} · editado ${fechaCorta(examen.updatedAt)}`,
      puedeVerTodos ? el('br') : null,
      puedeVerTodos ? `Profesor(a): ${examen.profesorNombre || '—'}` : null,
    ]),
    el('div', { class: `insignia-estado insignia-${examen.estado || 'borrador'}` }, ETIQUETAS_ESTADO[examen.estado] || 'Borrador'),
    el('div', { class: 'acciones-tarjeta' }, [
      el('button', { type: 'button', class: 'btn-primario', onclick: () => irAEditor(examen.id) }, 'Abrir'),
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: async () => {
          const copia = JSON.parse(JSON.stringify(examen));
          copia.id = uid('exam');
          copia.tipoExamen = 'B';
          copia.duplicadoDeId = examen.id;
          copia.revisadoDistinto = false;
          copia.estado = 'borrador';
          copia.revisadoPor = null;
          copia.revisadoEn = null;
          copia.createdAt = new Date().toISOString();
          await guardarExamen(copia);
          irAEditor(copia.id);
        },
      }, 'Duplicar → Tipo B'),
      el('button', { type: 'button', class: 'btn-secundario', onclick: () => exportarExamenJSON(examen) }, 'Exportar'),
      el('button', {
        type: 'button', class: 'btn-peligro',
        onclick: async () => {
          if (confirm(`¿Eliminar el examen de "${examen.meta.materia || 'sin materia'}"? Esta acción no se puede deshacer.`)) {
            await eliminarExamen(examen.id);
            pintarLista();
          }
        },
      }, 'Eliminar'),
    ]),
  ]))));
}

// --- Configuración de escuela (solo administrador) ---

async function pintarConfig(onVolver) {
  clear(vistaConfig);
  const config = await obtenerConfig();

  let guardarConfigTimeout = null;
  function guardarConfigConDebounce() {
    clearTimeout(guardarConfigTimeout);
    guardarConfigTimeout = setTimeout(() => guardarConfig(config).catch(console.error), 400);
  }

  const previewLogo = el('div', { class: 'logo-config-preview' });
  function pintarPreviewLogo() {
    clear(previewLogo);
    if (config.logoDataUrl) previewLogo.appendChild(el('img', { src: config.logoDataUrl }));
  }
  pintarPreviewLogo();

  vistaConfig.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, '← Volver'));
  vistaConfig.appendChild(el('div', { class: 'pantalla-config' }, [
    el('div', { class: 'panel' }, [
      el('h2', {}, 'Datos de la escuela (se precargan en cada examen nuevo)'),
      el('div', { class: 'campo' }, [
        el('label', {}, 'Nombre de la escuela'),
        el('input', {
          type: 'text', value: config.nombreEscuela,
          oninput: (e) => { config.nombreEscuela = e.target.value; guardarConfigConDebounce(); },
        }),
      ]),
      el('div', { class: 'campo' }, [
        el('label', {}, 'Ciclo escolar'),
        el('input', {
          type: 'text', value: config.cicloEscolar, placeholder: 'Ej. 2026-2027',
          oninput: (e) => { config.cicloEscolar = e.target.value; guardarConfigConDebounce(); },
        }),
      ]),
      el('div', { class: 'campo' }, [
        el('label', {}, 'Logo de la escuela'),
        el('input', {
          type: 'file', accept: 'image/*',
          onchange: async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            config.logoDataUrl = await redimensionarImagen(file, 400);
            await guardarConfig(config);
            pintarPreviewLogo();
          },
        }),
        previewLogo,
      ]),
    ]),
    el('div', { class: 'panel' }, [
      el('h2', {}, 'Membrete de los exámenes de inglés'),
      el('p', { class: 'etiqueta-chica' }, 'Reemplaza el logo/nombre de la escuela cuando el examen se crea con el botón "+ Nuevo examen inglés". Una línea por renglón.'),
      el('div', { class: 'campo' }, [
        el('textarea', {
          rows: '7',
          oninput: (e) => { config.encabezadoIngles = e.target.value; guardarConfigConDebounce(); },
        }, config.encabezadoIngles || ENCABEZADO_INGLES_DEFECTO),
      ]),
    ]),
  ]));
}

// --- Enrutado simple por hash ---

async function manejarHash() {
  if (!sesion) { mostrarVista(vistaLogin); pintarLogin(); return; }
  if (!sesion.rol || sesion.activo === false) { mostrarVista(vistaLogin); pintarSinAcceso(); return; }

  const hash = location.hash.slice(1);
  if (hash.startsWith('examen/')) {
    await renderEditor(hash.slice('examen/'.length));
    return;
  }
  if (hash === 'usuarios' && sesion.rol === 'administrador') {
    renderAdmin();
    return;
  }
  if (hash === 'grupos') {
    renderGrupos();
    return;
  }
  if (hash.startsWith('grupo/')) {
    renderGrupo(hash.slice('grupo/'.length));
    return;
  }
  renderLista();
}

window.addEventListener('hashchange', manejarHash);

// Vive fuera de las vistas y no depende de la sesión: si alguien no puede ni
// entrar, ese es justo el momento en que más necesita el contacto de soporte.
montarSoporte();

observarSesion((nuevaSesion) => {
  sesion = nuevaSesion;
  pintarInfoSesion();
  manejarHash();
});
