import { el, clear, campoContrasena } from './dom.js';
import {
  observarSesion, iniciarSesion, cerrarSesion, cambiarContrasena, esRevisorOAdmin, reintentarSesion,
} from './auth.js';
import {
  listarExamenes, obtenerExamen, guardarExamen, eliminarExamen,
  obtenerConfig, guardarConfig, exportarExamenJSON, importarExamenJSON,
} from './store.js';
import {
  nuevoExamen, uid, ETIQUETAS_ESTADO, ETIQUETAS_ROL,
  ENCABEZADO_INGLES_DEFECTO, ENCABEZADO_OFICIAL_DEFECTO, mezclarOrdenExamen,
  FAMILIAS_FUENTE, TAMANOS_FUENTE, AJUSTES_TEXTO_DOCUMENTO,
} from './model.js';
import { montarEditor } from './editor.js';
import { montarPanelAdmin } from './admin.js';
import { redimensionarImagen } from './questionTypes.js';
import { montarListaGrupos, montarGrupo, reiniciarFiltrosGrupos } from './grupos.js';
import { montarListaProgramas, montarEditorPrograma, reiniciarFiltrosProgramas } from './programas.js';
import { montarSoporte } from './soporte.js';
import {
  MARGEN_POR_DEFECTO_CM, INTERLINEADO_POR_DEFECTO, SANGRIA_POR_DEFECTO_CM, TAMANO_POR_DEFECTO_PT,
} from './paginate.js';
import { ETIQUETAS_TRIMESTRE } from './programasModel.js';
import { coincideTexto, guardarFoco, restaurarFoco, campoBusqueda } from './filtros.js';
import { listarCarpetas, guardarCarpeta, eliminarCarpeta } from './carpetasStore.js';
import { nuevaCarpeta } from './carpetasModel.js';

const vistaLogin = document.getElementById('vista-login');
const vistaLista = document.getElementById('vista-lista');
const vistaEditor = document.getElementById('vista-editor');
const vistaConfig = document.getElementById('vista-config');
const vistaAdmin = document.getElementById('vista-admin');
const vistaGrupos = document.getElementById('vista-grupos');
const vistaGrupo = document.getElementById('vista-grupo');
const vistaProgramas = document.getElementById('vista-programas');
const vistaPrograma = document.getElementById('vista-programa');
const infoSesion = document.getElementById('info-sesion');
const selectorModulo = document.getElementById('selector-modulo');
const btnModuloExamenes = document.getElementById('btn-modulo-examenes');
const btnModuloGrupos = document.getElementById('btn-modulo-grupos');
const btnModuloProgramas = document.getElementById('btn-modulo-programas');
const todasLasVistas = [
  vistaLogin, vistaLista, vistaEditor, vistaConfig, vistaAdmin, vistaGrupos, vistaGrupo, vistaProgramas, vistaPrograma,
];

let sesion = null; // { uid, email, nombre, rol, activo } | null
let huboSesionAntes = false; // distingue "primer disparo de observarSesion" de "alguien cerró sesión"

function mostrarVista(vista) {
  todasLasVistas.forEach((v) => v.classList.toggle('oculto', v !== vista));
}

function marcarModuloActivo(modulo) {
  btnModuloExamenes.classList.toggle('activo', modulo === 'examenes');
  btnModuloGrupos.classList.toggle('activo', modulo === 'grupos');
  btnModuloProgramas.classList.toggle('activo', modulo === 'programas');
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
    infoSesion.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: irAAdmin }, '🛠 Panel Administrador'));
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

// --- Modal: duplicar a Tipo B (elegir si se mezcla el orden de reactivos) ---

