import * as THREE from 'three';

export interface ProceduralTextureSet {
  tableMap: THREE.CanvasTexture;
  tableRoughnessMap: THREE.CanvasTexture;
  tableBumpMap: THREE.CanvasTexture;
  floorMap: THREE.CanvasTexture;
  floorRoughnessMap: THREE.CanvasTexture;
  floorBumpMap: THREE.CanvasTexture;
  gunMetalBumpMap: THREE.CanvasTexture;
  gunMetalRoughnessMap: THREE.CanvasTexture;
  woodGripMap: THREE.CanvasTexture;
  woodGripBumpMap: THREE.CanvasTexture;
  cloakBumpMap: THREE.CanvasTexture;
  smokeSpriteMap: THREE.CanvasTexture;
  dispose: () => void;
}

// Deterministic fast PRNG for crisp reproducible procedural grain
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createProceduralTextureSet(): ProceduralTextureSet {
  const rand = mulberry32(133742);

  // 1. Worn Dark Oak & Charred Steel Tabletop (512x512)
  const [tableColCanvas, tableColCtx] = makeCanvas(512, 512);
  const [tableRoughCanvas, tableRoughCtx] = makeCanvas(512, 512);
  const [tableBumpCanvas, tableBumpCtx] = makeCanvas(512, 512);

  tableColCtx.fillStyle = '#1f1613';
  tableColCtx.fillRect(0, 0, 512, 512);
  tableRoughCtx.fillStyle = '#d4d4d4';
  tableRoughCtx.fillRect(0, 0, 512, 512);
  tableBumpCtx.fillStyle = '#808080';
  tableBumpCtx.fillRect(0, 0, 512, 512);

  // Plank seams & subtle wood fibers
  const plankCount = 6;
  const plankH = 512 / plankCount;
  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    const shadeDelta = Math.floor((rand() - 0.5) * 10);
    tableColCtx.fillStyle = `rgb(${31 + shadeDelta}, ${22 + Math.floor(shadeDelta * 0.7)}, ${19 + Math.floor(shadeDelta * 0.6)})`;
    tableColCtx.fillRect(0, y0, 512, plankH);

    // Fine wood grain lines
    for (let i = 0; i < 65; i++) {
      const gy = y0 + rand() * plankH;
      const alpha = 0.08 + rand() * 0.16;
      const dark = rand() > 0.35;
      tableColCtx.strokeStyle = dark ? `rgba(10,6,5,${alpha})` : `rgba(62,45,38,${alpha * 0.7})`;
      tableColCtx.lineWidth = 1 + rand() * 2;
      tableColCtx.beginPath();
      tableColCtx.moveTo(0, gy);
      const wave = (rand() - 0.5) * 8;
      tableColCtx.bezierCurveTo(170, gy + wave, 340, gy - wave, 512, gy);
      tableColCtx.stroke();

      tableBumpCtx.strokeStyle = dark ? `rgba(90,90,90,${alpha})` : `rgba(165,165,165,${alpha * 0.8})`;
      tableBumpCtx.lineWidth = 1 + rand() * 1.5;
      tableBumpCtx.beginPath();
      tableBumpCtx.moveTo(0, gy);
      tableBumpCtx.bezierCurveTo(170, gy + wave, 340, gy - wave, 512, gy);
      tableBumpCtx.stroke();

      tableRoughCtx.strokeStyle = dark ? `rgba(235,235,235,${alpha})` : `rgba(175,175,175,${alpha})`;
      tableRoughCtx.lineWidth = 1.5;
      tableRoughCtx.beginPath();
      tableRoughCtx.moveTo(0, gy);
      tableRoughCtx.lineTo(512, gy);
      tableRoughCtx.stroke();
    }

    // Plank seam crevice
    tableColCtx.fillStyle = 'rgba(5, 3, 3, 0.75)';
    tableColCtx.fillRect(0, y0, 512, 2.5);
    tableBumpCtx.fillStyle = 'rgb(28, 28, 28)';
    tableBumpCtx.fillRect(0, y0, 512, 3);
    tableRoughCtx.fillStyle = 'rgb(250, 250, 250)';
    tableRoughCtx.fillRect(0, y0, 512, 3);
  }

  // Worn center sheen & subtle scratches / grime rings on tabletop
  const centerWear = tableRoughCtx.createRadialGradient(256, 256, 20, 256, 256, 230);
  centerWear.addColorStop(0, 'rgba(130, 130, 130, 0.38)');
  centerWear.addColorStop(1, 'rgba(230, 230, 230, 0.0)');
  tableRoughCtx.fillStyle = centerWear;
  tableRoughCtx.fillRect(0, 0, 512, 512);

  for (let s = 0; s < 48; s++) {
    const sx = rand() * 512;
    const sy = rand() * 512;
    const ang = rand() * Math.PI * 2;
    const len = 12 + rand() * 48;
    const ex = sx + Math.cos(ang) * len;
    const ey = sy + Math.sin(ang) * len;

    tableColCtx.strokeStyle = 'rgba(72, 54, 46, 0.22)';
    tableColCtx.lineWidth = 1;
    tableColCtx.beginPath();
    tableColCtx.moveTo(sx, sy);
    tableColCtx.lineTo(ex, ey);
    tableColCtx.stroke();

    tableBumpCtx.strokeStyle = 'rgba(55, 55, 55, 0.45)';
    tableBumpCtx.lineWidth = 1;
    tableBumpCtx.beginPath();
    tableBumpCtx.moveTo(sx, sy);
    tableBumpCtx.lineTo(ex, ey);
    tableBumpCtx.stroke();
  }

  // 2. Industrial Concrete Floor (512x512)
  const [floorColCanvas, floorColCtx] = makeCanvas(512, 512);
  const [floorRoughCanvas, floorRoughCtx] = makeCanvas(512, 512);
  const [floorBumpCanvas, floorBumpCtx] = makeCanvas(512, 512);

  floorColCtx.fillStyle = '#0d0b0c';
  floorColCtx.fillRect(0, 0, 512, 512);
  floorRoughCtx.fillStyle = '#dedede';
  floorRoughCtx.fillRect(0, 0, 512, 512);
  floorBumpCtx.fillStyle = '#808080';
  floorBumpCtx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 900; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 1 + rand() * 7;
    const bright = rand() > 0.5;
    floorColCtx.fillStyle = bright ? 'rgba(28,24,25,0.22)' : 'rgba(4,3,3,0.35)';
    floorColCtx.fillRect(x, y, r, r);

    floorBumpCtx.fillStyle = bright ? 'rgba(160,160,160,0.25)' : 'rgba(85,85,85,0.3)';
    floorBumpCtx.fillRect(x, y, r, r);

    floorRoughCtx.fillStyle = bright ? 'rgba(240,240,240,0.25)' : 'rgba(150,150,150,0.22)';
    floorRoughCtx.fillRect(x, y, r * 1.4, r * 1.4);
  }

  // Subtle concrete slab grid lines
  floorColCtx.strokeStyle = 'rgba(3, 2, 2, 0.7)';
  floorColCtx.lineWidth = 2;
  floorBumpCtx.strokeStyle = 'rgba(40, 40, 40, 0.8)';
  floorBumpCtx.lineWidth = 2;
  for (let g = 0; g < 512; g += 128) {
    floorColCtx.beginPath();
    floorColCtx.moveTo(g, 0);
    floorColCtx.lineTo(g, 512);
    floorColCtx.moveTo(0, g);
    floorColCtx.lineTo(512, g);
    floorColCtx.stroke();

    floorBumpCtx.beginPath();
    floorBumpCtx.moveTo(g, 0);
    floorBumpCtx.lineTo(g, 512);
    floorBumpCtx.moveTo(0, g);
    floorBumpCtx.lineTo(512, g);
    floorBumpCtx.stroke();
  }

  // 3. Brushed Gunmetal & Micro-Patina (256x256)
  const [gunBumpCanvas, gunBumpCtx] = makeCanvas(256, 256);
  const [gunRoughCanvas, gunRoughCtx] = makeCanvas(256, 256);
  gunBumpCtx.fillStyle = '#808080';
  gunBumpCtx.fillRect(0, 0, 256, 256);
  gunRoughCtx.fillStyle = '#707070';
  gunRoughCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 320; i++) {
    const y = rand() * 256;
    const len = 30 + rand() * 226;
    const x = rand() * 256;
    const v = 105 + Math.floor(rand() * 50);
    gunBumpCtx.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    gunBumpCtx.lineWidth = 1;
    gunBumpCtx.beginPath();
    gunBumpCtx.moveTo(x, y);
    gunBumpCtx.lineTo(x + len, y);
    gunBumpCtx.stroke();

    const rv = 85 + Math.floor(rand() * 75);
    gunRoughCtx.strokeStyle = `rgba(${rv},${rv},${rv},0.3)`;
    gunRoughCtx.beginPath();
    gunRoughCtx.moveTo(x, y);
    gunRoughCtx.lineTo(x + len, y);
    gunRoughCtx.stroke();
  }

  // Edge wear micro-pitting
  for (let i = 0; i < 90; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const sz = 1 + rand() * 2.5;
    gunBumpCtx.fillStyle = 'rgba(55,55,55,0.3)';
    gunBumpCtx.fillRect(x, y, sz, sz);
  }

  // 4. Carved Walnut Grip / Stock Texture (256x256)
  const [woodColCanvas, woodColCtx] = makeCanvas(256, 256);
  const [woodBumpCanvas, woodBumpCtx] = makeCanvas(256, 256);
  woodColCtx.fillStyle = '#3d1c11';
  woodColCtx.fillRect(0, 0, 256, 256);
  woodBumpCtx.fillStyle = '#808080';
  woodBumpCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 90; i++) {
    const x = rand() * 256;
    woodColCtx.strokeStyle = rand() > 0.4 ? 'rgba(22,8,4,0.32)' : 'rgba(88,45,26,0.25)';
    woodColCtx.lineWidth = 1 + rand() * 2;
    woodColCtx.beginPath();
    woodColCtx.moveTo(x, 0);
    woodColCtx.bezierCurveTo(x + (rand() - 0.5) * 16, 85, x + (rand() - 0.5) * 16, 170, x, 256);
    woodColCtx.stroke();

    woodBumpCtx.strokeStyle = 'rgba(95,95,95,0.35)';
    woodBumpCtx.lineWidth = 1.2;
    woodBumpCtx.beginPath();
    woodBumpCtx.moveTo(x, 0);
    woodBumpCtx.lineTo(x, 256);
    woodBumpCtx.stroke();
  }

  // 5. Coarse Dark Cloak Weave (256x256)
  const [cloakBumpCanvas, cloakBumpCtx] = makeCanvas(256, 256);
  cloakBumpCtx.fillStyle = '#7c7c7c';
  cloakBumpCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    cloakBumpCtx.fillStyle = (y % 8 === 0) ? 'rgba(165,165,165,0.22)' : 'rgba(70,70,70,0.22)';
    cloakBumpCtx.fillRect(0, y, 256, 2);
  }
  for (let x = 0; x < 256; x += 4) {
    cloakBumpCtx.fillStyle = (x % 8 === 0) ? 'rgba(155,155,155,0.18)' : 'rgba(65,65,65,0.18)';
    cloakBumpCtx.fillRect(x, 0, 2, 256);
  }

  // 6. Soft Radial Smoke Sprite (128x128)
  const [smokeCanvas, smokeCtx] = makeCanvas(128, 128);
  const grad = smokeCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  grad.addColorStop(0.35, 'rgba(235, 240, 245, 0.55)');
  grad.addColorStop(0.7, 'rgba(200, 205, 212, 0.16)');
  grad.addColorStop(1, 'rgba(180, 185, 192, 0.0)');
  smokeCtx.fillStyle = grad;
  smokeCtx.fillRect(0, 0, 128, 128);

  const tableMap = finalizeTexture(tableColCanvas, true, 1.5, 1);
  const tableRoughnessMap = finalizeTexture(tableRoughCanvas, false, 1.5, 1);
  const tableBumpMap = finalizeTexture(tableBumpCanvas, false, 1.5, 1);

  const floorMap = finalizeTexture(floorColCanvas, true, 6, 6);
  const floorRoughnessMap = finalizeTexture(floorRoughCanvas, false, 6, 6);
  const floorBumpMap = finalizeTexture(floorBumpCanvas, false, 6, 6);

  const gunMetalBumpMap = finalizeTexture(gunBumpCanvas, false, 2, 2);
  const gunMetalRoughnessMap = finalizeTexture(gunRoughCanvas, false, 2, 2);

  const woodGripMap = finalizeTexture(woodColCanvas, true, 1, 1);
  const woodGripBumpMap = finalizeTexture(woodBumpCanvas, false, 1, 1);

  const cloakBumpMap = finalizeTexture(cloakBumpCanvas, false, 4, 4);

  const smokeSpriteMap = new THREE.CanvasTexture(smokeCanvas);
  smokeSpriteMap.colorSpace = THREE.SRGBColorSpace;
  smokeSpriteMap.needsUpdate = true;

  const allTextures: THREE.Texture[] = [
    tableMap,
    tableRoughnessMap,
    tableBumpMap,
    floorMap,
    floorRoughnessMap,
    floorBumpMap,
    gunMetalBumpMap,
    gunMetalRoughnessMap,
    woodGripMap,
    woodGripBumpMap,
    cloakBumpMap,
    smokeSpriteMap,
  ];

  return {
    tableMap,
    tableRoughnessMap,
    tableBumpMap,
    floorMap,
    floorRoughnessMap,
    floorBumpMap,
    gunMetalBumpMap,
    gunMetalRoughnessMap,
    woodGripMap,
    woodGripBumpMap,
    cloakBumpMap,
    smokeSpriteMap,
    dispose: () => {
      allTextures.forEach((t) => {
        try {
          t.dispose();
        } catch (e) {}
      });
    },
  };
}

