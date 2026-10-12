// poseViewer.ts — live 3D viewer for the Qwen 2.1 POSE mode's "Preview & Angle": shows the SAM3D-Body GLB in the
// Pose Image area, lets the user orbit / zoom / pan, and captures the current view as the final pose image.
// Port of ComfyUI-TJ_NODE_STUDIO_ONE/web/shared/pose_viewer.js (node 6e11eae, 460eee9, 2cd9e97, b6807b6).
// three.js (r170) is loaded on first use, not at page load. Plain look: black background, no grid, the GLB's own
// material, soft lights.

const BOX = 192;   // same card size as the image upload cards

type Three = typeof import("three");
let three: { THREE: Three; GLTFLoader: any; OrbitControls: any } | null = null;
async function loadThree() {
  if (!three) {
    const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
      import("three"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ]);
    three = { THREE, GLTFLoader, OrbitControls };
  }
  return three;
}

export interface PoseCamera { position: [number, number, number]; target: [number, number, number] }
export interface PoseViewer {
  el: HTMLElement;
  load(url: string): Promise<void>;
  setAspect(a: number): void;
  getCamera(): PoseCamera;
  setCamera(c: PoseCamera): void;
  resetView(): void;
  capture(longEdge?: number): string;
  dispose(): void;
}

/** `el` is a square card that keeps the image-card look; the canvas (the result's aspect) sits centered in it. */
export async function createPoseViewer({ aspect = 1, onCameraChange }: { aspect?: number; onCameraChange?: (c: PoseCamera) => void } = {}): Promise<PoseViewer> {
  const { THREE, GLTFLoader, OrbitControls } = await loadThree();

  const el = document.createElement("div");
  Object.assign(el.style, { position: "relative", width: `${BOX}px`, height: `${BOX}px`, maxWidth: "100%", margin: "0 auto", boxSizing: "border-box", background: "#2b2b2b", border: "1px solid #2a2a2a", borderRadius: "10px", overflow: "hidden", touchAction: "none" });
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  Object.assign(renderer.domElement.style, { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" });
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-3, 1, -2); scene.add(fill);

  const camera = new THREE.PerspectiveCamera(30, aspect, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  // The page under the viewer must not also zoom / scroll while the viewer is used.
  for (const ev of ["wheel", "pointerdown", "mousedown", "dblclick", "contextmenu"]) el.addEventListener(ev, (e) => e.stopPropagation());
  el.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });

  let mixer: any = null, root: any = null, home: PoseCamera | null = null;
  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);
  controls.addEventListener("end", () => onCameraChange?.(getCamera()));

  function fit() {
    const box = new THREE.Box3().setFromObject(root, true);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const dist = (Math.max(size.y, size.x / camera.aspect) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2 + size.z / 2;
    home = { position: [center.x, center.y, center.z + dist], target: [center.x, center.y, center.z] };
    camera.near = dist / 100; camera.far = dist * 100; camera.updateProjectionMatrix();
  }

  function setCamera(c: PoseCamera) {
    camera.position.set(...c.position); controls.target.set(...c.target);
    camera.updateProjectionMatrix(); controls.update(); render();
  }
  function getCamera(): PoseCamera {
    return { position: camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number] };
  }

  function setAspect(a: number) {
    aspect = a || 1;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    resize();
  }
  function resize() {
    const side = Math.min(el.clientWidth, el.clientHeight);
    if (!side) return;
    const w = Math.round(aspect >= 1 ? side : side * aspect), h = Math.round(aspect >= 1 ? side / aspect : side);
    renderer.setSize(w, h);
    render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  async function load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    if (root) scene.remove(root);
    root = gltf.scene;
    scene.add(root);
    if (gltf.animations.length) {            // the pose is the animation's frame 0, not the bind pose
      mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(gltf.animations[0]).play();
      mixer.setTime(0);
    }
    root.updateMatrixWorld(true);
    fit();
    setCamera(home!);
  }

  function capture(longEdge = 1536): string {
    const w = aspect >= 1 ? longEdge : Math.round(longEdge * aspect), h = aspect >= 1 ? Math.round(longEdge / aspect) : longEdge;
    const pr = renderer.getPixelRatio();
    renderer.setPixelRatio(1); renderer.setSize(w, h);
    render();
    const dataUrl = renderer.domElement.toDataURL("image/png");
    renderer.setPixelRatio(pr); resize();
    return dataUrl;
  }

  function dispose() {
    ro.disconnect(); controls.dispose(); renderer.dispose(); el.remove();
  }

  setAspect(aspect);
  return { el, load, setAspect, getCamera, setCamera, resetView: () => home && setCamera(home), capture, dispose };
}
