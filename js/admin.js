// Panel Administrador: alta y baja de cuentas (solo administrador), más la
// entrada a "Parámetros" (datos de la escuela, membretes y formato estándar de
// los exámenes, que dibuja main.js).
//
// El alta usa una instancia secundaria de la app de Firebase para crear el
// usuario en Auth sin cerrar la sesión de quien está dando de alta.

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signOut as signOutSecundario,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection, doc, setDoc, updateDoc, deleteDoc, getDocs, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { db } from './auth.js';
import { el, clear } from './dom.js';
import { ETIQUETAS_ROL } from './model.js';

function appSecundaria() {
  const nombre = 'alta-de-cuentas';
  const existente = getApps().find((a) => a.name === nombre);
  return existente || initializeApp(firebaseConfig, nombre);
}

// Sin 0/O/1/l/I para que se pueda leer o transcribir a mano sin confusiones.
const ALFABETO_CONTRASENA = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generarContrasena(longitud = 10) {
  let contrasena = '';
  for (let i = 0; i < longitud; i++) {
    contrasena += ALFABETO_CONTRASENA[Math.floor(Math.random() * ALFABETO_CONTRASENA.length)];
  }
  return contrasena;
}

// El correo de restablecimiento de Firebase no siempre llega (dominios institucionales
// suelen bloquearlo en silencio) — por eso la cuenta se crea con una contraseña temporal
// que el administrador ve en pantalla y comparte por su cuenta (WhatsApp, en persona, etc.).
// El maestro/revisor la cambia luego desde "Cambiar contraseña" ya adentro de la app.
export async function crearCuenta({ nombre, email, rol }) {
  const authSecundario = getAuth(appSecundaria());
  const contrasena = generarContrasena();
  const cred = await createUserWithEmailAndPassword(authSecundario, email, contrasena);
  const uid = cred.user.uid;

  await setDoc(doc(db, 'usuarios', uid), {
    nombre, email, rol, activo: true, createdAt: new Date().toISOString(),
  });

  await signOutSecundario(authSecundario);

  return { uid, contrasena };
}