function abrirModalDuplicarTipoB(examen, onListo) {
  const overlay = el('div', { class: 'overlay-modal' });
  let mezclar = false;
  const opciones = [
    { valor: false, etiqueta: 'Mantener orden de reactivos', detalle: 'El Tipo B queda con las secciones y preguntas en el mismo orden que el Tipo A.' },
    { valor: true, etiqueta: 'Cambiar orden de reactivos', detalle: 'Se mezcla el orden de las secciones y de las preguntas dentro de cada una (mismas preguntas, mismas subpreguntas, distinto acomodo) para que no sea idéntico al Tipo A.' },
  ];
  const listaOpciones = el('div', { class: 'opciones-duplicar' }, opciones.map((op) => el('label', { class: 'opcion-duplicar' }, [
    el('input', {
      type: 'radio', name: 'orden-duplicar', checked: mezclar === op.valor,
      onchange: () => { mezclar = op.valor; },
    }),
    el('div', {}, [
      el('div', { class: 'etiqueta-opcion-duplicar' }, op.etiqueta),
      el('div', { class: 'etiqueta-chica' }, op.detalle),
    ]),
  ])));

  const btnConfirmar = el('button', {
    type: 'button', class: 'btn-primario',
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
      const seMezclo = mezclar ? mezclarOrdenExamen(copia) : true;
      await guardarExamen(copia);
      overlay.remove();
      if (mezclar && !seMezclo) {
        alert('Este examen tiene muy pocas secciones y reactivos para cambiar su orden (no hay nada que reacomodar), así que el Tipo B quedó igual al Tipo A. Modifica las preguntas manualmente si necesitas que sean distintas.');
      }
      onListo(copia.id);
    },
  }, 'Duplicar');
  const btnCancelar = el('button', { type: 'button', class: 'btn-secundario', onclick: () => overlay.remove() }, 'Cancelar');

  overlay.appendChild(el('div', { class: 'panel modal-duplicar' }, [
    el('h2', {}, 'Duplicar a Tipo B'),
    listaOpciones,
    el('div', { class: 'acciones-modal' }, [btnConfirmar, btnCancelar]),
  ]));
  document.body.appendChild(overlay);
}

// --- Modal: nueva carpeta (solo organiza la lista, no afecta los filtros) ---

