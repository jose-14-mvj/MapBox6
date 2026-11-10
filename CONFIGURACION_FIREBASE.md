# Firebase web configurado

El archivo `app.js` contiene los valores exactos de `firebaseConfig` que el propietario copió de Firebase Console (proyecto `gpscontrol-5357a`).

Se corrigió `apiKey` respecto a una versión anterior del ZIP, en la que se habían transcrito incorrectamente tres caracteres.

No se modificaron las reglas de Realtime Database. El inicio de sesión y la sincronización todavía deben probarse con un servidor HTTPS y los permisos de Firebase configurados.

Para instalar como PWA, publica `index.html`, `app.js`, `sw.js`, `manifest.webmanifest` y la carpeta `icons` mediante HTTPS.
