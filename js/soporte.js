// Botón flotante de soporte (esquina inferior derecha, en todas las vistas):
// al presionarlo muestra los correos a los que se reportan errores o sugerencias.

import { el, clear } from './dom.js';

const CORREOS_SOPORTE = ['raul.becario@ccuma.mx', 'angel.becario@ccuma.mx'];
const ASUNTO_CORREO = 'Reporte de error o sugerencia — Panel de control CCUMA';

// Cuenta compartida de pruebas: mientras la app solo se reparte entre administrativos,
// los maestros entran con esta para darnos feedback sin tener que darlos de alta uno
// por uno. Al abrirla al público hay que borrar este bloque y la cuenta en Firebase.
const CUENTA_PRUEBA = {
  correo: 'docente@ccuma.mx',
  contrasena: '8M9qqpNkGj',
};

function enlaceCorreo(correo) {
  return `mailto:${correo}?subject=${encodeURIComponent(ASUNTO_CORREO)}`;
}

// navigator.clipboard solo existe en contextos seguros (https o localhost); en
// una intranet por http hay que caer al textarea + execCommand para que el botón
// "Copiar" siga sirviendo en las computadoras de la escuela.
async function copiarTexto(texto) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch (err) {
    // sigue al plan B
  }
  const area = el('textarea', { value: texto, style: 'position:fixed; left:-9999px; top:0;' });
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  area.remove();
  return ok;
}

// Fila "texto + botón Copiar". Si se le pasa un href el texto va como enlace
// (correos de soporte); si no, va como texto plano (los datos de la cuenta de prueba).
function filaCopiable(texto, href) {
  const btnCopiar = el('button', { type: 'button', class: 'btn-copiar-correo', title: `Copiar ${texto}` }, 'Copiar');
  btnCopiar.onclick = async () => {
    const ok = await copiarTexto(texto);
    btnCopiar.textContent = ok ? '¡Copiado!' : 'Cópialo a mano';
    btnCopiar.classList.add('copiado');
    setTimeout(() => { btnCopiar.textContent = 'Copiar'; btnCopiar.classList.remove('copiado'); }, 1800);
  };
  const etiqueta = href
    ? el('a', { class: 'correo-soporte', href }, texto)
    : el('span', { class: 'correo-soporte' }, texto);
  return el('div', { class: 'fila-correo-soporte' }, [etiqueta, btnCopiar]);
}

function filaCorreo(correo) {
  return filaCopiable(correo, enlaceCorreo(correo));
}

// Se monta una sola vez al arrancar la app (ver main.js) y vive fuera de <main>,
// como hijo directo de <body>, para que quede fijo sobre cualquier vista.
export function montarSoporte() {
  if (document.querySelector('.soporte-flotante')) return;

  const panel = el('div', { class: 'panel-soporte oculto', role: 'dialog', 'aria-label': 'Contacto de soporte' });
  const boton = el('button', {
    type: 'button', class: 'btn-soporte', 'aria-expanded': 'false',
    title: 'Reportar errores o sugerencias',
  }, [
    el('img', { class: 'icono-soporte', src: 'img/soporte-ccumi.png', alt: 'Soporte CCUMI' }),
    el('span', { class: 'texto-soporte' }, 'Reportar errores o sugerencias'),
  ]);
  const contenedor = el('div', { class: 'soporte-flotante' }, [panel, boton]);

  function pintarPanel() {
    clear(panel);
    panel.appendChild(el('div', { class: 'titulo-soporte' }, 'Soporte'));
    panel.appendChild(el('p', { class: 'etiqueta-chica' }, '¿Encontraste un error o se te ocurre una mejora? Escríbenos a cualquiera de estos correos:'));
    CORREOS_SOPORTE.forEach((correo) => panel.appendChild(filaCorreo(correo)));

    panel.appendChild(el('div', { class: 'separador-soporte' }));
    panel.appendChild(el('div', { class: 'titulo-soporte' }, 'Cuenta para realizar pruebas de la app'));
    panel.appendChild(el('p', { class: 'etiqueta-chica' }, 'Entra con estos datos para probar la app y contarnos qué le falta. Es una cuenta compartida: no guardes en ella información real ni le cambies la contraseña.'));
    panel.appendChild(filaCopiable(CUENTA_PRUEBA.correo));
    panel.appendChild(filaCopiable(CUENTA_PRUEBA.contrasena));
  }

  function abierto() { return !panel.classList.contains('oculto'); }

  function alternar(mostrar) {
    const visible = mostrar === undefined ? !abierto() : mostrar;
    panel.classList.toggle('oculto', !visible);
    boton.setAttribute('aria-expanded', String(visible));
  }

  boton.onclick = (e) => { e.stopPropagation(); alternar(); };
  // Cerrar al hacer clic fuera o con Escape, como cualquier menú desplegable.
  document.addEventListener('click', (e) => {
    if (abierto() && !contenedor.contains(e.target)) alternar(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abierto()) alternar(false);
  });

  pintarPanel();
  document.body.appendChild(contenedor);
}
