import * as THREE from 'three';
import { Chamber } from '../types';

export interface RevolverBuildParams {
  gunMetalMat: THREE.MeshStandardMaterial;
  stockMat: THREE.MeshStandardMaterial;
  darkLinerMat: THREE.MeshStandardMaterial;
  polishedSteelMat: THREE.MeshStandardMaterial;
  brassAccentMat: THREE.MeshStandardMaterial;
  rawCutSteelMat: THREE.MeshStandardMaterial;
  drumSegments: number;
  barrelSegments: number;
  torusSegments: number;
  isHighPoly: boolean;
}

export interface RevolverRig {
  gunGroup: THREE.Group;
  cylinderSwingGroup: THREE.Group;
  cylinderSpinGroup: THREE.Group;
  revolverCylinderMesh: THREE.Mesh;
  chamberCartridges: THREE.Group[];
  cylinderLatchMesh: THREE.Mesh;
  hammerPivotGroup: THREE.Group;
  triggerPivotGroup: THREE.Group;
  guardMesh: THREE.Mesh;
  barrelRearMesh: THREE.Mesh;
  barrelFrontMesh: THREE.Mesh;
  gunBarrelFrontGroup: THREE.Group;
  cutFaceRingMesh: THREE.Mesh;
  cutFaceMat: THREE.MeshStandardMaterial;
  gunBloodGroup: THREE.Group;
  frontGunBloodGroup: THREE.Group;
  updateChambersState: (chambers: Chamber[], inspectHighlightIndex: number | null) => void;
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
}

/**
 * Builds an articulated, realistic low-poly double-action heavy revolver (.357/.44 Magnum style)
 * aligned so:
 *   +Z = barrel forward, +Y = top strap / sights, -X = left (crane swing-out side), +X = right (sideplate)
 *   Cylinder axis = (0, 0.11, -0.05), top chamber at y = 0.11 + 0.098 = 0.208 = exact barrel bore Y!
 */
