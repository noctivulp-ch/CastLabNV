# CastLabNV — fork de CastLab

Fork de [CastLab](https://codeberg.org/tom79/CastLab), de Thomas Schneider (tom79), publicado bajo
la misma licencia: **GPL-3.0**. Todo el historial del original se conserva tal cual. Los cambios
de este fork están en la rama `audio-pantalla`, encima de una versión publicada del original.

*Fork of CastLab by tom79 (GPL-3.0). It adds playback audio to screen sharing. The changes live on
the `audio-pantalla` branch; upstream history is untouched.*

## Qué cambia (aviso de modificación, GPL-3.0 §5a)

Modificado por **NoctiVulp** a partir del 2026-09 (fecha de este aviso: 2026-10-21).

- **Audio en «compartir pantalla».** El original emite un MPEG-TS de solo vídeo. Aquí se captura
  el audio de reproducción (`AudioPlaybackCaptureConfiguration` sobre la misma `MediaProjection`),
  se codifica a AAC-LC y va en el mismo TS, como segundo stream (PID 0x101).
- `TsMuxer`: PMT con dos streams, PCR real y escritura sincronizada.
- `StreamHttpServer.pushData` sincronizado: con audio y vídeo escribiendo desde hilos distintos,
  el framing HTTP se rompía.
- El PTS del audio sale del reloj monotónico, el mismo del vídeo. El ritmo de captura no se
  atrasa. El encoder de vídeo pide baja latencia y un keyframe por segundo.
- Sin `RECORD_AUDIO`, o en Android 9 o anterior, sale el mismo TS de solo vídeo que el original.

Desde la 1.6.0, el original trae su propio modo de **compartir solo audio** (issues #34 y #43),
distinto de este: ese modo no añade audio a compartir pantalla. Unir los dos sobre la 1.6.0 está
pendiente.

Detalle técnico: [FORK-audio.md](FORK-audio.md).

## Estado

- Base actual: CastLab **1.5.0**.
- Pendiente: rebase sobre la 1.6.0, nombre propio («CastLabNV») y `applicationId` propio
  (`ch.noctivulp.castlab`), para poder tenerla instalada junto a la oficial. Después, releases
  con APK.

## Créditos

CastLab es obra de Thomas Schneider y de sus colaboradores y traductores. Si te gusta, apoya al
autor original: <https://liberapay.com/tom79/donate>.
