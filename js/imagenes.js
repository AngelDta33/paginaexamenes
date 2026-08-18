// Caché de las dimensiones naturales de las imágenes del examen.
//
// Por qué existe: el paginador mide cada bloque metiéndolo un instante en un div
// oculto y leyendo su altura (ver medirAlto en paginate.js). Un <img> recién
// creado —aunque su src sea un data: URL que ya está en memoria— todavía no está
// decodificado en ese instante, así que el navegador lo mide como si no ocupara
// nada. Resultado: el paginador cree que el reactivo mide mucho menos de lo que
// mide y mete de más en la página; luego, al imprimir, ya decodificada, la imagen
// crece y el contenido se sale de la hoja (queda cortado, porque .page tiene
// overflow:hidden). Como depende de si la imagen ya se había pintado antes, el
// error aparecía "a veces" y no en todas las computadoras.
//
// La solución tiene dos partes y aquí viven las dos: precargar las imágenes antes
// de paginar y, sobre todo, guardar su tamaño natural para poder ponerle los
// atributos width/height a cada <img>. Con esos atributos el navegador conoce la
// proporción desde el primer layout, así que la mide bien aunque aún no la haya
// decodificado.

const dimensiones = new Map(); // url -> { ancho, alto }

export function dimensionesImagen(url) {
  return (url && dimensiones.get(url)) || null;
}

function cargarImagen(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const terminar = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        dimensiones.set(url, { ancho: img.naturalWidth, alto: img.naturalHeight });
      }
      resolve();
    };
    img.onload = terminar;
    img.onerror = resolve; // una imagen rota no debe atorar la vista previa
    img.src = url;
    // decode() espera a que además esté decodificada, no solo descargada; si el
    // navegador no lo soporta, onload de arriba alcanza para tener el tamaño.
    if (img.decode) img.decode().then(terminar, () => {});
  });
}

export async function precargarImagenes(urls) {
  const pendientes = [...new Set(urls)].filter((url) => url && !dimensiones.has(url));
  if (pendientes.length === 0) return;
  await Promise.all(pendientes.map(cargarImagen));
}

// Atributos width/height (en píxeles naturales) para un <img>. Se le pasan tal
// cual a el() — si todavía no se conoce el tamaño devuelve {} y el <img> se crea
// sin ellos, exactamente como antes.
export function atributosTamano(url) {
  const d = dimensionesImagen(url);
  return d ? { width: String(d.ancho), height: String(d.alto) } : {};
}