export function createDetailedRevolverModel(params: RevolverBuildParams): RevolverRig {
  const {
    gunMetalMat,
    stockMat,
    darkLinerMat,
    polishedSteelMat,
    brassAccentMat,
    rawCutSteelMat,
    drumSegments,
    barrelSegments,
    torusSegments,
    isHighPoly,
  } = params;

  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    ownedMaterials.push(m);
    return m;
  };

  // Dedicated secondary materials for authentic industrial contrast
  const parkerizedSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x181c20,
      roughness: 0.56,
      metalness: 0.78,
      flatShading: true,
    })
  );

  const copperJacketMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb8652e,
      roughness: 0.24,
      metalness: 0.90,
      flatShading: true,
    })
  );

  const sightInsertMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd9531e,
      emissive: 0x330d00,
      roughness: 0.35,
      metalness: 0.15,
      flatShading: true,
    })
  );

  const cutFaceMat = trackMat(rawCutSteelMat.clone());

  const gunBloodMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x360202,
      roughness: 0.08,
      metalness: 0.12,
      flatShading: true,
      transparent: true,
      opacity: 0.94,
    })
  );

  // Mirror-inspection active chamber highlight materials (Red = Live, Blue = Blank)
  const spentPrimerMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e1d1c,
      roughness: 0.85,
      metalness: 0.25,
      flatShading: true,
    })
  );

  const liveHighlightBulletMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff2b1f,
      emissive: 0xcc1208,
      emissiveIntensity: 1.45,
      roughness: 0.22,
      metalness: 0.55,
      flatShading: true,
    })
  );

  const liveHighlightCasingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd93a2b,
      emissive: 0x8a0c04,
      emissiveIntensity: 0.95,
      roughness: 0.28,
      metalness: 0.72,
      flatShading: true,
    })
  );

  const liveHighlightRingMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xff3322,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    })
  );

  const blankHighlightBulletMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2699ff,
      emissive: 0x0a58cc,
      emissiveIntensity: 1.45,
      roughness: 0.22,
      metalness: 0.55,
      flatShading: true,
    })
  );

  const blankHighlightCasingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b8fd9,
      emissive: 0x083b82,
      emissiveIntensity: 0.95,
      roughness: 0.28,
      metalness: 0.72,
      flatShading: true,
    })
  );

  const blankHighlightRingMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x33aaff,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    })
  );

  const gunGroup = new THREE.Group();
  gunGroup.name = 'revolverRootGroup';

  // --- 1. SCULPTED MAIN FRAME CHASSIS (Extruded Side Profile with Cylinder Window Cutout) ---
  // Note: Shape coordinates (x, y) -> after rotateY(-PI/2), shape.x becomes +Z and shape.y becomes +Y
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-0.34, 0.06);  // Rear tang bottom
  frameShape.lineTo(-0.245, 0.06); // Behind trigger frame
  frameShape.lineTo(-0.245, 0.275); // Breech / recoil shield vertical face
  frameShape.lineTo(0.14, 0.275);  // Underside of top strap (open cylinder window!)
  frameShape.lineTo(0.14, 0.035);  // Front crane pillar
  frameShape.lineTo(0.05, 0.01);   // Front trigger guard web
  frameShape.lineTo(-0.02, 0.025); // Trigger frame belly
  frameShape.lineTo(-0.18, 0.015); // Rear trigger guard web
  frameShape.lineTo(-0.28, -0.05); // Grip frame front curve
  frameShape.lineTo(-0.37, -0.34); // Front of grip frame spine
  frameShape.lineTo(-0.54, -0.31); // Backstrap butt
  frameShape.lineTo(-0.41, 0.05);  // Upper backstrap tang
  frameShape.lineTo(-0.34, 0.15);  // Hammer shroud shoulder
  frameShape.closePath();

  // Outer silhouette + cylinder window is cleanly formed by building lower frame + top strap + front barrel lug
  const lowerFrameShape = new THREE.Shape();
  lowerFrameShape.moveTo(-0.39, 0.09);
  lowerFrameShape.lineTo(-0.34, 0.17);
  lowerFrameShape.lineTo(-0.29, 0.24);
  lowerFrameShape.lineTo(-0.245, 0.275);
  lowerFrameShape.lineTo(-0.245, -0.055);
  lowerFrameShape.lineTo(0.145, -0.055);
  lowerFrameShape.lineTo(0.145, 0.275);
  lowerFrameShape.lineTo(0.20, 0.275);
  lowerFrameShape.lineTo(0.20, 0.075);
  lowerFrameShape.lineTo(0.12, 0.015);
  lowerFrameShape.lineTo(0.03, 0.01);
  lowerFrameShape.lineTo(-0.20, 0.01);
  lowerFrameShape.lineTo(-0.28, -0.045);
  lowerFrameShape.lineTo(-0.37, -0.335);
  lowerFrameShape.lineTo(-0.535, -0.305);
  lowerFrameShape.lineTo(-0.425, 0.02);
  lowerFrameShape.closePath();

  // Actually keep the cylinder window genuinely OPEN between z = -0.24 and z = +0.13!
  const chassisShape = new THREE.Shape();
  chassisShape.moveTo(-0.42, 0.03);
  chassisShape.lineTo(-0.35, 0.18);
  chassisShape.lineTo(-0.27, 0.255);
  chassisShape.lineTo(-0.24, 0.275);
  chassisShape.lineTo(-0.24, -0.045);
  chassisShape.lineTo(0.135, -0.045);
  chassisShape.lineTo(0.135, 0.275);
  chassisShape.lineTo(0.19, 0.275);
  chassisShape.lineTo(0.19, 0.07);
  chassisShape.lineTo(0.11, -0.065);
  chassisShape.lineTo(0.04, -0.065);
  chassisShape.lineTo(-0.01, -0.01);
  chassisShape.lineTo(-0.18, -0.01);
  chassisShape.lineTo(-0.24, -0.065);
  chassisShape.lineTo(-0.28, -0.065);
  chassisShape.lineTo(-0.37, -0.335);
  chassisShape.lineTo(-0.53, -0.305);
  chassisShape.closePath();

  const frameExtrudeGeo = trackGeo(
    new THREE.ExtrudeGeometry(chassisShape, {
      depth: 0.145,
      bevelEnabled: true,
      bevelThickness: 0.016,
      bevelSize: 0.012,
      bevelSegments: 1,
      curveSegments: 3,
    })
  );
  // Center extrusion thickness along X, then map shape.x -> +Z
  frameExtrudeGeo.translate(0, 0, -0.0725);
  frameExtrudeGeo.rotateY(-Math.PI / 2);

  const frameMesh = new THREE.Mesh(frameExtrudeGeo, gunMetalMat);
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  gunGroup.add(frameMesh);

  // Rear Recoil Shield Cheeks flanking the cylinder breech (faceted cylinder dome)
  const recoilShieldGeo = trackGeo(new THREE.CylinderGeometry(0.172, 0.172, 0.055, drumSegments));
  recoilShieldGeo.rotateX(Math.PI / 2);
  const recoilShieldMesh = new THREE.Mesh(recoilShieldGeo, gunMetalMat);
  recoilShieldMesh.position.set(0, 0.11, -0.268);
  recoilShieldMesh.castShadow = true;
  gunGroup.add(recoilShieldMesh);

  // Firing-pin bushing ring on breech face aligned directly with top chamber (y = 0.208)
  const firingBushingGeo = trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 8));
  firingBushingGeo.rotateX(Math.PI / 2);
  const firingBushingMesh = new THREE.Mesh(firingBushingGeo, polishedSteelMat);
  firingBushingMesh.position.set(0, 0.208, -0.238);
  gunGroup.add(firingBushingMesh);

  // Top Strap Frame Bridge (with chamfered edges spanning above the cylinder)
  const topStrapGeo = trackGeo(new THREE.BoxGeometry(0.155, 0.065, 0.48));
  const topStrapMesh = new THREE.Mesh(topStrapGeo, gunMetalMat);
  topStrapMesh.position.set(0, 0.308, -0.04);
  topStrapMesh.castShadow = true;
  gunGroup.add(topStrapMesh);

  // Top Strap Sight Groove / Anti-Glare Serrated Rib
  const topStrapChannelGeo = trackGeo(new THREE.BoxGeometry(0.065, 0.016, 0.44));
  const topStrapChannelMesh = new THREE.Mesh(topStrapChannelGeo, parkerizedSteelMat);
  topStrapChannelMesh.position.set(0, 0.342, -0.04);
  gunGroup.add(topStrapChannelMesh);

  // Adjustable Micrometer Rear Sight Assembly (Two ears + U-notch blade + windage screw)
  const rearSightBaseGeo = trackGeo(new THREE.BoxGeometry(0.095, 0.032, 0.085));
  const rearSightBase = new THREE.Mesh(rearSightBaseGeo, parkerizedSteelMat);
  rearSightBase.position.set(0, 0.354, -0.245);
  gunGroup.add(rearSightBase);

  const rearEarGeo = trackGeo(new THREE.BoxGeometry(0.028, 0.034, 0.045));
  const leftEar = new THREE.Mesh(rearEarGeo, polishedSteelMat);
  leftEar.position.set(-0.032, 0.372, -0.265);
  gunGroup.add(leftEar);
  const rightEar = new THREE.Mesh(rearEarGeo, polishedSteelMat);
  rightEar.position.set(0.032, 0.372, -0.265);
  gunGroup.add(rightEar);

  const windageScrewGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.025, 6));
  windageScrewGeo.rotateZ(Math.PI / 2);
  const windageScrew = new THREE.Mesh(windageScrewGeo, brassAccentMat);
  windageScrew.position.set(0.056, 0.358, -0.245);
  gunGroup.add(windageScrew);

  // Sideplate Screws (3 low-poly steel screws on right side +X)
  const screwGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.015, 6));
  screwGeo.rotateZ(Math.PI / 2);
  [
    [0.084, 0.02, -0.20],
    [0.084, 0.09, -0.31],
    [0.084, -0.04, -0.29],
  ].forEach(([sx, sy, sz]) => {
    const sc = new THREE.Mesh(screwGeo, polishedSteelMat);
    sc.position.set(sx, sy, sz);
    gunGroup.add(sc);
  });

  // Sliding Thumb Cylinder Release Latch on Left Frame (-X)
  const latchGeo = trackGeo(new THREE.BoxGeometry(0.028, 0.055, 0.09));
  const cylinderLatchMesh = new THREE.Mesh(latchGeo, polishedSteelMat);
  cylinderLatchMesh.position.set(-0.092, 0.165, -0.315);
  gunGroup.add(cylinderLatchMesh);

  // --- 2. CONTOURED WALNUT GRIP PANELS + BACKSTRAP + MEDALLIONS ---
  const gripPanelShape = new THREE.Shape();
  gripPanelShape.moveTo(-0.275, -0.035);
  gripPanelShape.lineTo(-0.34, -0.15);
  gripPanelShape.lineTo(-0.365, -0.325);
  gripPanelShape.lineTo(-0.545, -0.305);
  gripPanelShape.lineTo(-0.48, -0.14);
  gripPanelShape.lineTo(-0.41, 0.025);
  gripPanelShape.lineTo(-0.33, 0.055);
  gripPanelShape.closePath();

  const panelExtrudeGeo = trackGeo(
    new THREE.ExtrudeGeometry(gripPanelShape, {
      depth: 0.036,
      bevelEnabled: true,
      bevelThickness: 0.014,
      bevelSize: 0.010,
      bevelSegments: 1,
      curveSegments: 3,
    })
  );
  panelExtrudeGeo.rotateY(-Math.PI / 2);

  const leftGripPanel = new THREE.Mesh(panelExtrudeGeo, stockMat);
  leftGripPanel.position.set(-0.068, 0, 0);
  leftGripPanel.castShadow = true;
  leftGripPanel.receiveShadow = true;
  gunGroup.add(leftGripPanel);

  const rightGripPanel = new THREE.Mesh(panelExtrudeGeo, stockMat);
  rightGripPanel.position.set(0.104, 0, 0);
  rightGripPanel.castShadow = true;
  rightGripPanel.receiveShadow = true;
  gunGroup.add(rightGripPanel);

  // Brass Medallions & Grip Screw
  const medallionGeo = trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 8));
  medallionGeo.rotateZ(Math.PI / 2);
  const leftMedallion = new THREE.Mesh(medallionGeo, brassAccentMat);
  leftMedallion.position.set(-0.114, -0.085, -0.39);
  gunGroup.add(leftMedallion);

  const rightMedallion = new THREE.Mesh(medallionGeo, brassAccentMat);
  rightMedallion.position.set(0.114, -0.085, -0.39);
  gunGroup.add(rightMedallion);

  const gripScrewGeo = trackGeo(new THREE.CylinderGeometry(0.013, 0.013, 0.22, 6));
  gripScrewGeo.rotateZ(Math.PI / 2);
  const gripScrew = new THREE.Mesh(gripScrewGeo, polishedSteelMat);
  gripScrew.position.set(0, -0.19, -0.435);
  gunGroup.add(gripScrew);

  // Steel Grip Butt Cap & Lanyard Swivel Ring
  const gripCapGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.028, 0.195));
  const gripCapMesh = new THREE.Mesh(gripCapGeo, parkerizedSteelMat);
  gripCapMesh.position.set(0, -0.325, -0.452);
  gripCapMesh.rotation.x = 0.11;
  gunGroup.add(gripCapMesh);

  const lanyardRingGeo = trackGeo(new THREE.TorusGeometry(0.028, 0.007, 6, 8));
  const lanyardRingMesh = new THREE.Mesh(lanyardRingGeo, polishedSteelMat);
  lanyardRingMesh.position.set(0, -0.358, -0.462);
  gunGroup.add(lanyardRingMesh);

  // --- 3. SWING-OUT CRANE & 6-CHAMBER ROTATING CYLINDER ASSEMBLY ---
  const cylinderSwingGroup = new THREE.Group();
  cylinderSwingGroup.name = 'cylinderSwingGroup';
  // Crane pivot sits at bottom-left of cylinder frame window
  cylinderSwingGroup.position.set(-0.105, -0.015, 0.04);
  gunGroup.add(cylinderSwingGroup);

  // Crane Yoke Arm linking hinge to cylinder axis
  const craneArmGeo = trackGeo(new THREE.BoxGeometry(0.055, 0.155, 0.11));
  const craneArmMesh = new THREE.Mesh(craneArmGeo, gunMetalMat);
  craneArmMesh.position.set(0.052, 0.065, 0.045);
  craneArmMesh.rotation.z = -0.64;
  craneArmMesh.castShadow = true;
  cylinderSwingGroup.add(craneArmMesh);

  const cranePivotBossGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.18, 8));
  cranePivotBossGeo.rotateX(Math.PI / 2);
  const cranePivotBoss = new THREE.Mesh(cranePivotBossGeo, parkerizedSteelMat);
  cranePivotBoss.position.set(0, 0, 0.04);
  cylinderSwingGroup.add(cranePivotBoss);

  // Coaxial Ejector Rod & Knurled Locking Collar (moves out with the cylinder!)
  const ejectorRodGeo = trackGeo(new THREE.CylinderGeometry(0.019, 0.019, 0.36, 8));
  ejectorRodGeo.rotateX(Math.PI / 2);
  const ejectorRodMesh = new THREE.Mesh(ejectorRodGeo, polishedSteelMat);
  ejectorRodMesh.position.set(0.105, 0.125, 0.20);
  cylinderSwingGroup.add(ejectorRodMesh);

  const ejectorTipGeo = trackGeo(new THREE.CylinderGeometry(0.026, 0.022, 0.045, 8));
  ejectorTipGeo.rotateX(Math.PI / 2);
  const ejectorTipMesh = new THREE.Mesh(ejectorTipGeo, polishedSteelMat);
  ejectorTipMesh.position.set(0.105, 0.125, 0.37);
  cylinderSwingGroup.add(ejectorTipMesh);

  // Rotating Cylinder Spin Group centered at gun-local (0, 0.11, -0.05)
  const cylinderSpinGroup = new THREE.Group();
  cylinderSpinGroup.name = 'cylinderSpinGroup';
  cylinderSpinGroup.position.set(0.105, 0.125, -0.09);
  cylinderSwingGroup.add(cylinderSpinGroup);

  const cylDrumGeo = trackGeo(new THREE.CylinderGeometry(0.165, 0.165, 0.36, drumSegments));
  cylDrumGeo.rotateX(Math.PI / 2);
  const revolverCylinderMesh = new THREE.Mesh(cylDrumGeo, gunMetalMat);
  revolverCylinderMesh.castShadow = true;
  revolverCylinderMesh.receiveShadow = true;
  cylinderSpinGroup.add(revolverCylinderMesh);

  // Chamfered front & rear cylinder bevel rings
  const cylRimRingGeo = trackGeo(new THREE.CylinderGeometry(0.155, 0.165, 0.02, drumSegments));
  cylRimRingGeo.rotateX(Math.PI / 2);
  const cylFrontRing = new THREE.Mesh(cylRimRingGeo, parkerizedSteelMat);
  cylFrontRing.position.z = 0.18;
  cylinderSpinGroup.add(cylFrontRing);

  // Outer Flutes + Recessed Chamber Bores + 6 Individual Physically Seated Cartridges
  const fluteGeo = trackGeo(new THREE.BoxGeometry(0.046, 0.036, 0.27));
  const chamberBoreGeo = trackGeo(new THREE.CylinderGeometry(0.038, 0.038, 0.366, isHighPoly ? 10 : 8));
  chamberBoreGeo.rotateX(Math.PI / 2);

  const shellRimGeo = trackGeo(new THREE.CylinderGeometry(0.041, 0.041, 0.014, 10));
  shellRimGeo.rotateX(Math.PI / 2);
  const primerGeo = trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.008, 8));
  primerGeo.rotateX(Math.PI / 2);
  const casingBodyGeo = trackGeo(new THREE.CylinderGeometry(0.035, 0.0365, 0.258, 10));
  casingBodyGeo.rotateX(Math.PI / 2);
  const spentMouthGeo = trackGeo(new THREE.CylinderGeometry(0.029, 0.029, 0.014, 8));
  spentMouthGeo.rotateX(Math.PI / 2);

  // Seated jacketed magnum projectile (cylindrical shank + tapered ogive + flat meplat)
  const bulletShankGeo = trackGeo(new THREE.CylinderGeometry(0.0315, 0.0335, 0.048, 10));
  bulletShankGeo.rotateX(Math.PI / 2);
  const bulletOgiveGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.0315, 0.042, 10));
  bulletOgiveGeo.rotateX(Math.PI / 2);
  const bulletMeplatGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 10));
  bulletMeplatGeo.rotateX(Math.PI / 2);

  const chamberHighlightRingGeo = trackGeo(new THREE.RingGeometry(0.035, 0.048, 12));

  interface CartridgePartRefs {
    cartGroup: THREE.Group;
    rimMesh: THREE.Mesh;
    primerMesh: THREE.Mesh;
    casingMesh: THREE.Mesh;
    spentMouthMesh: THREE.Mesh;
    bulletGroup: THREE.Group;
    bulletShankMesh: THREE.Mesh;
    bulletOgiveMesh: THREE.Mesh;
    bulletMeplatMesh: THREE.Mesh;
    highlightFrontMesh: THREE.Mesh;
    highlightRearMesh: THREE.Mesh;
  }

  const chamberCartridges: THREE.Group[] = [];
  const cartridgeParts: CartridgePartRefs[] = [];
  const chamberRadius = 0.098;

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const cx = Math.sin(angle) * chamberRadius;
    const cy = Math.cos(angle) * chamberRadius;

    // Outer recessed flute groove between chambers
    const fluteAngle = angle + Math.PI / 6;
    const flute = new THREE.Mesh(fluteGeo, darkLinerMat);
    flute.position.set(Math.sin(fluteAngle) * 0.152, Math.cos(fluteAngle) * 0.152, 0.01);
    flute.rotation.z = -fluteAngle;
    cylinderSpinGroup.add(flute);

    // Recessed chamber bore
    const bore = new THREE.Mesh(chamberBoreGeo, darkLinerMat);
    bore.position.set(cx, cy, 0);
    cylinderSpinGroup.add(bore);

    // Active-chamber mirror inspection aperture highlight rings (front & rear face of chamber bore)
    const highlightFrontMesh = new THREE.Mesh(chamberHighlightRingGeo, blankHighlightRingMat);
    highlightFrontMesh.position.set(cx, cy, 0.183);
    highlightFrontMesh.visible = false;
    cylinderSpinGroup.add(highlightFrontMesh);

    const highlightRearMesh = new THREE.Mesh(chamberHighlightRingGeo, blankHighlightRingMat);
    highlightRearMesh.position.set(cx, cy, -0.190);
    highlightRearMesh.rotation.y = Math.PI;
    highlightRearMesh.visible = false;
    cylinderSpinGroup.add(highlightRearMesh);

    // Complete seated cartridge physically filling the chamber (z = -0.186 .. +0.171)
    const cartGroup = new THREE.Group();
    cartGroup.position.set(cx, cy, 0);

    const rimMesh = new THREE.Mesh(shellRimGeo, brassAccentMat);
    rimMesh.position.z = -0.182;
    cartGroup.add(rimMesh);

    const primerMesh = new THREE.Mesh(primerGeo, copperJacketMat);
    primerMesh.position.z = -0.186;
    cartGroup.add(primerMesh);

    const casingMesh = new THREE.Mesh(casingBodyGeo, brassAccentMat);
    casingMesh.position.z = -0.046; // spans -0.175 .. +0.083 inside bore
    cartGroup.add(casingMesh);

    const spentMouthMesh = new THREE.Mesh(spentMouthGeo, darkLinerMat);
    spentMouthMesh.position.z = 0.082;
    spentMouthMesh.visible = false;
    cartGroup.add(spentMouthMesh);

    // Jacketed projectile seated directly into casing mouth (+0.080 .. +0.171)
    const bulletGroup = new THREE.Group();
    const bulletShankMesh = new THREE.Mesh(bulletShankGeo, copperJacketMat);
    bulletShankMesh.position.z = 0.104;
    bulletGroup.add(bulletShankMesh);

    const bulletOgiveMesh = new THREE.Mesh(bulletOgiveGeo, copperJacketMat);
    bulletOgiveMesh.position.z = 0.147;
    bulletGroup.add(bulletOgiveMesh);

    const bulletMeplatMesh = new THREE.Mesh(bulletMeplatGeo, copperJacketMat);
    bulletMeplatMesh.position.z = 0.169;
    bulletGroup.add(bulletMeplatMesh);

    cartGroup.add(bulletGroup);
    cylinderSpinGroup.add(cartGroup);
    chamberCartridges.push(cartGroup);
    cartridgeParts.push({
      cartGroup,
      rimMesh,
      primerMesh,
      casingMesh,
      spentMouthMesh,
      bulletGroup,
      bulletShankMesh,
      bulletOgiveMesh,
      bulletMeplatMesh,
      highlightFrontMesh,
      highlightRearMesh,
    });
  }

  const updateChambersState = (chambers: Chamber[], inspectHighlightIndex: number | null) => {
    for (let i = 0; i < cartridgeParts.length; i++) {
      const p = cartridgeParts[i];
      const ch = chambers[i];
      const isHighlighted = inspectHighlightIndex !== null && inspectHighlightIndex === i;

      if (!ch || ch.isEjected) {
        // Unloaded cylinder or pliers-ejected chamber -> empty dark chamber bore
        p.cartGroup.visible = false;
        p.highlightFrontMesh.visible = false;
        p.highlightRearMesh.visible = false;
        continue;
      }

      p.cartGroup.visible = true;
      const isFired = !!ch.isSpent;
      p.bulletGroup.visible = !isFired;
      p.spentMouthMesh.visible = isFired;

      if (isHighlighted) {
        const bulletHLMat = ch.isLive ? liveHighlightBulletMat : blankHighlightBulletMat;
        const casingHLMat = ch.isLive ? liveHighlightCasingMat : blankHighlightCasingMat;
        const ringHLMat = ch.isLive ? liveHighlightRingMat : blankHighlightRingMat;

        p.rimMesh.material = casingHLMat;
        p.casingMesh.material = casingHLMat;
        p.primerMesh.material = bulletHLMat;
        p.bulletShankMesh.material = bulletHLMat;
        p.bulletOgiveMesh.material = bulletHLMat;
        p.bulletMeplatMesh.material = bulletHLMat;
        p.highlightFrontMesh.material = ringHLMat;
        p.highlightRearMesh.material = ringHLMat;
        p.highlightFrontMesh.visible = true;
        p.highlightRearMesh.visible = true;
      } else {
        p.rimMesh.material = brassAccentMat;
        p.casingMesh.material = brassAccentMat;
        p.primerMesh.material = isFired ? spentPrimerMat : copperJacketMat;
        p.bulletShankMesh.material = copperJacketMat;
        p.bulletOgiveMesh.material = copperJacketMat;
        p.bulletMeplatMesh.material = copperJacketMat;
        p.highlightFrontMesh.visible = false;
        p.highlightRearMesh.visible = false;
      }
    }
  };

  // Ejector Ratchet Star Gear + Center Pin on Rear Face
  const ejectorStarGeo = trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.025, 6));
  ejectorStarGeo.rotateX(Math.PI / 2);
  const ejectorStarMesh = new THREE.Mesh(ejectorStarGeo, polishedSteelMat);
  ejectorStarMesh.position.set(0, 0, -0.186);
  cylinderSpinGroup.add(ejectorStarMesh);

  const centerPinGeo = trackGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 6));
  centerPinGeo.rotateX(Math.PI / 2);
  const centerPinMesh = new THREE.Mesh(centerPinGeo, polishedSteelMat);
  centerPinMesh.position.set(0, 0, -0.01);
  cylinderSpinGroup.add(centerPinMesh);

  // --- 4. ARTICULATED HAMMER & CURVED TRIGGER ---
  const hammerPivotGroup = new THREE.Group();
  hammerPivotGroup.name = 'hammerPivotGroup';
  hammerPivotGroup.position.set(0, 0.155, -0.31);
  gunGroup.add(hammerPivotGroup);

  const hammerShape = new THREE.Shape();
  hammerShape.moveTo(-0.025, -0.04);
  hammerShape.lineTo(0.045, -0.02);
  hammerShape.lineTo(0.055, 0.055);
  hammerShape.lineTo(0.08, 0.068);  // Firing pin nose toward breech
  hammerShape.lineTo(0.045, 0.095);
  hammerShape.lineTo(-0.015, 0.11);
  hammerShape.lineTo(-0.075, 0.145); // Swept serrated thumb spur
  hammerShape.lineTo(-0.095, 0.125);
  hammerShape.lineTo(-0.04, 0.07);
  hammerShape.closePath();

  const hammerGeo = trackGeo(
    new THREE.ExtrudeGeometry(hammerShape, {
      depth: 0.036,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 1,
      curveSegments: 2,
    })
  );
  hammerGeo.translate(0, 0, -0.018);
  hammerGeo.rotateY(-Math.PI / 2);
  const hammerMesh = new THREE.Mesh(hammerGeo, polishedSteelMat);
  hammerMesh.castShadow = true;
  hammerPivotGroup.add(hammerMesh);

  // Trigger Pivot Group inside Trigger Guard
  const triggerPivotGroup = new THREE.Group();
  triggerPivotGroup.name = 'triggerPivotGroup';
  triggerPivotGroup.position.set(0, 0.035, -0.085);
  gunGroup.add(triggerPivotGroup);

  const triggerShape = new THREE.Shape();
  triggerShape.moveTo(-0.014, 0.0);
  triggerShape.lineTo(0.018, 0.0);
  triggerShape.lineTo(0.005, -0.06);
  triggerShape.lineTo(0.032, -0.115);
  triggerShape.lineTo(0.016, -0.125);
  triggerShape.lineTo(-0.022, -0.068);
  triggerShape.closePath();

  const triggerGeo = trackGeo(
    new THREE.ExtrudeGeometry(triggerShape, {
      depth: 0.022,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 1,
      curveSegments: 2,
    })
  );
  triggerGeo.translate(0, 0, -0.011);
  triggerGeo.rotateY(-Math.PI / 2);
  const triggerMesh = new THREE.Mesh(triggerGeo, polishedSteelMat);
  triggerPivotGroup.add(triggerMesh);

  // Trigger Guard Bow
  const guardGeo = trackGeo(new THREE.TorusGeometry(0.082, 0.016, torusSegments, torusSegments * 2, Math.PI));
  guardGeo.rotateY(Math.PI / 2);
  guardGeo.rotateX(Math.PI); // bow hangs downward (-Y)
  const guardMesh = new THREE.Mesh(guardGeo, gunMetalMat);
  guardMesh.position.set(0, -0.04, -0.075);
  gunGroup.add(guardMesh);

  // --- 5. HEAVY VENTILATED-RIB BARREL (REAR STUB z = 0.14..0.38 & SEVERABLE FRONT z = 0.38..0.90) ---
  // Starts cleanly ahead of the cylinder front face (z = +0.13) with a realistic forcing-cone gap
  const barrelRearGeo = trackGeo(new THREE.CylinderGeometry(0.070, 0.068, 0.24, barrelSegments));
  barrelRearGeo.rotateX(Math.PI / 2);
  const barrelRearMesh = new THREE.Mesh(barrelRearGeo, gunMetalMat);
  barrelRearMesh.position.set(0, 0.208, 0.26);
  barrelRearMesh.castShadow = true;
  barrelRearMesh.receiveShadow = true;
  gunGroup.add(barrelRearMesh);

  // Ventilated Top Rib (Rear Stub: top rail + 2 pillars forming real cutout vents)
  const topRailRearGeo = trackGeo(new THREE.BoxGeometry(0.056, 0.022, 0.32));
  const topRailRear = new THREE.Mesh(topRailRearGeo, gunMetalMat);
  topRailRear.position.set(0, 0.312, 0.22);
  topRailRear.castShadow = true;
  gunGroup.add(topRailRear);

  const ribPillarGeo = trackGeo(new THREE.BoxGeometry(0.048, 0.042, 0.048));
  [0.14, 0.26, 0.355].forEach((pz) => {
    const pillar = new THREE.Mesh(ribPillarGeo, gunMetalMat);
    pillar.position.set(0, 0.282, pz);
    gunGroup.add(pillar);
  });

  // Shrouded Full Underlug (Rear Stub)
  const underlugRearGeo = trackGeo(new THREE.BoxGeometry(0.084, 0.105, 0.24));
  const underlugRearMesh = new THREE.Mesh(underlugRearGeo, gunMetalMat);
  underlugRearMesh.position.set(0, 0.118, 0.26);
  underlugRearMesh.castShadow = true;
  gunGroup.add(underlugRearMesh);

  // Raw Sawed-Off Cut Face at z = 0.381 (glows hot during scalpel sawing!)
  const cutFaceRingGeo = trackGeo(new THREE.RingGeometry(0.044, 0.070, 12));
  const cutFaceRingMesh = new THREE.Mesh(cutFaceRingGeo, cutFaceMat);
  cutFaceRingMesh.position.set(0, 0.208, 0.381);
  gunGroup.add(cutFaceRingMesh);

  const cutFaceBoreGeo = trackGeo(new THREE.CylinderGeometry(0.044, 0.044, 0.10, 12));
  cutFaceBoreGeo.rotateX(Math.PI / 2);
  const cutFaceBoreMesh = new THREE.Mesh(cutFaceBoreGeo, darkLinerMat);
  cutFaceBoreMesh.position.set(0, 0.208, 0.33);
  gunGroup.add(cutFaceBoreMesh);

  const cutFaceTopRibGeo = trackGeo(new THREE.PlaneGeometry(0.056, 0.022));
  const cutFaceTopRibMesh = new THREE.Mesh(cutFaceTopRibGeo, cutFaceMat);
  cutFaceTopRibMesh.position.set(0, 0.312, 0.381);
  gunGroup.add(cutFaceTopRibMesh);

  const cutFaceUnderlugGeo = trackGeo(new THREE.PlaneGeometry(0.084, 0.105));
  const cutFaceUnderlugMesh = new THREE.Mesh(cutFaceUnderlugGeo, cutFaceMat);
  cutFaceUnderlugMesh.position.set(0, 0.118, 0.381);
  gunGroup.add(cutFaceUnderlugMesh);

  // --- 6. SEVERABLE FRONT BARREL GROUP (z = 0.38..0.90) ---
  const gunBarrelFrontGroup = new THREE.Group();
  gunBarrelFrontGroup.name = 'gunBarrelFrontGroup';

  const barrelFrontGeo = trackGeo(new THREE.CylinderGeometry(0.064, 0.068, 0.52, barrelSegments));
  barrelFrontGeo.rotateX(Math.PI / 2);
  const barrelFrontMesh = new THREE.Mesh(barrelFrontGeo, gunMetalMat);
  barrelFrontMesh.position.set(0, 0.208, 0.64);
  barrelFrontMesh.castShadow = true;
  barrelFrontMesh.receiveShadow = true;
  gunBarrelFrontGroup.add(barrelFrontMesh);

  // Front Ventilated Top Rib (top strap + 4 support struts)
  const topRailFrontGeo = trackGeo(new THREE.BoxGeometry(0.054, 0.022, 0.51));
  const topRailFront = new THREE.Mesh(topRailFrontGeo, gunMetalMat);
  topRailFront.position.set(0, 0.312, 0.64);
  topRailFront.castShadow = true;
  gunBarrelFrontGroup.add(topRailFront);

  [0.415, 0.545, 0.675, 0.83].forEach((pz) => {
    const pillar = new THREE.Mesh(ribPillarGeo, gunMetalMat);
    pillar.position.set(0, 0.282, pz);
    gunBarrelFrontGroup.add(pillar);
  });

  // Full Front Underlug Shroud (tapers cleanly before muzzle)
  const underlugFrontGeo = trackGeo(new THREE.BoxGeometry(0.082, 0.105, 0.45));
  const underlugFrontMesh = new THREE.Mesh(underlugFrontGeo, gunMetalMat);
  underlugFrontMesh.position.set(0, 0.118, 0.605);
  underlugFrontMesh.castShadow = true;
  gunBarrelFrontGroup.add(underlugFrontMesh);

  // Recessed Muzzle Crown & Dark Bore Cavity
  const muzzleCrownGeo = trackGeo(new THREE.RingGeometry(0.044, 0.064, 10));
  const muzzleCrownMesh = new THREE.Mesh(muzzleCrownGeo, polishedSteelMat);
  muzzleCrownMesh.position.set(0, 0.208, 0.901);
  gunBarrelFrontGroup.add(muzzleCrownMesh);

  const muzzleBoreGeo = trackGeo(new THREE.CylinderGeometry(0.044, 0.044, 0.14, 12));
  muzzleBoreGeo.rotateX(Math.PI / 2);
  const muzzleBoreMesh = new THREE.Mesh(muzzleBoreGeo, darkLinerMat);
  muzzleBoreMesh.position.set(0, 0.208, 0.835);
  gunBarrelFrontGroup.add(muzzleBoreMesh);

  // Ramp Front Sight with High-Visibility Sight Blade
  const frontSightRampShape = new THREE.Shape();
  frontSightRampShape.moveTo(0.75, 0.32);
  frontSightRampShape.lineTo(0.88, 0.32);
  frontSightRampShape.lineTo(0.88, 0.382);
  frontSightRampShape.lineTo(0.84, 0.382);
  frontSightRampShape.closePath();

  const frontSightGeo = trackGeo(
    new THREE.ExtrudeGeometry(frontSightRampShape, {
      depth: 0.022,
      bevelEnabled: false,
      curveSegments: 1,
    })
  );
  frontSightGeo.translate(0, 0, -0.011);
  frontSightGeo.rotateY(-Math.PI / 2);
  const frontSightMesh = new THREE.Mesh(frontSightGeo, parkerizedSteelMat);
  gunBarrelFrontGroup.add(frontSightMesh);

  const sightInsertGeo = trackGeo(new THREE.BoxGeometry(0.024, 0.028, 0.028));
  const sightDotMesh = new THREE.Mesh(sightInsertGeo, sightInsertMat);
  sightDotMesh.position.set(0, 0.365, 0.862);
  gunBarrelFrontGroup.add(sightDotMesh);

  // --- 7. PERSISTENT LOW-POLY BLOOD SMEARS ON REVOLVER ---
  const gunBloodGroup = new THREE.Group();
  gunBloodGroup.name = 'gunBloodGroup';
  gunBloodGroup.visible = false;

  const bloodSmearSpecs = [
    // Frame, cylinder & grip splatters
    { pos: [0.088, 0.14, -0.05], rot: [0.2, 0.1, 0.4], scale: [0.012, 0.075, 0.16] },
    { pos: [-0.088, 0.12, -0.08], rot: [-0.15, 0, 0.3], scale: [0.012, 0.06, 0.14] },
    { pos: [0.0, 0.344, 0.18], rot: [0, 0.12, 0], scale: [0.048, 0.010, 0.18] },
    { pos: [0.045, 0.21, 0.24], rot: [0.1, 0.2, 0.4], scale: [0.028, 0.05, 0.14] },
    { pos: [-0.045, 0.13, 0.29], rot: [0, -0.1, -0.3], scale: [0.032, 0.055, 0.12] },
    { pos: [0.095, -0.11, -0.38], rot: [0.35, 0, 0], scale: [0.022, 0.14, 0.085] },
    { pos: [-0.095, -0.14, -0.41], rot: [-0.35, 0, 0], scale: [0.022, 0.12, 0.075] },
  ];
  const smearBoxGeo = trackGeo(new THREE.OctahedronGeometry(0.5, 0));
  bloodSmearSpecs.forEach((sp) => {
    const m = new THREE.Mesh(smearBoxGeo, gunBloodMat);
    m.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
    m.rotation.set(sp.rot[0], sp.rot[1], sp.rot[2]);
    m.scale.set(sp.scale[0], sp.scale[1], sp.scale[2]);
    gunBloodGroup.add(m);
  });
  gunGroup.add(gunBloodGroup);

  const frontGunBloodGroup = new THREE.Group();
  frontGunBloodGroup.name = 'frontGunBloodGroup';
  frontGunBloodGroup.visible = false;
  [
    { pos: [0.038, 0.21, 0.80], rot: [0.1, 0.2, 0.5], scale: [0.042, 0.048, 0.14] },
    { pos: [-0.036, 0.17, 0.72], rot: [-0.1, -0.15, -0.4], scale: [0.042, 0.052, 0.16] },
    { pos: [0.0, 0.318, 0.78], rot: [0, 0.08, 0], scale: [0.045, 0.012, 0.15] },
    { pos: [0.0, 0.068, 0.74], rot: [0, 0, 0], scale: [0.055, 0.018, 0.14] },
  ].forEach((sp) => {
    const m = new THREE.Mesh(smearBoxGeo, gunBloodMat);
    m.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
    m.rotation.set(sp.rot[0], sp.rot[1], sp.rot[2]);
    m.scale.set(sp.scale[0], sp.scale[1], sp.scale[2]);
    frontGunBloodGroup.add(m);
  });
  gunBarrelFrontGroup.add(frontGunBloodGroup);

  gunGroup.add(gunBarrelFrontGroup);

  return {
    gunGroup,
    cylinderSwingGroup,
    cylinderSpinGroup,
    revolverCylinderMesh,
    chamberCartridges,
    cylinderLatchMesh,
    hammerPivotGroup,
    triggerPivotGroup,
    guardMesh,
    barrelRearMesh,
    barrelFrontMesh,
    gunBarrelFrontGroup,
    cutFaceRingMesh,
    cutFaceMat,
    gunBloodGroup,
    frontGunBloodGroup,
    updateChambersState,
    ownedGeometries,
    ownedMaterials,
  };
}