/**
 * Builds a dark atmospheric interrogation room scene for PMREMGenerator IBL reflections.
 * Gives steel, brass, chrome, wet blood, and glass authentic highlights without washing out the abyss.
 */
export function createArenaEnvironmentScene(): THREE.Scene {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x040304);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  // Dark room enclosure
  const roomMat = new THREE.MeshStandardMaterial({
    color: 0x090708,
    roughness: 0.92,
    side: THREE.BackSide,
  });
  const room = new THREE.Mesh(boxGeo, roomMat);
  room.scale.set(22, 14, 22);
  room.position.set(0, 3.5, 0);
  envScene.add(room);

  // Warm hanging overhead tungsten bounce panel (primary specular reflection source)
  const warmLampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(12.0, 9.6, 6.8) });
  const warmLamp = new THREE.Mesh(boxGeo, warmLampMat);
  warmLamp.position.set(0, 7.2, -0.3);
  warmLamp.scale.set(2.8, 0.15, 2.2);
  envScene.add(warmLamp);

  // Cool industrial vent / skylight strip behind dealer (rim specular reflection on gun & blade edges)
  const coolRimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 3.3, 5.2) });
  const coolRim = new THREE.Mesh(boxGeo, coolRimMat);
  coolRim.position.set(0, 4.5, -9.8);
  coolRim.scale.set(7.5, 1.4, 0.2);
  envScene.add(coolRim);

  // Subtle crimson diagnostic TV bounce strip to left-rear
  const crimsonBounceMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.35, 0.25) });
  const crimsonBounce = new THREE.Mesh(boxGeo, crimsonBounceMat);
  crimsonBounce.position.set(-7.5, 2.2, -4.5);
  crimsonBounce.scale.set(0.25, 2.2, 3.2);
  envScene.add(crimsonBounce);

  // Warm dim shop counter glow to left
  const amberBounceMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 1.5, 0.55) });
  const amberBounce = new THREE.Mesh(boxGeo, amberBounceMat);
  amberBounce.position.set(-9.5, 2.4, 1.2);
  amberBounce.scale.set(0.3, 1.8, 2.8);
  envScene.add(amberBounce);

  // Dim concrete floor bounce
  const floorBounceMat = new THREE.MeshStandardMaterial({ color: 0x161211, roughness: 0.9 });
  const floorBounce = new THREE.Mesh(boxGeo, floorBounceMat);
  floorBounce.position.set(0, -3.2, 0);
  floorBounce.scale.set(16, 0.3, 16);
  envScene.add(floorBounce);

  return envScene;
}
