import * as THREE from 'three';

export interface LowPolyGoreGeometries {
  goreShardGeo: THREE.BufferGeometry;
  goreRibbonGeo: THREE.BufferGeometry;
  bloodDropGeo: THREE.BufferGeometry;
  irregularSplatGeo: THREE.BufferGeometry;
  lensStreakGeo: THREE.BufferGeometry;
}

/**
 * Generates crisp, faceted low-poly organic gore & blood geometries
 * so flesh chunks, clots, droplets, and puddles share the game's gritty matte/low-poly aesthetic.
 */
export function createGoreGeometries(): LowPolyGoreGeometries {
  // 1. Jagged irregular 6-vertex low-poly flesh / coagulated clot chunk
  const goreShardGeo = new THREE.OctahedronGeometry(0.5, 0);
  const shardPos = goreShardGeo.attributes.position;
  for (let i = 0; i < shardPos.count; i++) {
    const x = shardPos.getX(i);
    const y = shardPos.getY(i);
    const z = shardPos.getZ(i);
    // Asymmetric deterministic warp per vertex to break geometric symmetry
    const hash = Math.sin(x * 19.3 + y * 7.1 + z * 13.7);
    const scaleX = 0.72 + hash * 0.35;
    const scaleY = 0.85 + Math.cos(y * 11.4 + z * 5.9) * 0.42;
    const scaleZ = 0.68 + Math.sin(z * 17.2 - x * 9.3) * 0.38;
    shardPos.setXYZ(i, x * scaleX, y * scaleY, z * scaleZ);
  }
  goreShardGeo.computeVertexNormals();

  // 2. Angular shredded tissue / arterial strand wedge
  const ribbonShape = new THREE.Shape();
  ribbonShape.moveTo(0, 0.55);
  ribbonShape.lineTo(0.28, 0.12);
  ribbonShape.lineTo(0.16, -0.45);
  ribbonShape.lineTo(-0.08, -0.55);
  ribbonShape.lineTo(-0.32, -0.05);
  ribbonShape.lineTo(-0.18, 0.32);
  ribbonShape.closePath();
  const goreRibbonGeo = new THREE.ExtrudeGeometry(ribbonShape, {
    depth: 0.22,
    bevelEnabled: false,
    curveSegments: 1,
  });
  goreRibbonGeo.center();
  goreRibbonGeo.computeVertexNormals();

  // 3. 5-sided faceted low-poly teardrop (pointed tail +Y, heavy rounded belly -Y)
  const dropPoints = [
    new THREE.Vector2(0.001, -0.48),
    new THREE.Vector2(0.28, -0.40),
    new THREE.Vector2(0.42, -0.18),
    new THREE.Vector2(0.30, 0.10),
    new THREE.Vector2(0.12, 0.36),
    new THREE.Vector2(0.001, 0.54),
  ];
  const bloodDropGeo = new THREE.LatheGeometry(dropPoints, 5);
  bloodDropGeo.computeVertexNormals();

  // 4. Ragged 9-point irregular asymmetric puddle prism for landed table/floor splatters
  const splatShape = new THREE.Shape();
  const pts = [
    [0.0, 0.56],
    [0.34, 0.42],
    [0.54, 0.14],
    [0.44, -0.22],
    [0.52, -0.46],
    [0.12, -0.52],
    [-0.26, -0.56],
    [-0.50, -0.20],
    [-0.46, 0.24],
    [-0.22, 0.44],
  ];
  splatShape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    splatShape.lineTo(pts[i][0], pts[i][1]);
  }
  splatShape.closePath();
  const irregularSplatGeo = new THREE.ExtrudeGeometry(splatShape, {
    depth: 0.002,
    bevelEnabled: false,
    curveSegments: 1,
  });
  irregularSplatGeo.rotateX(Math.PI / 2);
  irregularSplatGeo.translate(0, 0.001, 0);
  irregularSplatGeo.computeVertexNormals();

  // 5. Tapered low-poly camera-lens droplet / streak prism
  const streakShape = new THREE.Shape();
  streakShape.moveTo(0, 0.55);
  streakShape.lineTo(0.26, 0.10);
  streakShape.lineTo(0.44, -0.35);
  streakShape.lineTo(0.16, -0.55);
  streakShape.lineTo(-0.22, -0.50);
  streakShape.lineTo(-0.42, -0.22);
  streakShape.lineTo(-0.20, 0.24);
  streakShape.closePath();
  const lensStreakGeo = new THREE.ExtrudeGeometry(streakShape, {
    depth: 0.02,
    bevelEnabled: false,
    curveSegments: 1,
  });
  lensStreakGeo.center();

  return {
    goreShardGeo,
    goreRibbonGeo,
    bloodDropGeo,
    irregularSplatGeo,
    lensStreakGeo,
  };
}