/**
 * Matching detailed low-poly severed barrel piece spawned when sawed off by the Scalpel/Hacksaw.
 */
export function createDetailedSeveredBarrelPiece(
  gunMetalMat: THREE.MeshStandardMaterial,
  polishedSteelMat: THREE.MeshStandardMaterial,
  darkLinerMat: THREE.MeshStandardMaterial,
  rawCutSteelMat: THREE.MeshStandardMaterial,
  barrelSegments: number
): THREE.Group {
  const grp = new THREE.Group();
  grp.name = 'severedBarrelPiece';

  const sightInsertMat = new THREE.MeshStandardMaterial({
    color: 0xd9531e,
    emissive: 0x330d00,
    roughness: 0.35,
    metalness: 0.15,
    flatShading: true,
  });

  const bFront = new THREE.Mesh(
    new THREE.CylinderGeometry(0.064, 0.068, 0.52, barrelSegments).rotateX(Math.PI / 2),
    gunMetalMat
  );
  bFront.position.set(0, 0.208, 0.26);
  bFront.castShadow = true;
  grp.add(bFront);

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.022, 0.51), gunMetalMat);
  topRail.position.set(0, 0.312, 0.26);
  topRail.castShadow = true;
  grp.add(topRail);

  const ribPillarGeo = new THREE.BoxGeometry(0.048, 0.042, 0.048);
  [0.035, 0.165, 0.295, 0.45].forEach((pz) => {
    const pillar = new THREE.Mesh(ribPillarGeo, gunMetalMat);
    pillar.position.set(0, 0.282, pz);
    grp.add(pillar);
  });

  const lugFront = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.105, 0.45), gunMetalMat);
  lugFront.position.set(0, 0.118, 0.225);
  lugFront.castShadow = true;
  grp.add(lugFront);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.062, 0.11), gunMetalMat);
  frontSight.position.set(0, 0.35, 0.44);
  grp.add(frontSight);

  const sightDot = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.028, 0.028), sightInsertMat);
  sightDot.position.set(0, 0.365, 0.482);
  grp.add(sightDot);

  const muzzleBore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.044, 0.044, 0.10, 12).rotateX(Math.PI / 2),
    darkLinerMat
  );
  muzzleBore.position.set(0, 0.208, 0.475);
  grp.add(muzzleBore);

  const muzzleCrown = new THREE.Mesh(new THREE.RingGeometry(0.044, 0.064, 10), polishedSteelMat);
  muzzleCrown.position.set(0, 0.208, 0.521);
  grp.add(muzzleCrown);

  // Hot glowing sheared back steel ring
  const hotCutMat = rawCutSteelMat.clone();
  hotCutMat.emissive = new THREE.Color(0xff4400);
  hotCutMat.emissiveIntensity = 0.85;
  const cutRingBack = new THREE.Mesh(new THREE.RingGeometry(0.044, 0.070, 12), hotCutMat);
  cutRingBack.rotation.y = Math.PI;
  cutRingBack.position.set(0, 0.208, 0.001);
  grp.add(cutRingBack);

  return grp;
}
