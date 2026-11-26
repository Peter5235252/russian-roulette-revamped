import * as THREE from 'three';
import { 
  StorageInstancedBufferAttribute, 
  InstancedMesh, 
  MeshBasicNodeMaterial, 
  PlaneGeometry,
  Vector3
} from 'three/webgpu';
import { 
  Fn, 
  uniform, 
  instanceIndex, 
  storage, 
  float, 
  vec3, 
  vec4, 
  color, 
  mix, 
  sin, 
  cos, 
  exp,
  select,
  If, 
  clamp, 
  max,
  uv,
  length,
  positionLocal,
  cameraWorldMatrix
} from 'three/tsl';

export class WebGPUVolumetricSmokeSystem {
  public cigaretteSmokeMesh: InstancedMesh | null = null;
  public computeNode: any = null;

  public maxCigaretteParticles: number = 1024;

  private cigPosAttr: StorageInstancedBufferAttribute | null = null;
  private cigVelAttr: StorageInstancedBufferAttribute | null = null;
  private cigLifeAttr: StorageInstancedBufferAttribute | null = null; // x = life, y = maxLife, z = scale, w = rotation

  private uDeltaTime = uniform(0.016);
  private uTime = uniform(0.0);

  private currentHead: number = 0;
  private isInitialized: boolean = false;
  private qualityScale: number = 1.0;

  constructor(scene: THREE.Scene) {
    this.init(scene);
  }

  public setQuality(quality: 'low' | 'medium' | 'high' | 'ultra') {
    switch (quality) {
      case 'low': this.qualityScale = 0.45; break;
      case 'medium': this.qualityScale = 0.75; break;
      case 'high': this.qualityScale = 1.0; break;
      case 'ultra': this.qualityScale = 1.4; break;
    }
  }

  private init(scene: THREE.Scene) {
    try {
      const count = this.maxCigaretteParticles;

      this.cigPosAttr = new StorageInstancedBufferAttribute(count, 3);
      this.cigVelAttr = new StorageInstancedBufferAttribute(count, 3);
      this.cigLifeAttr = new StorageInstancedBufferAttribute(count, 4);

      const posArray = this.cigPosAttr.array as Float32Array;
      const velArray = this.cigVelAttr.array as Float32Array;
      const lifeArray = this.cigLifeAttr.array as Float32Array;

      for (let i = 0; i < count; i++) {
        posArray[i * 3 + 0] = 0;
        posArray[i * 3 + 1] = -100;
        posArray[i * 3 + 2] = 0;

        velArray[i * 3 + 0] = 0;
        velArray[i * 3 + 1] = 0;
        velArray[i * 3 + 2] = 0;

        lifeArray[i * 4 + 0] = 2; // inactive at boot (>= maxLife)
        lifeArray[i * 4 + 1] = 1;
        lifeArray[i * 4 + 2] = 0.03;
        lifeArray[i * 4 + 3] = 0;
      }

      const posStorage = storage(this.cigPosAttr, 'vec3', count);
      const velStorage = storage(this.cigVelAttr, 'vec3', count);
      const lifeStorage = storage(this.cigLifeAttr, 'vec4', count);

      // WebGPU Compute Shader for Grounded Atmospheric Smoke Plumes (preserves directional exhale jet with air drag + buoyant curl)
      this.computeNode = Fn(() => {
        const idx = instanceIndex;
        const p = posStorage.element(idx);
        const v = velStorage.element(idx);
        const l = lifeStorage.element(idx);

        const currentLife = l.x;
        const maxLife = l.y;

        If(currentLife.lessThan(maxLife), () => {
          l.x.addAssign(this.uDeltaTime);

          // Air drag slows directed exhale plume smoothly into ambient room drift
          const drag = clamp(float(1.0).sub(this.uDeltaTime.mul(1.85)), 0.0, 1.0);
          v.x.mulAssign(drag);
          v.z.mulAssign(drag);
          v.y.mulAssign(clamp(float(1.0).sub(this.uDeltaTime.mul(0.85)), 0.0, 1.0));

          // Gentle buoyancy & turbulent room curl
          const t = this.uTime.add(float(idx).mul(0.11));
          const curlX = sin(t.mul(1.4).add(p.y.mul(4.5))).mul(0.06);
          const curlZ = cos(t.mul(1.1).add(p.y.mul(3.8))).mul(0.06);

          v.x.addAssign(curlX.mul(this.uDeltaTime));
          v.y.addAssign(float(0.095).mul(this.uDeltaTime)); // warm smoke rises softly
          v.z.addAssign(curlZ.mul(this.uDeltaTime));

          // Position update
          p.addAssign(v.mul(this.uDeltaTime));

          // Soft expansion and swirl rotation
          l.z.addAssign(float(0.042).mul(this.uDeltaTime));
          l.w.addAssign(float(0.28).mul(this.uDeltaTime));
        });
      })().compute(count);

      // Billboarded soft wisp geometry
      const geom = new THREE.PlaneGeometry(0.06, 0.06);

      const mat = new MeshBasicNodeMaterial();
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = THREE.NormalBlending;

      const instancePos = posStorage.element(instanceIndex);
      const instanceLife = lifeStorage.element(instanceIndex);
      const curLife = instanceLife.x;
      const mLife = instanceLife.y;
      const isActive = curLife.lessThan(mLife);
      const lifeRatio = clamp(curLife.div(max(mLife, 0.01)), 0.0, 1.0);

      // Rotate and scale plane vertices facing camera in world space
      const activeSize = select(isActive, instanceLife.z.div(0.03), float(0.0));
      const angle = instanceLife.w;
      const ca = cos(angle);
      const sa = sin(angle);
      const rx = positionLocal.x.mul(ca).sub(positionLocal.y.mul(sa)).mul(activeSize);
      const ry = positionLocal.x.mul(sa).add(positionLocal.y.mul(ca)).mul(activeSize);
      const billboardOffset = cameraWorldMatrix.mul(vec4(rx, ry, 0.0, 0.0)).xyz;

      mat.positionNode = instancePos.add(billboardOffset);

      // Soft gaussian smoke puff with zero square boundary
      const uvs = uv();
      const distFromCenter = length(uvs.sub(0.5));
      const gaussian = exp(distFromCenter.mul(distFromCenter).mul(-16.0));
      const edgeMask = clamp(float(1.0).sub(distFromCenter.mul(2.1)), 0.0, 1.0);
      const puffAlpha = gaussian.mul(edgeMask);

      // Quick bloom in, lingering drift, smooth dissolve
      const fadeIn = clamp(lifeRatio.mul(7.0), 0.0, 1.0);
      const fadeOut = clamp(float(1.0).sub(lifeRatio), 0.0, 1.0);
      const envAlpha = fadeIn.mul(fadeOut).mul(fadeOut);
      const finalAlpha = select(isActive, puffAlpha.mul(envAlpha).mul(0.24), float(0.0));

      const baseSmokeColor = color(0x7c848f);
      const litSmokeColor = color(0xb2bac5);
      const smokeTint = mix(baseSmokeColor, litSmokeColor, fadeOut);

      mat.colorNode = vec4(smokeTint, finalAlpha);

      this.cigaretteSmokeMesh = new InstancedMesh(geom, mat, count);
      this.cigaretteSmokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.cigaretteSmokeMesh.frustumCulled = false;

      scene.add(this.cigaretteSmokeMesh);

      this.isInitialized = true;
    } catch (e) {
      console.warn('WebGPU Volumetric Smoke init fallback:', e);
    }
  }