export async function listarUsuarios() {
  const snap = await getDocs(query(collection(db, 'usuarios'), orderBy('nombre')));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function cambiarActivo(uid, activo) {
  await updateDoc(doc(db, 'usuarios', uid), { activo });
}

// Baja de una cuenta. Sin Cloud Functions no se puede borrar el usuario de
// Firebase Auth desde el navegador, así que lo que se borra es su documento de
// usuarios/{uid}: sin él la cuenta se queda sin rol y la app la manda a la
// pantalla "Tu cuenta no tiene acceso" (ver observarSesion y pintarSinAcceso).
// Antes de borrarlo se deja constancia en usuariosEliminados/{uid} con el
// motivo que capturó el administrador y quién lo dio de baja — si no, la razón
// de la baja se perdería justo con el documento que se está borrando.
export async function eliminarUsuario(usuario, { motivo, administrador }) {
  await setDoc(doc(db, 'usuariosEliminados', usuario.uid), {
    uid: usuario.uid,
    nombre: usuario.nombre || '',
    email: usuario.email || '',
    rol: usuario.rol || '',
    motivo,
    eliminadoPor: (administrador && administrador.nombre) || (administrador && administrador.email) || '',
    eliminadoEn: new Date().toISOString(),
  });
  await deleteDoc(doc(db, 'usuarios', usuario.uid));
}

export async function listarUsuariosEliminados() {
  const snap = await getDocs(query(collection(db, 'usuariosEliminados'), orderBy('eliminadoEn', 'desc')));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// --- UI ---

// Modal de baja: confirmación + motivo obligatorio. Se pide el motivo aquí y no
// con un prompt() porque la baja no se puede deshacer (no hay papelera de
// cuentas) y conviene que se vea con todas sus letras a quién se está borrando.
function abrirModalEliminarUsuario(usuario, { administrador, onListo }) {
  const overlay = el('div', { class: 'overlay-modal' });
  const campoMotivo = el('textarea', { rows: '3', placeholder: 'Ej. dejó de trabajar en la escuela, cuenta duplicada, cambio de plantel…' });
  const mensaje = el('p', { class: 'mensaje-login' });
  const btnEliminar = el('button', { type: 'button', class: 'btn-peligro' }, 'Eliminar cuenta');
  const btnCancelar = el('button', { type: 'button', class: 'btn-secundario', onclick: () => overlay.remove() }, 'Cancelar');

  btnEliminar.onclick = async () => {
    const motivo = campoMotivo.value.trim();
    if (!motivo) { mensaje.textContent = 'Escribe el motivo de la eliminación.'; return; }
    btnEliminar.disabled = true; btnCancelar.disabled = true; btnEliminar.textContent = 'Eliminando…';
    try {
      await eliminarUsuario(usuario, { motivo, administrador });
      overlay.remove();
      onListo();
    } catch (err) {
      mensaje.textContent = `No se pudo eliminar: ${err.message}`;
      btnEliminar.disabled = false; btnCancelar.disabled = false; btnEliminar.textContent = 'Eliminar cuenta';
    }
  };

  overlay.appendChild(el('div', { class: 'panel modal-eliminar-usuario' }, [
    el('h2', {}, 'Eliminar cuenta'),
    el('p', {}, ['¿Seguro que quieres eliminar la cuenta de ', el('strong', {}, usuario.nombre || usuario.email), ` (${usuario.email})? No se puede deshacer.`]),
    el('p', { class: 'etiqueta-chica' }, 'La persona pierde el acceso a la app de inmediato. Sus exámenes, grupos y programas NO se borran: se quedan guardados y los siguen viendo revisores y administradores. Si solo quieres bloquearla un rato, usa "Desactivar" en vez de esto.'),
    el('div', { class: 'campo' }, [el('label', {}, 'Motivo de la eliminación (obligatorio)'), campoMotivo]),
    el('div', { class: 'acciones-modal' }, [btnEliminar, btnCancelar]),
    mensaje,
  ]));
  document.body.appendChild(overlay);
  campoMotivo.focus();
}

// sesion = { uid, nombre, email, rol } del administrador que tiene la pantalla
// abierta; onParametros abre la pantalla de Parámetros (la dibuja main.js).
export function montarPanelAdmin(contenedor, { sesion, onVolver, onParametros }) {
  clear(contenedor);

  const mensaje = el('div', { class: 'mensaje-admin oculto' });
  const cajaCredenciales = el('div', { class: 'caja-credenciales oculto' });

  function mostrarMensaje(texto, esError = false) {
    mensaje.textContent = texto;
    mensaje.className = esError ? 'mensaje-admin error' : 'mensaje-admin ok';
  }

  function mostrarCredenciales(nombre, email, contrasena) {
    clear(cajaCredenciales);
    cajaCredenciales.className = 'caja-credenciales';
    const campoContrasena = el('code', {}, contrasena);
    const btnCopiar = el('button', {
      type: 'button', class: 'btn-secundario',
      onclick: async () => {
        await navigator.clipboard.writeText(contrasena);
        btnCopiar.textContent = '✔ Copiada';
        setTimeout(() => { btnCopiar.textContent = 'Copiar'; }, 1500);
      },
    }, 'Copiar');
    cajaCredenciales.appendChild(el('p', {}, [`Cuenta creada para `, el('strong', {}, nombre), ` (${email}). Su contraseña temporal:`]));
    cajaCredenciales.appendChild(el('div', { class: 'fila-credencial' }, [campoContrasena, btnCopiar]));
    cajaCredenciales.appendChild(el('p', { class: 'etiqueta-chica' }, 'Compártesela por un medio seguro (WhatsApp, en persona, etc. — el correo de restablecimiento automático no siempre llega). Pídele que la cambie en cuanto entre, desde "Cambiar contraseña" arriba a la derecha.'));
  }

  const campoNombre = el('input', { type: 'text', placeholder: 'Nombre completo' });
  const campoEmail = el('input', { type: 'email', placeholder: 'correo@escuela.mx' });
  const campoRol = el('select', {}, [
    el('option', { value: 'maestro' }, 'Maestro'),
    el('option', { value: 'revisor' }, 'Revisor'),
    el('option', { value: 'administrador' }, 'Administrador'),
  ]);
  const btnCrear = el('button', { type: 'button', class: 'btn-primario' }, 'Crear cuenta');

  const tablaUsuarios = el('div', { class: 'tabla-usuarios' });

  async function recargarUsuarios() {
    clear(tablaUsuarios);
    tablaUsuarios.appendChild(el('p', {}, 'Cargando…'));
    try {
      const usuarios = await listarUsuarios();
      clear(tablaUsuarios);
      if (usuarios.length === 0) {
        tablaUsuarios.appendChild(el('p', {}, 'Aún no hay cuentas.'));
        return;
      }
      usuarios.forEach((u) => {
        // Las cuentas de administrador no se pueden eliminar desde aquí: son las
        // únicas que pueden dar de alta cuentas y editar la configuración de la
        // escuela, así que borrar la última dejaría la app sin quién la
        // administre (y no hay forma de recuperarla sin tocar Firebase a mano).
        const esAdministrador = u.rol === 'administrador';
        tablaUsuarios.appendChild(el('div', { class: 'fila-usuario' }, [
          el('div', { class: 'info-usuario' }, [
            el('strong', {}, u.nombre || u.email),
            el('span', { class: 'email-usuario' }, u.email),
          ]),
          el('span', { class: 'etiqueta-rol' }, ETIQUETAS_ROL[u.rol] || u.rol),
          el('span', { class: u.activo ? 'estado-activo' : 'estado-inactivo' }, u.activo ? 'Activo' : 'Inactivo'),
          el('button', {
            type: 'button', class: 'btn-secundario',
            onclick: async () => {
              await cambiarActivo(u.uid, !u.activo);
              recargarUsuarios();
            },
          }, u.activo ? 'Desactivar' : 'Activar'),
          esAdministrador
            ? el('span', { class: 'etiqueta-chica', title: 'Las cuentas de administrador no se pueden eliminar desde el panel.' }, 'No se elimina')
            : el('button', {
              type: 'button', class: 'btn-peligro',
              onclick: () => abrirModalEliminarUsuario(u, {
                administrador: sesion,
                onListo: () => { recargarUsuarios(); recargarEliminados(); },
              }),
            }, 'Eliminar'),
        ]));
      });
    } catch (err) {
      clear(tablaUsuarios);
      tablaUsuarios.appendChild(el('p', {}, `No se pudo cargar la lista: ${err.message}`));
    }
  }

  btnCrear.onclick = async () => {
    const nombre = campoNombre.value.trim();
    const email = campoEmail.value.trim();
    const rol = campoRol.value;
    if (!nombre || !email) { mostrarMensaje('Falta nombre o correo.', true); return; }
    btnCrear.disabled = true;
    btnCrear.textContent = 'Creando…';
    try {
      const { contrasena } = await crearCuenta({ nombre, email, rol });
      mostrarCredenciales(nombre, email, contrasena);
      campoNombre.value = '';
      campoEmail.value = '';
      recargarUsuarios();
    } catch (err) {
      mostrarMensaje(`No se pudo crear la cuenta: ${err.message}`, true);
    } finally {
      btnCrear.disabled = false;
      btnCrear.textContent = 'Crear cuenta';
    }
  };

  // Historial de bajas: el motivo se captura al eliminar, así que tiene que
  // poderse consultar en algún lado — si no, preguntarlo no serviría de nada.
  const tablaEliminados = el('div', { class: 'tabla-usuarios' });
  let eliminadosColapsado = true;

  async function recargarEliminados() {
    if (eliminadosColapsado) return; // no se consulta lo que no se está viendo
    clear(tablaEliminados);
    tablaEliminados.appendChild(el('p', {}, 'Cargando…'));
    try {
      const bajas = await listarUsuariosEliminados();
      clear(tablaEliminados);
      if (bajas.length === 0) {
        tablaEliminados.appendChild(el('p', {}, 'No se ha eliminado ninguna cuenta.'));
        return;
      }
      bajas.forEach((b) => {
        tablaEliminados.appendChild(el('div', { class: 'fila-usuario' }, [
          el('div', { class: 'info-usuario' }, [
            el('strong', {}, b.nombre || b.email),
            el('span', { class: 'email-usuario' }, b.email),
            el('span', { class: 'motivo-baja' }, `Motivo: ${b.motivo || '—'}`),
          ]),
          el('span', { class: 'etiqueta-rol' }, ETIQUETAS_ROL[b.rol] || b.rol || '—'),
          el('span', { class: 'etiqueta-chica' }, `${b.eliminadoPor ? `Por ${b.eliminadoPor}` : ''}${b.eliminadoEn ? ` · ${new Date(b.eliminadoEn).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}`),
        ]));
      });
    } catch (err) {
      clear(tablaEliminados);
      tablaEliminados.appendChild(el('p', {}, `No se pudo cargar el historial: ${err.message}`));
    }
  }

  const btnToggleEliminados = el('button', {
    type: 'button', class: 'btn-icono', title: 'Mostrar/ocultar el historial de cuentas eliminadas',
    onclick: () => {
      eliminadosColapsado = !eliminadosColapsado;
      tablaEliminados.classList.toggle('oculto', eliminadosColapsado);
      btnToggleEliminados.textContent = eliminadosColapsado ? '▸' : '▾';
      recargarEliminados();
    },
  }, '▸');
  tablaEliminados.classList.add('oculto');

  contenedor.appendChild(el('div', { class: 'barra-nueva', style: 'margin-top:0; margin-bottom:0.8rem;' }, [
    el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver }, '← Volver'),
    el('button', { type: 'button', class: 'btn-secundario', onclick: onParametros }, '⚙ Parámetros'),
  ]));
  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'Dar de alta una cuenta'),
    el('div', { class: 'rejilla-campos' }, [
      el('div', { class: 'campo' }, [el('label', {}, 'Nombre'), campoNombre]),
      el('div', { class: 'campo' }, [el('label', {}, 'Correo'), campoEmail]),
      el('div', { class: 'campo' }, [el('label', {}, 'Rol'), campoRol]),
    ]),
    btnCrear,
    mensaje,
    cajaCredenciales,
  ]));
  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, 'Cuentas existentes'),
    el('p', { class: 'etiqueta-chica' }, '"Desactivar" bloquea el acceso sin borrar nada y se puede revertir. "Eliminar" quita la cuenta para siempre y pide un motivo; las cuentas de administrador no se pueden eliminar desde aquí.'),
    tablaUsuarios,
  ]));
  contenedor.appendChild(el('div', { class: 'panel' }, [
    el('h2', { style: 'display:flex; align-items:center; gap:0.3rem;' }, [btnToggleEliminados, 'Cuentas eliminadas']),
    tablaEliminados,
  ]));

  recargarUsuarios();
}
