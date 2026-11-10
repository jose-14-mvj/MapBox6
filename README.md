# MapBox6 GPS Control Pro (PWA)

Panel web instalable para celulares autorizados. **No basta con copiar index.html:** publica todos estos archivos juntos.

## Publicar

1. Activa Firebase Authentication por correo/contraseña y agrega tu dominio en Authorized domains.
2. Registra una app **Web** en Firebase Console y copia el `appId` web correcto al objeto `firebaseConfig` de `app.js` (la configuración antigua tenía ID Android).
3. Aplica las reglas incluidas en `../firebase.database.rules.json` a Firebase Realtime Database, previa copia de seguridad.
4. Publica `index.html`, `app.js`, `sw.js`, `manifest.webmanifest` e `icons` por **HTTPS** (GitHub Pages o Firebase Hosting).
5. En Chrome Android: menú > Instalar aplicación. En Chrome/Edge Windows: Instalar desde la barra.
6. Abre también la app Android GPScontrol2, e inicia sesión con la **misma cuenta**.

## Funciones

Panel multidispositivo, estado GPS y batería, alertas SOS y geocerca, avisos, bloqueo de pantalla vía Device Admin autorizado en el teléfono, modo GPS ajustable, geocercas múltiples, historial por día UTC, reproducción y exportación CSV/GPX. Limpieza de historial por índice de días (14 días).

La PWA no recibe ubicación nueva ni bloquea el teléfono estando sin conexión. Las notificaciones web aquí solo se emiten con el panel abierto, no son push en segundo plano. El bloqueo no modifica ni elimina el PIN de Android.

Consulta `../INSTRUCCIONES_INSTALACION_Y_PRUEBAS.md` para todos los pasos, limitaciones y pruebas.
