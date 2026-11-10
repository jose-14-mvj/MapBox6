'use strict';
/* GPS Control Pro: clientes autenticados, solo posición actual en vivo, rutas bajo demanda. */
const firebaseConfig = {
  apiKey: 'AIzaSyDoIeF_XG5Fg0w93XE6DRoLSMdjarr8qyY',
  authDomain: 'gpscontrol-5357a.firebaseapp.com',
  databaseURL: 'https://gpscontrol-5357a-default-rtdb.firebaseio.com',
  projectId: 'gpscontrol-5357a',
  storageBucket: 'gpscontrol-5357a.firebasestorage.app',
  messagingSenderId: '361968276149',
  appId: '1:361968276149:web:02174b1eb4887291a1e4fc'
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
mapboxgl.accessToken = 'pk.eyJ1Ijoiam9zZW1tdiIsImEiOiJjbW0zdTk2bzkwNGw0MnJweG1xajM0Z3hlIn0.-DNTYb4B6Locy9vReR8FNg';

let usuario = null;
let dispositivos = {};
let seleccionado = null;
let conectada = false;
let map = null;
let mapaListo = false;
let marcador = null;
let centrado = false;
let dibujando = false;
let puntosDibujo = [];
let puntosRuta = [];
let marcadorReproduccion = null;
let reproductor = null;
let indiceRuta = 0;
let ultimaComprobacionLimpieza = '';
let suscripciones = [];
let modoRef = null;
let modoHandler = null;
let geoRef = null;
let geoHandler = null;
let drawZonas = [];
let instalacion = null;
const OFFLINE_MS = 125000;
const $ = id => document.getElementById(id);
const ahora = () => Date.now();
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fechaUtc = ms => new Date(ms).toISOString().slice(0,10).replace(/-/g,'');
const ref = path => db.ref(`usuarios/${usuario.uid}/${path}`);

function aviso(titulo, mensaje, tipo='info') {
  const caja = document.createElement('div');
  caja.className = `notif n-${tipo}`;
  const encabezado = document.createElement('div');
  encabezado.className = 'ntitle'; encabezado.textContent = titulo;
  const texto = document.createElement('div'); texto.style.color = 'var(--dim)'; texto.textContent = mensaje;
  caja.append(encabezado, texto); $('notif-wrap').prepend(caja);
  setTimeout(() => caja.remove(), 5500);
}

$('frm-login').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('auth-correo').value.trim();
  const pass = $('auth-clave').value;
  $('auth-error').textContent = '';
  $('btn-acceder').disabled = true;
  try { await auth.signInWithEmailAndPassword(email, pass); }
  catch (err) { $('auth-error').textContent = 'No se pudo iniciar sesión: ' + (err.message || 'revisa la conexión'); }
  finally { $('btn-acceder').disabled = false; }
});
$('btn-crear').addEventListener('click', async () => {
  const email = $('auth-correo').value.trim(); const pass = $('auth-clave').value;
  $('auth-error').textContent = '';
  if (pass.length < 6) { $('auth-error').textContent = 'Contraseña de al menos 6 caracteres'; return; }
  try { await auth.createUserWithEmailAndPassword(email, pass); }
  catch (e) { $('auth-error').textContent = 'No se pudo crear la cuenta: ' + e.message; }
});
$('btn-salir').addEventListener('click', () => auth.signOut());

function suscribir(path, tipo, callback) {
  const r = ref(path); r.on(tipo, callback, error => aviso('Error Firebase', error.message, 'warn'));
  suscripciones.push(() => r.off(tipo, callback));
}
function limpiarSubs() {
  suscripciones.forEach(f => f()); suscripciones = [];
  if (modoRef && modoHandler) modoRef.off('value', modoHandler);
  if (geoRef && geoHandler) geoRef.off('value', geoHandler);
  modoRef = geoRef = modoHandler = geoHandler = null;
  db.ref('.info/connected').off();
}

