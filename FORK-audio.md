# Audio en «compartir pantalla»: detalle técnico

Notas de desarrollo del cambio de la rama `audio-pantalla` (ver [FORK.md](FORK.md)). Las sondas que se citan son
herramientas del entorno del autor y no se publican.


Añade captura de audio al «compartir pantalla» de
[CastLab](https://codeberg.org/tom79/CastLab). Su emisor envía un MPEG-TS que
solo contiene vídeo — el PMT declara un único stream elemental, H.264 en el
PID 0x100 — así que al castear la pantalla no llega ningún sonido.

### Qué cambia

| Archivo | Cambio |
|---|---|
| `AudioEncoder.kt` *(nuevo)* | Captura el audio de reproducción con `AudioPlaybackCaptureConfiguration` sobre la misma `MediaProjection` y lo codifica a AAC-LC, entregando frames ADTS |
| `TsMuxer.kt` | Segundo elementary stream (AAC en PID 0x101), PMT con longitud de sección calculada, PES de audio, PCR real sobre el PID de vídeo y entradas `@Synchronized` |
| `ScreenEncoder.kt` | El `TsMuxer` pasa a inyectarse, para compartirlo con el encoder de audio |
| `ScreenCaptureService.kt` | Arranca y para el encoder de audio junto al de vídeo |
| `ScreenShareModule.kt` | Pide `RECORD_AUDIO` antes del diálogo de captura |
| `app.plugin.js` | Declara `RECORD_AUDIO` en el manifest |

El PMT solo anuncia el stream de audio si la captura arrancó de verdad: sin
`RECORD_AUDIO`, o en Android 9 o anterior, sigue saliendo un TS de solo vídeo
idéntico al original.

### Volumen y captura

`AudioPlaybackCapture` **no** se ve afectado por el volumen del teléfono: la
atenuación se aplica en la ruta de salida, después del punto de captura. Se
puede dejar el teléfono en silencio y el cast sigue saliendo a nivel pleno.

Comprobado desmontando AudioRelay 0.26.1, que consigue exactamente eso: usa la
misma API con los mismos `addMatchingUsage` (MEDIA, UNKNOWN, GAME), sin ningún
permiso extra ni compensación de ganancia sobre el PCM.

Si el cast baja de volumen al tocar el del teléfono, mirar el camino DLNA
—`RenderingControl::SetVolume`— antes que la captura.

La captura mantiene una cadencia propia y rellena con silencio si el sistema
deja de entregar audio. Sin eso, el receptor —que engancha su reloj a la pista
de audio— congela la imagen en cuanto el audio se corta. AudioRelay tiene la
misma pieza, bajo el nombre «Enable continuous audio capture».

### Escritura concurrente al stream

Desde que hay audio, vídeo y audio empujan al mismo `OutputStream` desde hilos
distintos. `StreamHttpServer.pushData` escribía sin lock, así que dos
escrituras se entrelazaban dentro del mismo chunk HTTP y rompían el framing:
el receptor perdía el vídeo —los frames grandes se trocean en muchos paquetes
y se destrozan primero— mientras el audio seguía llegando, y cortaba la
reproducción a los pocos segundos. `pushData` es ahora `@Synchronized`.

una sonda de desarrollo lo demuestra en la JVM: sin sincronizar sobreviven
1 de 400 chunks; sincronizado, los 400.

### Sincronía entre audio y vídeo

El PTS del audio se derivaba del número de muestras acumuladas desde el
arranque. Parecía lo más limpio, pero el contador corre también mientras se
rellena silencio esperando a que la captura entregue las primeras muestras:
ese adelanto —1,2 s medidos con una sonda de desarrollo— se queda fijo en
todo el audio posterior y se oye como desincronía constante.

Ahora el sello sale del reloj monotónico, el mismo del que vienen los
timestamps del surface de vídeo, así que las dos pistas comparten origen de
verdad.

El encoder de vídeo pide además prioridad de tiempo real (`KEY_PRIORITY=0`),
baja latencia explícita (`KEY_LATENCY=1`, Android 11+) y emite un keyframe por
segundo en vez de cada dos: hasta que llega uno el receptor no puede mostrar
nada, así que ese intervalo es el suelo de la latencia al conectar.

### El audio marca el ritmo del receptor

El receptor se guía por la pista de audio para decidir cuándo mostrar cada
cuadro, así que el emisor tiene que entregar audio al ritmo del reloj. El
bucle de captura reajustaba su plazo cada vez que una vuelta se pasaba de
tiempo, regalando ese margen: medido con una sonda de desarrollo,
salían 10,53 s de audio por cada 12,01 s reales —un 12 % lento—, y el
receptor acumulaba unos 2 s de retraso cada 20 s sin recuperarlos nunca. Esa
era la latencia que se percibía, no el codificador.

Ahora el plazo solo se reajusta ante un atraso desmedido (medio segundo, que
solo ocurre si el proceso estuvo parado); el resto se recupera sin dormir.

Con la pantalla quieta este codificador no emite un solo cuadro —ignora
`KEY_REPEAT_PREVIOUS_FRAME_AFTER`—, cosa que conviene saber al depurar: una
captura del stream en reposo trae solo audio, y no significa que el vídeo
esté roto.

### Limitación del sistema

`AudioPlaybackCapture` solo graba apps que permiten ser capturadas. Las que se
marcan como no capturables — la mayoría de reproductores con DRM — quedan
fuera de la mezcla en silencio. No es algo que el parche pueda sortear.


### Verificación

una sonda de desarrollo compila el `TsMuxer` parcheado en la JVM — no usa
ninguna API de Android — le mete H.264 y AAC reales, y comprueba con `ffprobe`
que el TS declara los dos streams y decodifica sin errores, en los dos modos.
