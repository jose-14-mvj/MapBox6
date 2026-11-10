# Firebase web configurado

Se actualizó `app.js` con el objeto `firebaseConfig` de la app web **GPS Control Pro Web**, según la captura de Firebase Console.

**Antes de publicar:** selecciona la opción **Config** en Firebase y comprueba que los campos `apiKey` y `appId` coinciden exactamente con la consola. La configuración se transcribió desde una captura, por lo que es importante verificarla.

Los datos actuales de Realtime Database no fueron modificados. No publiques reglas nuevas hasta completar las pruebas de autenticación y acceso.

Para instalar esta web como PWA, súbela a Hosting HTTPS con los archivos `index.html`, `app.js`, `sw.js`, `manifest.webmanifest` y carpeta `icons`.