function establecerDispositivo(id) {
  if (!dispositivos[id]) dispositivos[id] = {id};
  return dispositivos[id];
}
function fusionarDispositivo(snap) {
  if (!snap.exists()) return;
  const d = establecerDispositivo(snap.key);
  const sosAnterior = d.sos;
  const bateriaAnterior = d.bateria;
  Object.assign(d, snap.val() || {});
  if (d.sos === true && sosAnterior !== true) {
    aviso('🆘 SOS activado', d.nombre || d.id, 'warn');
    if ('Notification' in window && Notification.permission === 'granted')
      new Notification('SOS GPS Control',{body: (d.nombre || d.id)+' solicita ayuda'});
  }
  if (typeof d.bateria === 'number' && d.bateria >= 0 && d.bateria <= 15 &&
      (typeof bateriaAnterior !== 'number' || bateriaAnterior > 15))
    aviso('Batería baja', (d.nombre || d.id)+' tiene '+d.bateria+'%', 'warn');
  if (conectada) limpiarAntiguos();
  refrescar();
}
function fusionarPosicion(snap) {
  const d = establecerDispositivo(snap.key);
  if (!snap.exists()) { delete d.ubicacion; refrescar(); return; }
  const loc = snap.val();
  if (loc && typeof loc.latitud === 'number' && typeof loc.longitud === 'number') {
    const previo = d.ubicacion?.horaGps || 0;
    if ((loc.horaGps || 0) >= previo) d.ubicacion = loc;
  }
  refrescar();
}
function registrarEscuchas() {
  ['child_added','child_changed'].forEach(t => {
    suscribir('dispositivos', t, fusionarDispositivo);
    suscribir('ubicaciones', t, fusionarPosicion);
    suscribir('estado', t, snap => {
      const d = establecerDispositivo(snap.key);
      if (snap.val() === 'FUERA' && d.estado !== 'FUERA') alertaFuera(d);
      d.estado = snap.val(); refrescar();
    });
    suscribir('avisos', t, snap => {
      establecerDispositivo(snap.key).bloqueado = snap.val() === true; refrescar();
    });
    suscribir('comandos', t, snap => {
      establecerDispositivo(snap.key).comando = snap.val(); refrescar();
    });
  });
  suscribir('dispositivos','child_removed', snap => {
    delete dispositivos[snap.key];
    if (seleccionado === snap.key) seleccionar(null);
    refrescar();
  });
  suscribir('ubicaciones','child_removed', snap => {
    if (dispositivos[snap.key]) delete dispositivos[snap.key].ubicacion;
    refrescar();
  });
  db.ref('.info/connected').on('value', snap => {
    conectada = snap.val() === true;
    $('fb-status').textContent = conectada ? 'CONECTADO' : 'DESCONECTADO';
    $('fb-status').style.color = conectada ? 'var(--ok)' : 'var(--red)';
    refrescar();
    if (conectada) limpiarAntiguos();
  });
}

auth.onAuthStateChanged(user => {
  limpiarSubs();
  usuario = user;
  dispositivos = {};
  dispositivosLimpios.clear();
  ultimaComprobacionLimpieza = '';
  seleccionado = null;
  detenerReproduccion();
  puntosRuta = [];
  mapaListo && marcador?.remove(); marcador = null;
  drawZonas = []; limpiarMapa('gc'); limpiarMapa('dr'); limpiarMapa('ruta');
  ['btn-lock','btn-aviso','btn-unlock','btn-geo','btn-delgeo','btn-ruta','btn-exportar','btn-gpx','btn-play','slider-ruta','btn-borrar-hist','modo-select']
    .forEach(id => $(id).disabled = true);
  $('auth-screen').style.display = user ? 'none' : 'flex';
  $('btn-salir').style.display = user ? 'inline-flex' : 'none';
  $('loading').style.display = 'none';
  $('btn-instalar').hidden = !instalacion;
  $('info-usuario').textContent = user?.email || 'SIN SESIÓN';
  if (user) registrarEscuchas();
  else {
    conectada = false;
    $('fb-status').textContent = 'SIN SESIÓN';
    $('map').setAttribute('aria-label','Mapa de dispositivos autorizados');
  }
  refrescar();
});

