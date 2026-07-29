import { readFile, writeFile } from 'node:fs/promises';

const files = [
  'src/00-core.js',
  'src/10-control-financiero.js',
  'src/20-perfil-actividad.js',
  'src/30-amigos-mensajes.js'
];

const banner = `/*
 A2C Finanzas 5.0
 Archivo generado automáticamente desde /src.
 No editar directamente.
*/\n`;

const chunks = [];
for (const file of files) {
  chunks.push(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
}
await writeFile(
  new URL('../app.bundle.js', import.meta.url),
  banner + chunks.join('\n\n'),
  'utf8'
);
console.log('app.bundle.js generado correctamente.');