export interface DealerWoundsSystem {
  group: THREE.Group;
  update: (damageRatio: number) => void;
  reset: () => void;
  getActiveDripLocalAnchors: () => THREE.Vector3[];
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
}

/**
 * Persistent faceted low-poly gunshot wounds, blood stains, and arterial runs mounted directly
 * onto the Dealer's cloak, hood, shoulders, and mask. Progressively reveals as Dealer loses HP.
 */
export function createDealerWoundsSystem(dealerGroup: THREE.Group): DealerWoundsSystem {
  const group = new THREE.Group();
  group.name = 'dealerWoundsGroup';
  dealerGroup.add(group);

  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];

  const freshWoundMat = new THREE.MeshStandardMaterial({
    color: 0x3b0202,
    roughness: 0.08,
    metalness: 0.14,
    flatShading: true,
    emissive: 0x0e0000,
  });
  const darkClotMat = new THREE.MeshStandardMaterial({
    color: 0x1c0101,
    roughness: 0.24,
    metalness: 0.06,
    flatShading: true,
  });
  const tornTissueMat = new THREE.MeshStandardMaterial({
    color: 0x520606,
    roughness: 0.14,
    metalness: 0.10,
    flatShading: true,
  });
  ownedMaterials.push(freshWoundMat, darkClotMat, tornTissueMat);

  const craterGeo = new THREE.OctahedronGeometry(0.5, 0);
  const streakGeo = new THREE.BoxGeometry(1, 1, 1);
  const shredGeo = new THREE.TetrahedronGeometry(0.5, 0);
  ownedGeometries.push(craterGeo, streakGeo, shredGeo);

  interface WoundSpec {
    threshold: number;
    mesh: THREE.Mesh;
    dripAnchor?: THREE.Vector3;
  }

  const wounds: WoundSpec[] = [];

  const addWound = (
    threshold: number,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    scale: [number, number, number],
    rot: [number, number, number],
    dripAnchor?: [number, number, number]
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    m.visible = false;
    group.add(m);
    wounds.push({
      threshold,
      mesh: m,
      dripAnchor: dripAnchor ? new THREE.Vector3(dripAnchor[0], dripAnchor[1], dripAnchor[2]) : undefined,
    });
  };

  // Stage 1 (First hit, damageRatio > 0.05): Left chest entry crater + blood trickle + shoulder spray
  addWound(0.05, craterGeo, darkClotMat, [-0.14, 1.92, 0.34], [0.22, 0.24, 0.10], [0.25, -0.2, 0.3], [-0.14, 1.82, 0.39]);
  addWound(0.05, craterGeo, tornTissueMat, [-0.14, 1.92, 0.36], [0.12, 0.13, 0.08], [0.4, 0.1, -0.2]);
  addWound(0.05, streakGeo, freshWoundMat, [-0.16, 1.56, 0.42], [0.075, 0.56, 0.04], [-0.28, 0, 0.08]);
  addWound(0.05, shredGeo, freshWoundMat, [-0.30, 2.04, 0.25], [0.14, 0.18, 0.08], [0.3, -0.5, 0.6]);

  // Stage 2 (Second hit, damageRatio >= 0.30): Right clavicle/mask cheek splatter + sternum tear
  addWound(0.30, craterGeo, freshWoundMat, [0.18, 2.02, 0.31], [0.24, 0.20, 0.10], [0.2, 0.35, -0.4], [0.18, 1.88, 0.36]);
  addWound(0.30, streakGeo, darkClotMat, [0.19, 1.62, 0.40], [0.09, 0.68, 0.04], [-0.28, 0, -0.06]);
  addWound(0.30, shredGeo, tornTissueMat, [0.22, 2.60, 0.49], [0.12, 0.16, 0.06], [0.1, 0.2, 0.4], [0.22, 2.52, 0.52]);
  addWound(0.30, craterGeo, freshWoundMat, [0.02, 1.78, 0.38], [0.16, 0.22, 0.09], [0.15, 0, 0.2]);

  // Stage 3 (Heavy damage, damageRatio >= 0.55): Hood brow gash + soaked cloak chest apron + jaw drips
  addWound(0.55, craterGeo, darkClotMat, [-0.20, 2.86, 0.47], [0.18, 0.15, 0.08], [0.2, -0.2, 0.5], [-0.20, 2.75, 0.51]);
  addWound(0.55, streakGeo, freshWoundMat, [-0.11, 2.40, 0.54], [0.055, 0.32, 0.03], [-0.15, 0, 0.05]);
  addWound(0.55, craterGeo, freshWoundMat, [0.01, 1.52, 0.46], [0.34, 0.44, 0.10], [-0.25, 0.1, -0.15], [0.02, 1.32, 0.50]);
  addWound(0.55, shredGeo, tornTissueMat, [0.32, 1.88, 0.28], [0.18, 0.24, 0.09], [0.2, 0.4, -0.5]);

  // Stage 4 (Critical / Lethal, damageRatio >= 0.80): Shattered mask cheek gore + heavy lower cloak soak
  addWound(0.80, craterGeo, tornTissueMat, [-0.18, 2.56, 0.53], [0.16, 0.18, 0.07], [0.1, -0.3, 0.2], [-0.18, 2.46, 0.56]);
  addWound(0.80, streakGeo, darkClotMat, [0.05, 1.24, 0.55], [0.24, 0.72, 0.05], [-0.29, 0, 0.03]);
  addWound(0.80, streakGeo, freshWoundMat, [-0.24, 1.18, 0.53], [0.14, 0.64, 0.05], [-0.29, -0.1, 0.09]);
  addWound(0.80, shredGeo, freshWoundMat, [-0.02, 2.18, 0.28], [0.20, 0.22, 0.11], [0.3, 0.1, 0.7]);

  const update = (damageRatio: number) => {
    for (let i = 0; i < wounds.length; i++) {
      wounds[i].mesh.visible = damageRatio >= wounds[i].threshold;
    }
  };

  const reset = () => {
    for (let i = 0; i < wounds.length; i++) {
      wounds[i].mesh.visible = false;
    }
  };

  const getActiveDripLocalAnchors = (): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < wounds.length; i++) {
      if (wounds[i].mesh.visible && wounds[i].dripAnchor) {
        out.push(wounds[i].dripAnchor!);
      }
    }
    return out;
  };

  return {
    group,
    update,
    reset,
    getActiveDripLocalAnchors,
    ownedGeometries,
    ownedMaterials,
  };
}

