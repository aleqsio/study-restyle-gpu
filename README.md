# Study restyle planner, on TypeGPU Kit

The [study restyle planner](https://github.com/aleqsio/study-restyle) rewritten to draw with
[TypeGPU Kit](https://reczkok.github.io/typegpu-kit/) and WebGPU instead of three.js.

Live: https://aleqsio.github.io/study-restyle-gpu/ (needs a WebGPU browser: recent Chrome, Edge or Safari)

- `src/glb.ts` reads the Blender model (`public/room.json`, a gzipped binary glTF) keeping every node's extras.
- `src/world.ts` cuts each template into chunks that show, move and draw together, with a material index per vertex.
- `src/gpu.ts` is the kit scene: one mesh pool, instance sets with a custom kind that reads a material table
  and a texture array of generated woods, point lights with a shadow from the ceiling light, ACES in the final
  pass, and kit `lines` for the gizmo and selection box.
- `src/pieces.ts` places planner objects as instance rows and lamp lights, and does CPU picking.
- `src/camera.ts` and `src/gizmo.ts` replace OrbitControls and TransformControls.
- `src/app.js` is the planner itself: settings, objects, links and panels, unchanged from the three.js version.

```sh
pnpm install
pnpm dev
```