function estado(d) {
  const last = Number(d.ultimaVez || d.ubicacion?.hora || 0);
  const online = !!conectada && d.online !== false && last > 0 && ahora() - last < OFFLINE_MS;
  return { online, gpsOff: d.gpsActivo === false, estado: d.estado || 'SIN_GEOCERCA' };
}
function tiempo(ts) {
  if (!ts) return 'sin datos';
  const s = Math.max(0, Math.floor((ahora() - Number(ts)) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s/60)} min` : `${Math.floor(s/3600)} h`;
}
function refrescar() {
  renderLista();
  actualizarInformacion();
  actualizarMarcador();
}
function renderLista() {
  const arr = Object.values(dispositivos).sort((a,b) => (b.ultimaVez || 0) - (a.ultimaVez || 0));
  $('dev-count').textContent = arr.length;
  if (!arr.length) {
    $('device-list').innerHTML = '<div class="empty">📡<div>No hay dispositivos vinculados a esta cuenta</div></div>';
    $('alert-banner').style.display = 'none'; return;
  }
  let fuera = 0;
  $('device-list').innerHTML = arr.map(d => {
    const st = estado(d);
    if (st.estado === 'FUERA') fuera++;
    const clase = !st.online ? 'st-offline' : st.estado === 'FUERA' ? 'st-fuera' : st.estado === 'OK' ? 'st-ok' : '';
    const estadoTexto = d.sos === true ? 'SOS' : !st.online ? 'SIN CONEXIÓN' : st.gpsOff ? 'GPS OFF' : st.estado === 'FUERA' ? 'FUERA' : 'ACTIVO';
    const badge = d.sos === true ? 'b-fuera' : !st.online ? 'b-off' : st.estado === 'FUERA' ? 'b-fuera' : 'b-ok';
    return `<div class="dcard ${clase} ${seleccionado === d.id ? 'sel' : ''}" data-device-id="${escapeHtml(d.id)}">
      <div class="dname">${escapeHtml(d.nombre || d.id)}</div>
      <div class="did">${escapeHtml(d.id)}</div>
      <div class="dmeta"><span class="badge ${badge}">${estadoTexto}</span><span>🔋 ${Number.isInteger(d.bateria) && d.bateria>=0?d.bateria+'%':'--'}</span>
       <span>⏱ ${tiempo(d.ultimaVez)}</span> <span>🎯 ${typeof d.ubicacion?.precision==='number'?'±'+d.ubicacion.precision.toFixed(0)+'m':'--'}</span></div>
    </div>`;
  }).join('');
  $('alert-banner').style.display = fuera ? 'block' : 'none';
  $('alert-banner').textContent = fuera ? `⚠ ${fuera} CELULAR(ES) FUERA DE ZONAS` : '';
}
$('device-list').addEventListener('click', e => {
  const card = e.target.closest('.dcard[data-device-id]');
  if (card) seleccionar(card.dataset.deviceId);
});
function seleccionar(id) {
  if (geoRef && geoHandler) geoRef.off('value', geoHandler);
  if (modoRef && modoHandler) modoRef.off('value', modoHandler);
  geoRef = modoRef = geoHandler = modoHandler = null;
  seleccionado = id;
  centrado = false;
  marcador?.remove(); marcador = null;
  detenerReproduccion();
  puntosRuta = []; dibujando = false; puntosDibujo = [];
  $('btn-geo').textContent = '📍 Nueva geocerca';
  $('geohint').style.display = 'none';
  $('btn-geo').classList.remove('on');
  const habilitado = Boolean(id);
  ['btn-lock','btn-aviso','btn-unlock','btn-geo','btn-delgeo','btn-ruta','btn-exportar','btn-gpx','btn-play','slider-ruta','btn-borrar-hist','modo-select'].forEach(key => $(key).disabled = !habilitado);
  limpiarMapa('gc'); limpiarMapa('dr'); limpiarMapa('ruta');
  if (id) {
    iniciarMapa();
    geoRef = ref(`geocercas/${id}`);
    geoHandler = snap => {
      const datos = snap.val() || {};
      drawZonas = Object.values(datos.zonas || {}).map(z => z.puntos).filter(Boolean);
      if (datos.puntos) drawZonas.push(datos.puntos);
      dibujarTodasGeocercas();
    };
    geoRef.on('value', geoHandler);
    modoRef = ref(`configuracion/${id}/modo`);
    modoHandler = snap => { $('modo-select').value = snap.val() || 'normal'; };
    modoRef.on('value', modoHandler);
  }
  refrescar();
}
function actualizarInformacion() {
  const d = dispositivos[seleccionado];
  if (!d) {
    $('infobar').innerHTML = '<div style="color:var(--dim)">Selecciona un dispositivo</div>';
    return;
  }
  const st = estado(d);
  const c = d.comando;
  const chips = [
    ['Dispositivo', d.nombre || d.id],
    ['SOS', d.sos === true ? 'ACTIVO' : '--'],
    ['Conexión', st.online ? 'EN LÍNEA' : 'SIN SEÑAL'],
    ['Batería', d.bateria >= 0 ? d.bateria + '%' : '--'],
    ['GPS', st.gpsOff ? 'APAGADO' : 'ACTIVO'],
    ['Precisión', d.ubicacion?.precision ? '±' + Number(d.ubicacion.precision).toFixed(1) + ' m' : '--'],
    ['Velocidad', (Number(d.ubicacion?.velocidad || 0) * 3.6).toFixed(1) + ' km/h'],
    ['Geocerca', st.estado],
    ['Bloqueo', c?.tipo === 'BLOQUEAR' ? c.estado || 'pendiente' : '--'],
    ['Última señal', tiempo(d.ultimaVez)]
  ];
  $('infobar').innerHTML = chips.map(([nombre, valor]) =>
    `<div class="chip"><div class="clabel">${escapeHtml(nombre)}</div><div class="cval">${escapeHtml(valor)}</div></div>`
  ).join('');
  $('last-ts').textContent = d.ubicacion?.horaGps ? `GPS: ${new Date(d.ubicacion.horaGps).toLocaleString('es')}` : '';
}
function iniciarMapa() {
  if (mapaListo || map) return;
  if (!mapboxgl.supported()) { aviso('Mapa no disponible','Tu navegador no admite WebGL','warn'); return; }
  $('map').innerHTML = '';
  map = new mapboxgl.Map({container:'map', style:'mapbox://styles/mapbox/dark-v11', center:[-68.15,-16.5], zoom:12});
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.on('load', () => {
    ['gc','dr','ruta'].forEach(id => map.addSource(id, {type:'geojson',data:vacío()}));
    map.addLayer({id:'gc-fill',source:'gc',type:'fill',paint:{'fill-color':'#00e5ff','fill-opacity':0.1}});
    map.addLayer({id:'gc-line',source:'gc',type:'line',paint:{'line-color':'#00e5ff','line-width':2}});
    map.addLayer({id:'dr-line',source:'dr',type:'line',paint:{'line-color':'#ffb300','line-width':3}});
    map.addLayer({id:'dr-point',source:'dr',type:'circle',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#ffb300','circle-radius':5}});
    map.addLayer({id:'ruta-line',source:'ruta',type:'line',paint:{'line-color':'#00e676','line-width':4}});
    map.on('click', clickMapa);
    mapaListo = true;
    dibujarTodasGeocercas(); actualizarMarcador();
  });
  map.on('error', e => console.warn('Mapbox:',e.error));
}
const vacío = () => ({type:'FeatureCollection',features:[]});
function limpiarMapa(id) { if (mapaListo && map.getSource(id)) map.getSource(id).setData(vacío()); }
function actualizarMarcador() {
  const loc = dispositivos[seleccionado]?.ubicacion;
  if (!mapaListo || !loc || !Number.isFinite(loc.latitud) || !Number.isFinite(loc.longitud)) return;
  const punto = [loc.longitud,loc.latitud];
  if (!marcador) {
    const el = document.createElement('div'); el.className = 'pin-gps';
    marcador = new mapboxgl.Marker({element:el}).setLngLat(punto).addTo(map);
  } else marcador.setLngLat(punto);
  if (!centrado) { map.easeTo({center:punto,zoom:16,duration:400}); centrado = true; }
}
function dibujarTodasGeocercas() {
  if (!mapaListo) return;
  const features = drawZonas.map(raw => {
    const puntos = (Array.isArray(raw) ? raw : Object.values(raw)).map(p => [Number(p.lng), Number(p.lat)]).filter(p=>p.every(Number.isFinite));
    if (puntos.length < 3) return null;
    return {type:'Feature',geometry:{type:'Polygon',coordinates:[[...puntos,puntos[0]]]}};
  }).filter(Boolean);
  map.getSource('gc').setData({type:'FeatureCollection',features});
}
function clickMapa(e) {
  if (!dibujando) return;
  puntosDibujo.push([e.lngLat.lng,e.lngLat.lat]);
  if (puntosDibujo.length > 100) { puntosDibujo.pop(); aviso('Límite de geocerca','Máximo 100 puntos','warn'); }
  dibujarBorrador();
}
function dibujarBorrador() {
  if (!mapaListo) return;
  const puntos = puntosDibujo.map(c => ({type:'Feature',geometry:{type:'Point',coordinates:c}}));
  if (puntosDibujo.length > 1) puntos.push({type:'Feature',geometry:{type:'LineString',coordinates:puntosDibujo}});
  map.getSource('dr').setData({type:'FeatureCollection',features:puntos});
}
$('btn-geo').addEventListener('click', async () => {
  if (!seleccionado || !mapaListo) return;
  dibujando = !dibujando;
  $('btn-geo').classList.toggle('on',dibujando);
  $('geohint').style.display = dibujando ? 'block' : 'none';
  $('btn-geo').textContent = dibujando ? '✓ Guardar geocerca' : '📍 Nueva geocerca';
  map.getCanvas().style.cursor = dibujando ? 'crosshair' : '';
  if (dibujando) { puntosDibujo = []; limpiarMapa('dr'); return; }
  if (puntosDibujo.length < 3) { aviso('No guardada','Selecciona mínimo tres puntos','warn'); limpiarMapa('dr'); return; }
  const nombre = (prompt('Nombre de la nueva geocerca (máximo 40 caracteres):','Zona') || '').trim().slice(0,40);
  if (!nombre) return;
  const id = seleccionado;
  const datos = {nombre, puntos:puntosDibujo.map(p => ({lng:p[0],lat:p[1]})), creada: firebase.database.ServerValue.TIMESTAMP};
  try { await ref(`geocercas/${id}/zonas`).push(datos); aviso('Geocerca guardada',nombre,'ok'); }
  catch (e) { aviso('Error guardando geocerca',e.message,'warn'); }
  limpiarMapa('dr');
});
$('btn-delgeo').addEventListener('click', async () => {
  if (!seleccionado || !confirm('¿Borrar TODAS las geocercas de este celular?')) return;
  try { await ref(`geocercas/${seleccionado}`).remove(); aviso('Geocercas eliminadas','No afecta a otros dispositivos','ok'); }
  catch (e) { aviso('Error',e.message,'warn'); }
});
$('btn-unlock').addEventListener('click', async () => {
  if (!seleccionado) return;
  try { await ref(`avisos/${seleccionado}`).set(false); aviso('Aviso retirado','No desbloquea el PIN de Android','ok'); }
  catch (e) { aviso('Error',e.message,'warn'); }
});
$('btn-aviso').addEventListener('click', async () => {
  if (!seleccionado) return;
  try { await ref(`avisos/${seleccionado}`).set(true); aviso('Aviso enviado','El teléfono lo mostrará dentro de la app','ok'); }
  catch(e) { aviso('Error',e.message,'warn'); }
});
$('btn-lock').addEventListener('click', async () => {
  if (!seleccionado || !conectada) { aviso('Sin conexión','No se enviarán comandos cuando no hay internet','warn'); return; }
  if (!confirm('¿Bloquear ahora la pantalla de este celular autorizado? Debe tener activado el permiso Device Admin y el bloqueo remoto en su app.')) return;
  const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  const creado = ahora();
  const comando = {id, tipo:'BLOQUEAR', creado, expira: creado+60000, estado:'pendiente'};
  try { await ref(`comandos/${seleccionado}`).set(comando); aviso('Orden enviada','Esperando confirmación del teléfono (máximo 60 segundos)','info'); }
  catch(e) { aviso('Error al enviar bloqueo',e.message,'warn'); }
});
$('modo-select').addEventListener('change', async e => {
  if (!seleccionado) return;
  try { await ref(`configuracion/${seleccionado}/modo`).set(e.target.value); aviso('Modo de GPS actualizado',e.target.value,'ok'); }
  catch(err) { aviso('Error actualizando modo',err.message,'warn'); }
});

$('btn-ruta').addEventListener('click', cargarRuta);
$('btn-exportar').addEventListener('click', exportarCsv);
$('btn-borrar-hist').addEventListener('click', async () => {
  if (!seleccionado || !confirm('¿Borrar TODO el historial del celular seleccionado?')) return;
  try {
    await Promise.all([
      ref(`historial/${seleccionado}`).remove(),
      ref(`diasHistorial/${seleccionado}`).remove()
    ]);
    detenerReproduccion();
    puntosRuta = []; limpiarMapa('ruta'); $('ruta-datos').textContent = 'Historial eliminado';
    aviso('Historial eliminado','Se mantiene la ubicación actual','ok');
  } catch (e) { aviso('Error al borrar',e.message,'warn'); }
});
function rad(x) { return x * Math.PI / 180; }
function metros(a,b) {
  const R = 6371000, deltaLat = rad(b.latitud-a.latitud), deltaLon = rad(b.longitud-a.longitud);
  const v = Math.sin(deltaLat/2)**2 + Math.cos(rad(a.latitud))*Math.cos(rad(b.latitud))*Math.sin(deltaLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(v)));
}
async function cargarRuta() {
  if (!seleccionado) return;
  const dia = $('dia-ruta').value.replace(/-/g,'');
  if (!/^\d{8}$/.test(dia)) { aviso('Selecciona fecha','Elige primero un día UTC','warn'); return; }
  $('ruta-datos').textContent = 'Cargando ruta...';
  const id = seleccionado;
  try {
    // Solo un día y un máximo de 600 puntos: evita descargar toda la base.
    const snap = await ref(`historial/${id}/${dia}`).orderByKey().limitToLast(600).once('value');
    if (seleccionado !== id) return;
    detenerReproduccion();
    puntosRuta = Object.values(snap.val() || {}).filter(p =>
      typeof p.latitud==='number' && typeof p.longitud==='number').sort((a,b)=>a.horaGps-b.horaGps);
    const coords = puntosRuta.map(p => [p.longitud,p.latitud]);
    indiceRuta=0;
    $('slider-ruta').max = Math.max(0,puntosRuta.length-1);
    $('slider-ruta').value=0;
    $('slider-ruta').disabled=puntosRuta.length===0;
    $('btn-play').disabled=puntosRuta.length<2;
    $('btn-gpx').disabled=puntosRuta.length===0;
    if (mapaListo) map.getSource('ruta').setData(coords.length>1 ? {
      type:'FeatureCollection', features:[{type:'Feature',geometry:{type:'LineString',coordinates:coords}}]
    } : vacío());
    let dist=0; for(let i=1;i<puntosRuta.length;i++) dist+=metros(puntosRuta[i-1],puntosRuta[i]);
    $('ruta-datos').textContent = `${puntosRuta.length} puntos · ${(dist/1000).toFixed(2)} km · día UTC ${dia}`;
    if (coords.length>1) {
      const bounds = coords.reduce((b,p)=>b.extend(p),new mapboxgl.LngLatBounds(coords[0],coords[0]));
      map.fitBounds(bounds,{padding:70,maxZoom:17}); centrado = true;
    }
  } catch(e) { $('ruta-datos').textContent='Error de consulta'; aviso('Error historial',e.message,'warn'); }
}
function exportarCsv() {
  if (!puntosRuta.length) { aviso('Sin ruta','Primero carga un historial de fecha','warn'); return; }
  const lineas = ['horaGps,latitud,longitud,precision,velocidad_kmh',...puntosRuta.map(p=>
    [p.horaGps,p.latitud,p.longitud,p.precision||0,((p.velocidad||0)*3.6).toFixed(1)].join(','))];
  const link = document.createElement('a');
  link.href=URL.createObjectURL(new Blob([lineas.join('\n')],{type:'text/csv;charset=utf-8'}));
  link.download=`ruta-${$('dia-ruta').value}-${seleccionado}.csv`;
  link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
function posicionRuta(n) {
  if (!puntosRuta.length || !mapaListo) return;
  indiceRuta=Math.min(puntosRuta.length-1,Math.max(0,Number(n)||0));
  const p = puntosRuta[indiceRuta];
  const coords=[p.longitud,p.latitud];
  if (!marcadorReproduccion) {
    const el=document.createElement('div');
    el.className='pin-gps'; el.style.background='#ffb300';
    marcadorReproduccion=new mapboxgl.Marker({element:el}).setLngLat(coords).addTo(map);
  } else marcadorReproduccion.setLngLat(coords);
  $('slider-ruta').value=indiceRuta;
  $('ruta-datos').textContent=`Punto ${indiceRuta+1}/${puntosRuta.length} · ${new Date(p.horaGps).toLocaleString('es')}`;
}
function detenerReproduccion() {
  if (reproductor) { clearInterval(reproductor); reproductor=null; }
  if (marcadorReproduccion) { marcadorReproduccion.remove(); marcadorReproduccion=null; }
  $('btn-play').textContent='▶ Reproducir';
}
$('btn-play').addEventListener('click', ()=> {
  if (reproductor) {
    clearInterval(reproductor); reproductor=null;
    $('btn-play').textContent='▶ Continuar'; return;
  }
  if (puntosRuta.length<2) return;
  if (indiceRuta>=puntosRuta.length-1) indiceRuta=0;
  $('btn-play').textContent='⏸ Pausar';
  reproductor=setInterval(()=> {
    if (indiceRuta>=puntosRuta.length-1) { detenerReproduccion(); return; }
    posicionRuta(indiceRuta+1);
  },350);
});
$('slider-ruta').addEventListener('input',e=>posicionRuta(e.target.value));
$('btn-gpx').addEventListener('click',()=> {
  if (!puntosRuta.length) return;
  const xml=['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="GPS Control Pro" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Recorrido</name><trkseg>',
    ...puntosRuta.map(p=>`<trkpt lat="${Number(p.latitud)}" lon="${Number(p.longitud)}"><time>${new Date(p.horaGps).toISOString()}</time></trkpt>`),
    '</trkseg></trk></gpx>'].join('\n');
  const blob=URL.createObjectURL(new Blob([xml],{type:'application/gpx+xml'}));
  const a=document.createElement('a');a.href=blob;a.download=`ruta-${$('dia-ruta').value}.gpx`;
  a.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
});

// Limpieza liviana de días vencidos (>14 días), usa índice de días, NUNCA rutas completas.
const dispositivosLimpios = new Set();
async function limpiarUno(id) {
  if (!usuario || !conectada || dispositivosLimpios.has(id)) return 0;
  dispositivosLimpios.add(id);
  const limite = fechaUtc(ahora() - 14*86400000);
  let borradas=0;
  const snap = await ref(`diasHistorial/${id}`).orderByKey().endAt(limite).limitToFirst(25).once('value');
  const cambios = {};
  Object.keys(snap.val() || {}).forEach(dia => {
    if (dia < limite) {
      cambios[`historial/${id}/${dia}`] = null;
      cambios[`diasHistorial/${id}/${dia}`] = null;
      borradas++;
    }
  });
  if (borradas) await ref('').update(cambios);
  return borradas;
}
async function limpiarAntiguos() {
  if (!usuario || !conectada) return;
  const key = `${usuario.uid}-${fechaUtc(ahora())}`;
  if (ultimaComprobacionLimpieza !== key) {
    ultimaComprobacionLimpieza = key;
    dispositivosLimpios.clear();
  }
  for (const id of Object.keys(dispositivos)) {
    try { await limpiarUno(id); } catch(e) { dispositivosLimpios.delete(id); console.warn('Limpieza',e); }
  }
  $('ruta-retencion').textContent = 'Retención automática: 14 días';
}
async function ejecutarLimpiezaManual() {
  if (!usuario || !conectada) return;
  dispositivosLimpios.clear();
  let borradas=0;
  for (const id of Object.keys(dispositivos)) borradas+=await limpiarUno(id);
  aviso('Limpieza realizada',`${borradas} días antiguos eliminados`,'ok');
}
$('btn-limpiar').addEventListener('click', ()=>ejecutarLimpiezaManual().catch(e=>aviso('Error limpieza',e.message,'warn')));

let ultimoAlerta = {};
function alertaFuera(d) {
  if (ahora()-(ultimoAlerta[d.id]||0)<60000) return;
  ultimoAlerta[d.id]=ahora();
  aviso('Fuera de geocerca',d.nombre||d.id,'warn');
  if ('Notification' in window && Notification.permission==='granted')
    new Notification('Geocerca GPS Control',{body:(d.nombre||d.id)+' salió de zona'});
}
$('btn-notif').addEventListener('click', async () => {
  if ('Notification' in window) {
    const perm=await Notification.requestPermission();
    aviso('Notificaciones',perm==='granted'?'Activadas para alertas con la web abierta':'Permiso no concedido');
  }
});

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); instalacion=e; $('btn-instalar').hidden=false;
});
$('btn-instalar').addEventListener('click', async ()=> {
  if (!instalacion) { aviso('Instalación','Usa el menú de Chrome → Instalar aplicación'); return; }
  instalacion.prompt(); await instalacion.userChoice;
  instalacion=null; $('btn-instalar').hidden=true;
});
window.addEventListener('appinstalled',()=>{ instalacion=null; $('btn-instalar').hidden=true; });
if ('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service worker',err));
}
$('dia-ruta').value = new Date().toISOString().slice(0,10);
setInterval(()=>refrescar(),15000);