function abrirModalNuevaCarpeta(onListo) {
  const overlay = el('div', { class: 'overlay-modal' });
  const campoNombre = el('input', { type: 'text', placeholder: 'Ej. 1er trimestre, Exámenes finales…' });
  const crear = async () => {
    if (!campoNombre.value.trim()) return;
    const carpeta = nuevaCarpeta(sesion, campoNombre.value);
    await guardarCarpeta(carpeta);
    overlay.remove();
    onListo(carpeta.id);
  };
  campoNombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') crear(); });
  const btnCrear = el('button', { type: 'button', class: 'btn-primario', onclick: crear }, 'Crear');
  const btnCancelar = el('button', { type: 'button', class: 'btn-secundario', onclick: () => overlay.remove() }, 'Cancelar');

  overlay.appendChild(el('div', { class: 'panel modal-nueva-carpeta' }, [
    el('h2', {}, '📁 Nueva carpeta'),
    el('div', { class: 'campo' }, [el('label', {}, 'Nombre'), campoNombre]),
    el('div', { class: 'acciones-modal' }, [btnCrear, btnCancelar]),
  ]));
  document.body.appendChild(overlay);
  campoNombre.focus();
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
  const mensaje = el('p', { class: 'mensaje-login' });
  const btnReintentar = el('button', {
    type: 'button', class: 'btn-primario',
    onclick: async () => {
      btnReintentar.disabled = true; btnReintentar.textContent = 'Comprobando…';
      // Si un administrador reactivó la cuenta (o le asignó rol) mientras esta
      // pestaña seguía abierta aquí, no hay ningún evento que avise solo —
      // reintentarSesion() vuelve a leer el perfil sin necesidad de recargar
      // la página ni de cerrar sesión y volver a entrar.
      const nuevaSesion = await reintentarSesion();
      if (nuevaSesion && nuevaSesion.rol && nuevaSesion.activo !== false) {
        aplicarNuevaSesion(nuevaSesion);
        return;
      }
      sesion = nuevaSesion;
      btnReintentar.disabled = false; btnReintentar.textContent = 'Reintentar';
      mensaje.textContent = 'Sigue sin tener acceso — si un administrador ya te dio de alta o te reactivó, espera un momento y vuelve a intentar.';
    },
  }, 'Reintentar');
  vistaLogin.appendChild(el('div', { class: 'pantalla-login' }, [
    el('div', { class: 'panel panel-login' }, [
      el('h2', {}, 'Tu cuenta no tiene acceso'),
      el('p', {}, 'Inicia sesión pero no encontramos un rol asignado (o está desactivada). Pide a un administrador que revise tu cuenta.'),
      el('div', { class: 'acciones-modal' }, [
        btnReintentar,
        el('button', { type: 'button', class: 'btn-secundario', onclick: () => cerrarSesion() }, 'Cerrar sesión'),
      ]),
      mensaje,
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
function irAProgramas() { cambiarRuta('#programas'); }
function irAPrograma(programaId) { cambiarRuta(`#programa/${programaId}`); }

btnModuloExamenes.onclick = irALista;
btnModuloGrupos.onclick = irAGrupos;
btnModuloProgramas.onclick = irAProgramas;

async function renderLista() {
  marcarModuloActivo('examenes');
  mostrarVista(vistaLista);
  pintarLista();
}

async function renderEditor(examenId) {
  marcarModuloActivo('examenes');
  // Sin este try/catch, un link a un examen de otro profesor (Firestore lo
  // rechaza con permission-denied) dejaba la promesa rechazada sin atrapar en
  // ningún lado: la app se quedaba congelada en lo que se veía antes, sin
  // ningún mensaje de qué pasó.
  let examen;
  try {
    examen = await obtenerExamen(examenId);
  } catch (err) {
    alert(`No se pudo abrir el examen: ${err.message}`);
    irALista();
    return;
  }
  if (!examen) { irALista(); return; }
  montarEditor(vistaEditor, examen, { sesion, onVolver: irALista });
  mostrarVista(vistaEditor);
}

function renderAdmin() {
  marcarModuloActivo('examenes');
  mostrarVista(vistaAdmin);
  montarPanelAdmin(vistaAdmin, {
    sesion,
    onVolver: irALista,
    // "Parámetros" (antes "Datos de la escuela", que estaba en Exámenes): datos
    // de la escuela, membretes y formato estándar de los exámenes. Al volver se
    // regresa al Panel Administrador, que es de donde se entró.
    onParametros: () => { mostrarVista(vistaConfig); pintarConfig(irAAdmin); },
  });
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

function renderProgramas() {
  marcarModuloActivo('programas');
  mostrarVista(vistaProgramas);
  montarListaProgramas(vistaProgramas, sesion, { onAbrirPrograma: irAPrograma });
}

function renderPrograma(programaId) {
  marcarModuloActivo('programas');
  mostrarVista(vistaPrograma);
  montarEditorPrograma(vistaPrograma, programaId, sesion, { onVolver: irAProgramas });
}

// --- Lista de exámenes ---

function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

let filtroEstado = 'todos';
let filtroTipoExamen = 'todos';
let filtroProfesorExamen = 'todos';
let busquedaExamen = '';

// examenesCache guarda el último resultado de listarExamenes(): teclear en el
// buscador o cambiar un filtro solo tiene que re-filtrar y repintar esta copia
// en memoria, no volver a consultar Firestore en cada tecla — si no, el
// <input> se reemplaza por uno nuevo en cada tecla justo cuando el navegador
// todavía está esperando la respuesta de red, así que pierde el foco y solo
// se puede borrar de a un carácter (hay que volver a hacer clic cada vez).
let examenesCache = null;
let carpetasCache = null;
// null = todos los exámenes; 'sin-carpeta' = solo los que no tienen carpeta;
// cualquier otro valor = el id de la carpeta activa. Las carpetas solo
// acomodan la lista — no son un filtro más, se aplican aparte de esos.
let carpetaActivaId = null;
// Se incrementa en cada llamada a pintarLista(); si dos llamadas se
// superponen (ej. navegación rápida antes de que la primera termine de
// consultar Firestore) y la red las resuelve en desorden, la más vieja no
// debe pisar la caché con datos ya obsoletos — solo cuenta la última.
let tokenListaExamenes = 0;

// Si dos personas usan la misma computadora sin recargar la página entre una
// sesión y otra (cerrar sesión no recarga), estos filtros y la carpeta activa
// seguían siendo los de quien ya se fue: la lista del nuevo usuario podía
// aparecer vacía por un filtro/carpeta que ni siquiera existe para él, sin
// ninguna pista de por qué. Se reinicia al cambiar de sesión (ver main.js abajo).
function reiniciarFiltrosExamenes() {
  filtroEstado = 'todos';
  filtroTipoExamen = 'todos';
  filtroProfesorExamen = 'todos';
  busquedaExamen = '';
  examenesCache = null;
  carpetasCache = null;
  carpetaActivaId = null;
}

async function pintarLista() {
  clear(vistaLista);

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
  controles.push(el('button', {
    type: 'button', class: 'btn-secundario',
    onclick: () => abrirModalNuevaCarpeta((carpetaId) => { carpetaActivaId = carpetaId; pintarLista(); }),
  }, '📁 Nueva carpeta'));
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
          // El respaldo puede venir de otro profesor (o de una carpeta ya
          // borrada); su carpetaId no significa nada para quien importa —
          // dejarlo apuntando a una carpeta ajena lo dejaba mal contado en
          // todos los chips y el selector de carpeta sin mostrarlo.
          examen.carpetaId = null;
          await guardarExamen(examen);
          irAEditor(examen.id);
        } catch (err) {
          alert('No se pudo importar el archivo: ' + err.message);
        }
        e.target.value = '';
      },
    }),
  ]));

  vistaLista.appendChild(el('div', { class: 'barra-nueva' }, controles));

  const contenedorResultados = el('div', {});
  vistaLista.appendChild(contenedorResultados);

  const cargando = el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'Cargando exámenes…');
  contenedorResultados.appendChild(cargando);

  // allSettled y no Promise.all: las carpetas son un extra de organización,
  // no algo esencial — si esa consulta falla no tiene que tumbar la lista de
  // exámenes, que puede haberse cargado bien de todas formas.
  const token = ++tokenListaExamenes;
  const [examenesResultado, carpetasResultado] = await Promise.allSettled([listarExamenes(sesion), listarCarpetas(sesion)]);
  if (token !== tokenListaExamenes) return; // llegó tarde: ya hay una llamada más nueva en curso
  if (examenesResultado.status === 'rejected') {
    cargando.textContent = `No se pudieron cargar los exámenes: ${examenesResultado.reason.message}`;
    return;
  }
  examenesCache = examenesResultado.value;
  carpetasCache = carpetasResultado.status === 'fulfilled' ? carpetasResultado.value : [];
  clear(contenedorResultados);
  renderizarResultadosExamenes(contenedorResultados);
}