  public emitPuff(
    origin: THREE.Vector3,
    direction: THREE.Vector3 = new THREE.Vector3(0, 0.25, 0),
    count: number = 6,
    speed: number = 0.18,
    lifespan: number = 3.2
  ) {
    if (!this.cigPosAttr || !this.cigVelAttr || !this.cigLifeAttr) return;

    const posArray = this.cigPosAttr.array as Float32Array;
    const velArray = this.cigVelAttr.array as Float32Array;
    const lifeArray = this.cigLifeAttr.array as Float32Array;

    const total = this.maxCigaretteParticles;
    const spawnAmount = Math.max(1, Math.min(Math.round(count * this.qualityScale), 24));

    for (let i = 0; i < spawnAmount; i++) {
      const idx = (this.currentHead + i) % total;

      posArray[idx * 3 + 0] = origin.x + (Math.random() - 0.5) * 0.015;
      posArray[idx * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.015;
      posArray[idx * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.015;

      velArray[idx * 3 + 0] = direction.x * speed + (Math.random() - 0.5) * 0.03;
      velArray[idx * 3 + 1] = direction.y * speed + Math.random() * 0.06;
      velArray[idx * 3 + 2] = direction.z * speed + (Math.random() - 0.5) * 0.03;

      lifeArray[idx * 4 + 0] = 0.0;
      lifeArray[idx * 4 + 1] = lifespan * (0.75 + 0.25 * this.qualityScale) * (0.8 + Math.random() * 0.4);
      lifeArray[idx * 4 + 2] = 0.02 + Math.random() * 0.01;
      lifeArray[idx * 4 + 3] = Math.random() * Math.PI * 2;
    }

    this.currentHead = (this.currentHead + spawnAmount) % total;
    this.cigPosAttr.needsUpdate = true;
    this.cigVelAttr.needsUpdate = true;
    this.cigLifeAttr.needsUpdate = true;
  }

  public update(renderer: any, delta: number, elapsedTime: number, camera: THREE.Camera) {
    if (!this.isInitialized || !renderer) return;

    this.uDeltaTime.value = Math.min(delta, 0.05);
    this.uTime.value = elapsedTime;

    if (this.computeNode && typeof renderer.compute === 'function') {
      try {
        renderer.compute(this.computeNode);
      } catch (e) {}
    }
  }

  public async precompile(renderer: any): Promise<void> {
    if (!this.isInitialized || !this.computeNode || !renderer) return;
    this.uDeltaTime.value = 0.0;
    this.uTime.value = 0.0;
    if (typeof renderer.computeAsync === 'function') {
      await renderer.computeAsync(this.computeNode);
    } else if (typeof renderer.compute === 'function') {
      renderer.compute(this.computeNode);
    }
  }

  public dispose(scene: THREE.Scene) {
    if (this.cigaretteSmokeMesh) {
      scene.remove(this.cigaretteSmokeMesh);
      if (this.cigaretteSmokeMesh.geometry) this.cigaretteSmokeMesh.geometry.dispose();
      this.cigaretteSmokeMesh = null;
    }
  }
}