export interface WristSlashWoundSystem {
  group: THREE.Group;
  setSlashProgress: (sliceT: number, pulse: number) => void;
  reset: () => void;
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
}

/**
 * Close-up low-poly foreground flesh-slash prop displayed under the razor blade
 * during player RAZORBLADE self-mutilation, visibly splitting open as the blade drags across.
 */
export function createWristSlashWoundGroup(): WristSlashWoundSystem {
  const group = new THREE.Group();
  group.name = 'wristSlashWoundGroup';
  group.visible = false;

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x6e544b,
    roughness: 0.78,
    metalness: 0.04,
    flatShading: true,
  });
  const dermisMat = new THREE.MeshStandardMaterial({
    color: 0x5c1414,
    roughness: 0.26,
    metalness: 0.06,
    flatShading: true,
  });
  const deepCavityMat = new THREE.MeshStandardMaterial({
    color: 0x210101,
    roughness: 0.07,
    metalness: 0.14,
    flatShading: true,
  });
  const wetBloodMat = new THREE.MeshStandardMaterial({
    color: 0x450202,
    roughness: 0.05,
    metalness: 0.18,
    flatShading: true,
  });

  // Low-poly forearm / wrist slab resting horizontally under the blade
  const armGeo = new THREE.CylinderGeometry(0.052, 0.062, 0.34, 7);
  armGeo.rotateZ(Math.PI / 2);
  armGeo.scale(1.0, 0.75, 1.0);
  const armMesh = new THREE.Mesh(armGeo, skinMat);
  armMesh.position.set(0, -0.042, 0);
  group.add(armMesh);

  // Dark inner wound trough (anchored on left edge x = -0.105 so it unzips left->right)
  const cavityGeo = new THREE.BoxGeometry(0.21, 0.012, 0.022);
  cavityGeo.translate(0.105, 0, 0);
  const cavityMesh = new THREE.Mesh(cavityGeo, deepCavityMat);
  cavityMesh.position.set(-0.105, -0.004, 0.008);
  cavityMesh.scale.set(0.001, 1, 0.1);
  group.add(cavityMesh);

  // Inner torn pink-crimson dermis bevel lips that flare apart as the blade cuts
  const lipGeo = new THREE.BoxGeometry(0.21, 0.009, 0.012);
  lipGeo.translate(0.105, 0, 0);
  const lipTop = new THREE.Mesh(lipGeo, dermisMat);
  lipTop.position.set(-0.105, -0.001, 0.004);
  group.add(lipTop);

  const lipBot = new THREE.Mesh(lipGeo, dermisMat);
  lipBot.position.set(-0.105, -0.001, 0.012);
  group.add(lipBot);

  // Pooling glossy arterial blood ribbon inside the incision
  const bloodLineGeo = new THREE.OctahedronGeometry(0.5, 0);
  const bloodBeads: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const bead = new THREE.Mesh(bloodLineGeo, wetBloodMat);
    bead.position.set(-0.088 + i * 0.036, -0.001, 0.009 + (i % 2 === 0 ? 0.003 : -0.003));
    bead.scale.set(0.018, 0.008, 0.014);
    bead.visible = false;
    group.add(bead);
    bloodBeads.push(bead);
  }

  const setSlashProgress = (sliceT: number, pulse: number) => {
    const t = THREE.MathUtils.clamp(sliceT, 0.01, 1.0);
    const openAmt = Math.min(1.0, t * 1.15);

    cavityMesh.scale.set(t, 1.0 + pulse * 0.25, 0.25 + openAmt * 1.15 + pulse * 0.25);
    lipTop.scale.set(t, 1.0, 1.0);
    lipBot.scale.set(t, 1.0, 1.0);

    lipTop.position.z = 0.004 - openAmt * 0.012;
    lipBot.position.z = 0.012 + openAmt * 0.012;

    for (let i = 0; i < bloodBeads.length; i++) {
      const thresh = (i + 0.5) / bloodBeads.length;
      if (t >= thresh) {
        bloodBeads[i].visible = true;
        const swell = 1.0 + pulse * 0.42;
        bloodBeads[i].scale.set(0.022 * swell, 0.011 * swell, 0.016 * swell);
      } else {
        bloodBeads[i].visible = false;
      }
    }
  };

  const reset = () => {
    group.visible = false;
    cavityMesh.scale.set(0.001, 1, 0.1);
    lipTop.position.z = 0.004;
    lipBot.position.z = 0.012;
    for (let i = 0; i < bloodBeads.length; i++) {
      bloodBeads[i].visible = false;
    }
  };

  return {
    group,
    setSlashProgress,
    reset,
    ownedGeometries: [armGeo, cavityGeo, lipGeo, bloodLineGeo],
    ownedMaterials: [skinMat, dermisMat, deepCavityMat, wetBloodMat],
  };
}