// Repinta solo la barra de filtros y las tarjetas a partir de examenesCache
// (sin red de por medio) — de aquí llaman los oninput/onchange de los
// filtros, y por eso todo pasa de forma síncrona: así el <input> nuevo queda
// enfocado en el mismo instante en que se reemplaza el viejo.
function renderizarResultadosExamenes(contenedorResultados) {
  const foco = guardarFoco(contenedorResultados, '.campo-busqueda');
  clear(contenedorResultados);

  const puedeVerTodos = esRevisorOAdmin(sesion);
  let examenes = examenesCache || [];
  const todosLosExamenes = examenesCache || [];
  const carpetas = carpetasCache || [];

  // Carpetas: solo acomodan la lista, van aparte de la barra de filtros y no
  // se cruzan con ella (un filtro de materia/tipo/estado se aplica dentro de
  // la carpeta activa, no al revés).
  if (carpetas.length > 0 || carpetaActivaId) {
    // Un solo recorrido de los exámenes para contar cuántos hay por carpeta,
    // en vez de un .filter() aparte por cada chip (que sería O(carpetas × exámenes)).
    let sinCarpeta = 0;
    const conteoPorCarpeta = new Map();
    for (const ex of todosLosExamenes) {
      if (ex.carpetaId) conteoPorCarpeta.set(ex.carpetaId, (conteoPorCarpeta.get(ex.carpetaId) || 0) + 1);
      else sinCarpeta += 1;
    }
    const chip = (valor, etiqueta, cantidad) => el('button', {
      type: 'button',
      class: `chip-carpeta${carpetaActivaId === valor ? ' activo' : ''}`,
      onclick: () => { carpetaActivaId = valor; renderizarResultadosExamenes(contenedorResultados); },
    }, `${etiqueta} (${cantidad})`);
    const barraCarpetas = el('div', { class: 'barra-carpetas' }, [
      chip(null, 'Todos', todosLosExamenes.length),
      chip('sin-carpeta', 'Sin carpeta', sinCarpeta),
      ...carpetas.map((carp) => {
        const chipEl = chip(carp.id, carp.nombre, conteoPorCarpeta.get(carp.id) || 0);
        if (carp.profesorId === sesion.uid) {
          chipEl.appendChild(el('span', {
            class: 'btn-quitar-chip', title: 'Eliminar carpeta',
            onclick: async (e) => {
              e.stopPropagation();
              if (!confirm(`¿Eliminar la carpeta "${carp.nombre}"? Los exámenes no se borran, solo dejan de estar en esta carpeta.`)) return;
              const enEsaCarpeta = todosLosExamenes.filter((ex) => ex.carpetaId === carp.id);
              await Promise.all(enEsaCarpeta.map((ex) => { ex.carpetaId = null; return guardarExamen(ex); }));
              await eliminarCarpeta(carp.id);
              if (carpetaActivaId === carp.id) carpetaActivaId = null;
              pintarLista();
            },
          }, '✕'));
        }
        return chipEl;
      }),
    ]);
    contenedorResultados.appendChild(barraCarpetas);
  }
  if (carpetaActivaId === 'sin-carpeta') {
    examenes = examenes.filter((ex) => !ex.carpetaId);
  } else if (carpetaActivaId) {
    examenes = examenes.filter((ex) => ex.carpetaId === carpetaActivaId);
  }

  const barraFiltros = el('div', { class: 'barra-filtros' }, [
    campoBusqueda({ placeholder: 'Buscar por materia, grado o profesor(a)…', valor: busquedaExamen, onCambio: (v) => { busquedaExamen = v; renderizarResultadosExamenes(contenedorResultados); } }),
    el('select', {
      onchange: (e) => { filtroTipoExamen = e.target.value; renderizarResultadosExamenes(contenedorResultados); },
    }, [
      el('option', { value: 'todos', selected: filtroTipoExamen === 'todos' }, 'Todos los tipos'),
      el('option', { value: 'A', selected: filtroTipoExamen === 'A' }, 'Tipo A'),
      el('option', { value: 'B', selected: filtroTipoExamen === 'B' }, 'Tipo B'),
    ]),
  ]);
  if (puedeVerTodos) {
    barraFiltros.appendChild(el('select', {
      onchange: (e) => { filtroEstado = e.target.value; renderizarResultadosExamenes(contenedorResultados); },
    }, [
      el('option', { value: 'todos', selected: filtroEstado === 'todos' }, 'Todos los estados'),
      ...Object.entries(ETIQUETAS_ESTADO).map(([valor, etiqueta]) => el('option', { value: valor, selected: filtroEstado === valor }, etiqueta)),
    ]));
    const profesores = [...new Set(examenes.map((ex) => ex.profesorNombre).filter(Boolean))].sort();
    barraFiltros.appendChild(el('select', {
      onchange: (e) => { filtroProfesorExamen = e.target.value; renderizarResultadosExamenes(contenedorResultados); },
    }, [
      el('option', { value: 'todos', selected: filtroProfesorExamen === 'todos' }, 'Todos los profesores'),
      ...profesores.map((p) => el('option', { value: p, selected: filtroProfesorExamen === p }, p)),
    ]));
  }
  contenedorResultados.appendChild(barraFiltros);
  restaurarFoco(contenedorResultados, foco);

  if (puedeVerTodos && filtroEstado !== 'todos') {
    examenes = examenes.filter((ex) => ex.estado === filtroEstado);
  }
  if (puedeVerTodos && filtroProfesorExamen !== 'todos') {
    examenes = examenes.filter((ex) => ex.profesorNombre === filtroProfesorExamen);
  }
  if (filtroTipoExamen !== 'todos') {
    examenes = examenes.filter((ex) => ex.tipoExamen === filtroTipoExamen);
  }
  if (busquedaExamen) {
    examenes = examenes.filter((ex) => coincideTexto(
      busquedaExamen, ex.meta.materia, ex.meta.grado, ex.meta.grupo, ex.meta.profesor, ex.profesorNombre,
    ));
  }

  if (examenes.length === 0) {
    contenedorResultados.appendChild(el('p', { style: 'color:#666; margin-top:1.5rem;' }, 'No hay exámenes que coincidan con esos filtros.'));
    return;
  }

  contenedorResultados.appendChild(el('div', { class: 'lista-examenes' }, examenes.map((examen) => el('div', { class: 'tarjeta-examen' }, [
    el('h3', {}, [
      `${examen.meta.materia || 'Sin materia'} `,
      el('span', { class: 'etiqueta-tipo-examen' }, `Tipo ${examen.tipoExamen}`),
      examen.formato === 'ingles' ? el('span', { class: 'etiqueta-tipo-examen' }, 'Inglés') : null,
    ]),
    el('div', { class: 'meta-chica' }, [
      `${examen.meta.grado || '—'}${examen.meta.grupo || ''} · ${ETIQUETAS_TRIMESTRE[examen.meta.trimestre] || 'sin trimestre'} · editado ${fechaCorta(examen.updatedAt)}`,
      puedeVerTodos ? el('br') : null,
      puedeVerTodos ? `Profesor(a): ${examen.profesorNombre || '—'}` : null,
    ]),
    el('div', { class: `insignia-estado insignia-${examen.estado || 'borrador'}` }, ETIQUETAS_ESTADO[examen.estado] || 'Borrador'),
    (() => {
      // revisor/administrador ven las carpetas de TODOS los profesores en
      // `carpetas`; si se ofrecieran todas aquí, se podría archivar sin
      // querer el examen de un profesor dentro de la carpeta de otro. Cada
      // tarjeta solo puede ofrecer las carpetas de su propio dueño.
      const carpetasDelProfesor = carpetas.filter((c) => c.profesorId === examen.profesorId);
      if (carpetasDelProfesor.length === 0) return null;
      return el('select', {
        class: 'selector-carpeta-tarjeta', title: 'Mover a una carpeta',
        onchange: async (e) => {
          examen.carpetaId = e.target.value || null;
          await guardarExamen(examen);
          renderizarResultadosExamenes(contenedorResultados);
        },
      }, [
        el('option', { value: '', selected: !examen.carpetaId }, '📁 Sin carpeta'),
        ...carpetasDelProfesor.map((c) => el('option', { value: c.id, selected: examen.carpetaId === c.id }, `📁 ${c.nombre}`)),
      ]);
    })(),
    el('div', { class: 'acciones-tarjeta' }, [
      el('button', { type: 'button', class: 'btn-primario', onclick: () => irAEditor(examen.id) }, 'Abrir'),
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => abrirModalDuplicarTipoB(examen, irAEditor),
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

// --- Parámetros: datos de la escuela, membretes y formato estándar de los
// exámenes (solo administrador). Se entra desde el Panel Administrador; el
// botón vivía antes en la lista de Exámenes y se llamaba "Datos de la escuela".
// Un revisor no llega aquí: la vista sale del Panel Administrador, que solo
// abre un administrador (ver manejarHash), y estas mismas reglas las repite
// firestore.rules para configuracion/escuela.

async function pintarConfig(onVolver) {
  clear(vistaConfig);
  const config = await obtenerConfig();
  // El formato estándar se guarda aparte de los datos de la escuela, dentro del
  // mismo documento — lo lee estiloDocumentoDeExamen (paginate.js) como valor
  // por defecto de TODOS los exámenes que no traigan su propio formato.
  config.formatoExamen = config.formatoExamen || {};

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

  // Un campo numérico del formato estándar. Vacío = "usa el valor de fábrica",
  // así que se distingue del 0 puesto a propósito (ej. margen 0): por eso el
  // valor se compara contra null/'' en vez de con `||`, igual que en
  // numeroODefecto de paginate.js.
  const campoFormatoNumero = (etiqueta, valor, porDefecto, onInput, paso = '0.1') => el('div', { class: 'campo' }, [
    el('label', {}, etiqueta),
    el('input', {
      type: 'number', step: paso, min: '0', placeholder: `${porDefecto} (de fábrica)`,
      value: valor === null || valor === undefined || valor === '' ? '' : valor,
      oninput: (e) => {
        const texto = e.target.value;
        onInput(texto === '' || texto === '-' ? null : Math.max(0, parseFloat(texto) || 0));
        guardarConfigConDebounce();
      },
    }),
  ]);

  const panelFormato = el('div', { class: 'panel' }, [
    el('h2', {}, '🛠 Formato estándar de los exámenes'),
    el('p', { class: 'etiqueta-chica' }, 'Con esto salen todos los exámenes mientras nadie les cambie el formato a mano. Si un examen trae su propio formato (editor → "Formato de todo el documento"), ese gana; los demás se reacomodan solos al guardar aquí. Deja un campo vacío para usar el valor de fábrica.'),
    el('div', { class: 'rejilla-campos' }, [
      campoFormatoNumero('Márgenes (cm)', config.formatoExamen.margenCm, MARGEN_POR_DEFECTO_CM, (v) => { config.formatoExamen.margenCm = v; }),
      campoFormatoNumero('Sangría (cm)', config.formatoExamen.sangriaCm, SANGRIA_POR_DEFECTO_CM, (v) => { config.formatoExamen.sangriaCm = v; }),
      campoFormatoNumero('Interlineado', config.formatoExamen.interlineado, INTERLINEADO_POR_DEFECTO, (v) => { config.formatoExamen.interlineado = v; }),
      el('div', { class: 'campo' }, [
        el('label', {}, 'Tipografía'),
        el('select', {
          onchange: (e) => { config.formatoExamen.familia = e.target.value; guardarConfigConDebounce(); },
        }, FAMILIAS_FUENTE.map((f) => el('option', {
          value: f.valor, selected: (config.formatoExamen.familia || '') === f.valor,
        }, f.valor === '' ? 'Arial (de fábrica)' : f.etiqueta))),
      ]),
      el('div', { class: 'campo' }, [
        el('label', {}, 'Tamaño de letra'),
        el('select', {
          onchange: (e) => { config.formatoExamen.tamano = e.target.value; guardarConfigConDebounce(); },
        }, TAMANOS_FUENTE.map((t) => el('option', {
          value: t, selected: String(config.formatoExamen.tamano || '') === t,
        }, t ? `${t} pt` : `${TAMANO_POR_DEFECTO_PT} pt (de fábrica)`))),
      ]),
      el('div', { class: 'campo' }, [
        el('label', {}, 'Ajuste del texto'),
        el('select', {
          onchange: (e) => { config.formatoExamen.ajuste = e.target.value; guardarConfigConDebounce(); },
        }, AJUSTES_TEXTO_DOCUMENTO.map((a) => el('option', {
          value: a.valor, selected: (config.formatoExamen.ajuste || '') === a.valor,
        }, a.etiqueta))),
      ]),
    ]),
    el('p', { class: 'etiqueta-chica' }, 'Cambiar los márgenes, el interlineado o el tamaño de letra repagina los exámenes: revisa en la vista previa que ninguno se haya recorrido de hoja antes de mandarlos a imprimir.'),
  ]);

  vistaConfig.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, '← Volver al Panel Administrador'));
  vistaConfig.appendChild(el('div', { class: 'pantalla-config' }, [
    // Columna izquierda: lo que se imprime tal cual en la hoja (datos y membretes).
    el('div', { class: 'columna-config' }, [
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
        el('h2', {}, 'Membrete de los exámenes'),
        el('p', { class: 'etiqueta-chica' }, 'Las líneas de la dependencia que van en la caja del encabezado, junto al logo (punto I del formato oficial). Una línea por renglón.'),
        el('div', { class: 'campo' }, [
          el('textarea', {
            rows: '7',
            oninput: (e) => { config.encabezadoOficial = e.target.value; guardarConfigConDebounce(); },
          }, config.encabezadoOficial || ENCABEZADO_OFICIAL_DEFECTO),
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
    ]),
    // Columna derecha: cómo se acomoda ese contenido en la hoja. Va aquí al lado
    // y no hasta abajo porque los paneles de la izquierda son angostos y dejaban
    // media pantalla vacía.
    el('div', { class: 'columna-config' }, [panelFormato]),
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
  if (hash === 'programas') {
    renderProgramas();
    return;
  }
  if (hash.startsWith('programa/')) {
    renderPrograma(hash.slice('programa/'.length));
    return;
  }
  renderLista();
}

window.addEventListener('hashchange', manejarHash);

// Vive fuera de las vistas y no depende de la sesión: si alguien no puede ni
// entrar, ese es justo el momento en que más necesita el contacto de soporte.
montarSoporte();

// Compartida entre el observador de Auth de abajo y el botón "Reintentar" de
// pintarSinAcceso (que llama a reintentarSesion() sin pasar por Auth) — las
// dos formas en que puede llegar una sesión nueva deben acomodarse igual.
function aplicarNuevaSesion(nuevaSesion) {
  // Un cambio real de usuario (no solo un refresco de token del mismo uid, ni
  // el primer disparo al cargar la página) deja atrás filtros/carpeta activa/
  // cachés que le pertenecían a la sesión anterior — ver reiniciarFiltrosExamenes.
  // "sesion" ya vale null tanto antes del primer disparo como tras cerrar
  // sesión, así que no alcanza para distinguir esos dos casos por sí solo.
  const uidAnterior = sesion ? sesion.uid : null;
  const uidNuevo = nuevaSesion ? nuevaSesion.uid : null;
  if (huboSesionAntes && uidAnterior !== uidNuevo) {
    reiniciarFiltrosExamenes();
    reiniciarFiltrosGrupos();
    reiniciarFiltrosProgramas();
  }
  huboSesionAntes = true;
  sesion = nuevaSesion;
  pintarInfoSesion();
  manejarHash();
}

observarSesion(aplicarNuevaSesion);
