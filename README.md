# RTT Target Clear

CQB-shooter voor de telefoon, afgespeeld in de hal van **Running The Target** in Zoeterwoude.
Speelt direct in de browser (Safari/Chrome) en kan als app op het beginscherm.

**Spelen:** https://rafaelrtt-beep.github.io/rtt-target-clear/

## Levels
1. **Kwalificatie**: shoot/no-shoot-parcours met kartonnen IPSC-schijven, draaischijven en stalen poppers. Tijd + strafseconden.
2. **Huiszoeking**: woning met behangkamers, verdachten die terugschieten en burgers die je moet sparen.
3. **Entresol**: rook in de hal, schutters op de entresol, trap op en een gijzeling als finale.

## Besturing
- **Telefoon:**
  - Tik op het scherm om op de crosshair te schieten.
  - Kantel je telefoon als een stuur naar links of rechts om te leunen en om een hoek te peeken.
  - Links slepen om te lopen, rechts slepen om te richten.
  - Vuurknop ingedrukt houden voor automatisch vuur.
  - Knoppen voor vizier, herladen en hurken.
  - Bij Instellingen kies je "schiet waar je tikt" en zet je kantelen om of uit.
- **Mac/pc:** WASD lopen, muis kijken, linkerknop vuren, rechterknop richten, Q/E leunen, R herladen, C hurken, Esc pauze.

## Techniek
Three.js (WebGL 2) met PBR-materialen, realtime schaduwen, ACES-tonemapping, MSAA, bloom en een eigen grading-pass.
Alle textures (multiplex, stenen behang, beton, schijven) en alle geluiden worden procedureel in de browser gemaakt.
De figuren zijn skinned meshes (1 draw call per figuur), zodat het vloeiend loopt op de telefoon.

- `src/`: broncode (ES-modules, zonder bouwstap te draaien via `tools/devserver.py`)
- `docs/`: gebouwde versie voor GitHub Pages (`node tools/build.mjs <pad-naar-esbuild>`)
- Levels aanpassen: `src/levels.js` (raster van 1,34 m, gelijk aan de RTT-panelen)