export interface MedkitForearmSystem {
  group: THREE.Group;
  setTreatmentState: (sprayWetness: number, wrapProgress: number) => void;
  reset: () => void;
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
}

/**
 * Low-poly resting forearm & cuffed sleeve placed on the oak table during MEDKIT use.
 * Shows the lacerated wound glistening with sprayed antiseptic mist and progressively
 * covered by layered woven cotton gauze bands + metal bandage clip.
 */
export function createMedkitForearmSystem(): MedkitForearmSystem {
  const group = new THREE.Group();
  group.name = 'medkitForearmGroup';
  group.visible = false;

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x6f554b,
    roughness: 0.78,
    metalness: 0.04,
    flatShading: true,
  });
  const sleeveMat = new THREE.MeshStandardMaterial({
    color: 0x1e2024,
    roughness: 0.90,
    metalness: 0.04,
    flatShading: true,
  });
  const woundMat = new THREE.MeshStandardMaterial({
    color: 0x4b0808,
    roughness: 0.34,
    metalness: 0.08,
    flatShading: true,
  });
  const driedBloodMat = new THREE.MeshStandardMaterial({
    color: 0x260202,
    roughness: 0.24,
    metalness: 0.12,
    flatShading: true,
  });
  const antisepticMat = new THREE.MeshStandardMaterial({
    color: 0x9ec5cd,
    roughness: 0.08,
    metalness: 0.14,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    flatShading: true,
  });
  const gauzeMat = new THREE.MeshStandardMaterial({
    color: 0xe2ddd2,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: true,
  });
  const clipMat = new THREE.MeshStandardMaterial({
    color: 0x7a8086,
    roughness: 0.42,
    metalness: 0.65,
    flatShading: true,
  });

  // Forearm slab resting on table (+X toward hand/wrist, -X toward cuffed jacket sleeve)
  const armGeo = new THREE.CylinderGeometry(0.041, 0.052, 0.34, 8);
  armGeo.rotateZ(Math.PI / 2);
  armGeo.scale(1.0, 0.76, 1.0);
  const armMesh = new THREE.Mesh(armGeo, skinMat);
  group.add(armMesh);

  // Dark wool coat cuff around elbow side (-X)
  const sleeveGeo = new THREE.CylinderGeometry(0.056, 0.062, 0.14, 8);
  sleeveGeo.rotateZ(Math.PI / 2);
  sleeveGeo.scale(1.0, 0.80, 1.0);
  const sleeveMesh = new THREE.Mesh(sleeveGeo, sleeveMat);
  sleeveMesh.position.set(-0.18, 0, 0);
  group.add(sleeveMesh);

  // Loosely clenched resting hand + thumb silhouette at wrist (+X)
  const handGeo = new THREE.BoxGeometry(0.095, 0.046, 0.072);
  const handMesh = new THREE.Mesh(handGeo, skinMat);
  handMesh.position.set(0.195, -0.004, 0.003);
  handMesh.rotation.set(0, -0.08, -0.06);
  group.add(handMesh);

  const thumbGeo = new THREE.BoxGeometry(0.052, 0.024, 0.026);
  const thumbMesh = new THREE.Mesh(thumbGeo, skinMat);
  thumbMesh.position.set(0.175, 0.012, 0.042);
  thumbMesh.rotation.set(0.15, 0.35, 0);
  group.add(thumbMesh);

  // Jagged outer-forearm laceration & dried blood smears
  const woundGeo = new THREE.BoxGeometry(0.115, 0.008, 0.022);
  const woundMesh = new THREE.Mesh(woundGeo, woundMat);
  woundMesh.position.set(0.015, 0.033, 0.004);
  woundMesh.rotation.set(0, 0.14, 0);
  group.add(woundMesh);

  const coreGashGeo = new THREE.BoxGeometry(0.096, 0.006, 0.009);
  const coreGash = new THREE.Mesh(coreGashGeo, driedBloodMat);
  coreGash.position.set(0.016, 0.036, 0.004);
  coreGash.rotation.set(0, 0.14, 0);
  group.add(coreGash);

  const streakOffsets: [number, number, number, number][] = [
    [-0.022, 0.028, 0.022, 0.4],
    [0.038, 0.026, -0.020, -0.35],
    [0.005, 0.025, 0.028, 0.15],
  ];
  const streakGeo = new THREE.BoxGeometry(0.032, 0.004, 0.012);
  for (const [sx, sy, sz, rotY] of streakOffsets) {
    const sm = new THREE.Mesh(streakGeo, driedBloodMat);
    sm.position.set(sx, sy, sz);
    sm.rotation.set(0.32 * Math.sign(sz), rotY, 0);
    group.add(sm);
  }

  // Wet antiseptic mist glaze across the wound surface
  const sheenGeo = new THREE.CylinderGeometry(0.0475, 0.0505, 0.135, 8);
  sheenGeo.rotateZ(Math.PI / 2);
  sheenGeo.scale(1.0, 0.77, 1.0);
  const antisepticSheen = new THREE.Mesh(sheenGeo, antisepticMat);
  antisepticSheen.position.set(0.015, 0.002, 0);
  antisepticSheen.visible = false;
  group.add(antisepticSheen);

  // Overlapping woven cotton gauze bandage loops wrapping progressively around the wound
  const wrapRingGeo = new THREE.CylinderGeometry(0.049, 0.051, 0.044, 10);
  wrapRingGeo.rotateZ(Math.PI / 2);
  wrapRingGeo.scale(1.0, 0.79, 1.02);

  const wrapRings: THREE.Mesh[] = [];
  const wrapPositions = [-0.042, -0.016, 0.012, 0.038, 0.064];
  const wrapTilts = [0.06, -0.05, 0.07, -0.06, 0.04];
  for (let i = 0; i < wrapPositions.length; i++) {
    const ring = new THREE.Mesh(wrapRingGeo, gauzeMat);
    ring.position.set(wrapPositions[i], 0.0, 0.0);
    ring.rotation.set(0, wrapTilts[i], 0);
    ring.visible = false;
    group.add(ring);
    wrapRings.push(ring);
  }

  const clipGeo = new THREE.BoxGeometry(0.016, 0.006, 0.022);
  const clipMesh = new THREE.Mesh(clipGeo, clipMat);
  clipMesh.position.set(0.042, 0.041, 0.006);
  clipMesh.visible = false;
  group.add(clipMesh);

  const setTreatmentState = (sprayWetness: number, wrapProgress: number) => {
    const wet = THREE.MathUtils.clamp(sprayWetness, 0, 1);
    if (wet > 0.01) {
      antisepticSheen.visible = true;
      antisepticMat.opacity = wet * 0.44;
    } else {
      antisepticSheen.visible = false;
      antisepticMat.opacity = 0;
    }

    const wrap = THREE.MathUtils.clamp(wrapProgress, 0, 1);
    const total = wrapRings.length;
    for (let i = 0; i < total; i++) {
      const startT = i / total;
      const endT = (i + 1) / total;
      const localT = THREE.MathUtils.clamp((wrap - startT) / (endT - startT), 0, 1);
      if (localT > 0.02) {
        wrapRings[i].visible = true;
        const s = 0.88 + 0.12 * localT;
        wrapRings[i].scale.set(0.35 + 0.65 * localT, s, s);
      } else {
        wrapRings[i].visible = false;
      }
    }
    clipMesh.visible = wrap >= 0.94;
  };

  const reset = () => {
    group.visible = false;
    setTreatmentState(0, 0);
  };

  return {
    group,
    setTreatmentState,
    reset,
    ownedGeometries: [armGeo, sleeveGeo, handGeo, thumbGeo, woundGeo, coreGashGeo, streakGeo, sheenGeo, wrapRingGeo, clipGeo],
    ownedMaterials: [skinMat, sleeveMat, woundMat, driedBloodMat, antisepticMat, gauzeMat, clipMat],
  };
}
