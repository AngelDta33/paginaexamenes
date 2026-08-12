// Alta de cuentas (solo administrador). Usa una instancia secundaria de la app de Firebase
// para crear el usuario en Auth sin cerrar la sesión de quien está dando de alta.

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signOut as signOutSecundario,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection, doc, setDoc, updateDoc, getDocs, query, orderBy,
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

// --- UI ---

export function montarPanelAdmin(contenedor, { onVolver }) {
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

  contenedor.appendChild(el('button', { type: 'button', class: 'btn-secundario', onclick: onVolver, style: 'margin-bottom:0.8rem;' }, '← Volver'));
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
    tablaUsuarios,
  ]));

  recargarUsuarios();
}
