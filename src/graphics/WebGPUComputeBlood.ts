import * as THREE from 'three';
import { 
  StorageInstancedBufferAttribute, 
  InstancedMesh, 
  MeshStandardNodeMaterial, 
  SphereGeometry,
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
  clamp, 
  If, 
  min, 
  max,
  sub,
  add,
  mul,
  div,
  length,
  abs,
  select,
  positionLocal
} from 'three/tsl';

export class WebGPUComputeBloodSystem {
  public mesh: InstancedMesh | null = null;
  public computeNode: any = null;
  public maxParticles: number = 8192;
  
  private posAttribute: StorageInstancedBufferAttribute | null = null;
  private velAttribute: StorageInstancedBufferAttribute | null = null;
  private lifeAttribute: StorageInstancedBufferAttribute | null = null; // x = life, y = maxLife, z = size, w = hasLanded (0 or 1)
  
  private uDeltaTime = uniform(0.016);
  private uGravity = uniform(9.8);
  private uTableHeight = uniform(0.553);
  private uFloorHeight = uniform(-0.89);
  private uSpawnIndex = uniform(0);
  private uSpawnCount = uniform(0);
  private uSpawnOrigin = uniform(vec3(0, 0, 0));
  private uSpawnVel = uniform(vec3(0, 0, 0));
  private uSpawnSpread = uniform(0.5);
  private uSpawnSpeed = uniform(2.0);
  private uTime = uniform(0);

  private currentHead: number = 0;
  private isInitialized: boolean = false;
  private qualityScale: number = 1.0;

  constructor(scene: THREE.Scene, maxParticles: number = 8192) {
    this.maxParticles = maxParticles;
    this.init(scene);
  }

  public setQuality(quality: 'low' | 'medium' | 'high' | 'ultra') {
    switch (quality) {
      case 'low': this.qualityScale = 0.45; break;
      case 'medium': this.qualityScale = 0.72; break;
      case 'high': this.qualityScale = 1.0; break;
      case 'ultra': this.qualityScale = 1.4; break;
    }
  }

  private init(scene: THREE.Scene) {
    try {
      const count = this.maxParticles;

      // Create storage buffers for positions, velocities, and life metadata
      this.posAttribute = new StorageInstancedBufferAttribute(count, 3);
      this.velAttribute = new StorageInstancedBufferAttribute(count, 3);
      this.lifeAttribute = new StorageInstancedBufferAttribute(count, 4);

      // Initialize all blood particles off-screen / inactive
      const posArray = this.posAttribute.array as Float32Array;
      const velArray = this.velAttribute.array as Float32Array;
      const lifeArray = this.lifeAttribute.array as Float32Array;

      for (let i = 0; i < count; i++) {
        posArray[i * 3 + 0] = 0;
        posArray[i * 3 + 1] = -100; // deep below
        posArray[i * 3 + 2] = 0;

        velArray[i * 3 + 0] = 0;
        velArray[i * 3 + 1] = 0;
        velArray[i * 3 + 2] = 0;

        lifeArray[i * 4 + 0] = 2; // current life (>= maxLife so inactive at boot)
        lifeArray[i * 4 + 1] = 1; // max life
        lifeArray[i * 4 + 2] = 0.015; // base size
        lifeArray[i * 4 + 3] = 0; // has landed
      }

      // Storage nodes for TSL compute shader
      const posStorage = storage(this.posAttribute, 'vec3', count);
      const velStorage = storage(this.velAttribute, 'vec3', count);
      const lifeStorage = storage(this.lifeAttribute, 'vec4', count);

      // WebGPU Compute Shader for Blood Physics
      this.computeNode = Fn(() => {
        const idx = instanceIndex;
        const p = posStorage.element(idx);
        const v = velStorage.element(idx);
        const l = lifeStorage.element(idx);

        const currentLife = l.x;
        const maxLife = l.y;
        const hasLanded = l.w;

        // If particle is active (currentLife < maxLife)
        If(currentLife.lessThan(maxLife), () => {
          // Increment life
          l.x.addAssign(this.uDeltaTime);

          // If not landed on the surface yet, simulate ballistics
          If(hasLanded.equal(0.0), () => {
            // Apply gravity and viscous air drag
            v.y.subAssign(this.uGravity.mul(this.uDeltaTime));
            v.mulAssign(float(0.985)); // air drag

            // Position update
            p.addAssign(v.mul(this.uDeltaTime));

            // Check table footprint bounds: X [-3.22, 3.22], Z [-2.78, 1.58]
            const inTableX = abs(p.x).lessThanEqual(3.22);
            const inTableZ = p.z.greaterThanEqual(-2.78).and(p.z.lessThanEqual(1.58));
            const onTableFootprint = inTableX.and(inTableZ);

            // Collision against steel table top plane (spill past edges drops to floor)
            If(onTableFootprint.and(p.y.lessThanEqual(this.uTableHeight)).and(p.y.greaterThanEqual(0.38)), () => {
              p.y.assign(this.uTableHeight.add(0.002));
              v.assign(vec3(0.0, 0.0, 0.0));
              l.w.assign(1.0); // landed
              l.z.mulAssign(2.35);
            });

            // Collision against concrete floor
            If(p.y.lessThanEqual(this.uFloorHeight), () => {
              p.y.assign(this.uFloorHeight.add(0.002));
              v.assign(vec3(0.0, 0.0, 0.0));
              l.w.assign(1.0);
              l.z.mulAssign(2.6);
            });
          }).Else(() => {
            // Subtle early puddle creep / viscous spreading during first 1.5s
            If(currentLife.lessThan(1.5), () => {
              l.z.addAssign(float(0.006).mul(this.uDeltaTime));
            });
          });
        });
      })().compute(count);

      // Instanced Mesh Geometry: Crisp faceted low-poly droplet & clot chunk
      const geom = new THREE.OctahedronGeometry(0.013, 0);
      
      // Node Material with custom TSL vertex & fragment shading
      const mat = new MeshStandardNodeMaterial();
      mat.flatShading = true;
      mat.roughness = 0.06; // Wet glossy specular for highlights
      mat.metalness = 0.14;
      mat.roughnessNode = float(0.06);
      mat.metalnessNode = float(0.14);
      
      // Position node driven by WebGPU compute storage buffer
      const instancePos = posStorage.element(instanceIndex);
      const instanceVel = velStorage.element(instanceIndex);
      const instanceLife = lifeStorage.element(instanceIndex);
      const isLanded = instanceLife.w;
      const curLife = instanceLife.x;
      const mLife = instanceLife.y;
      const isActive = curLife.lessThan(mLife);
      const lifeRatio = curLife.div(max(mLife, 0.01));

      // Scale droplet dynamically: stretch along speed while falling, flatten into jagged low-poly puddle when landed
      const sizeScale = instanceLife.z.div(0.013);
      const fallStretch = float(1.0).add(clamp(length(instanceVel).mul(0.45), 0.0, 2.8));
      const airborneScale = vec3(sizeScale, sizeScale.mul(fallStretch), sizeScale);
      const landedScale = vec3(sizeScale.mul(2.5), sizeScale.mul(0.11), sizeScale.mul(2.5));

      const activeScale = mix(airborneScale, landedScale, isLanded);
      const finalScale = select(isActive, activeScale, vec3(0.0, 0.0, 0.0));

      mat.positionNode = positionLocal.mul(finalScale).add(instancePos);
      
      // Visceral deep venous/arterial red color with oxidized dark scab darkening as it ages
      const freshBloodColor = color(0x4f0202);
      const coagulatedBloodColor = color(0x160001);
      mat.colorNode = mix(freshBloodColor, coagulatedBloodColor, clamp(lifeRatio, 0.0, 1.0));
      mat.emissiveNode = color(0x0b0000);

      this.mesh = new InstancedMesh(geom, mat, count);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;

      scene.add(this.mesh);
      this.isInitialized = true;
    } catch (e) {
      console.warn('WebGPU Compute Blood initialization fallback:', e);
    }
  }

  public emitBurst(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    count: number = 32,
    speed: number = 2.5,
    spread: number = 0.6,
    lifespan: number = 18.0
  ) {
    if (!this.posAttribute || !this.velAttribute || !this.lifeAttribute) return;

    const posArray = this.posAttribute.array as Float32Array;
    const velArray = this.velAttribute.array as Float32Array;
    const lifeArray = this.lifeAttribute.array as Float32Array;

    const total = this.maxParticles;
    const spawnAmount = Math.max(1, Math.min(Math.round(count * this.qualityScale), 512));

    for (let i = 0; i < spawnAmount; i++) {
      const idx = (this.currentHead + i) % total;

      // Offset slightly around origin
      posArray[idx * 3 + 0] = origin.x + (Math.random() - 0.5) * 0.04;
      posArray[idx * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.04;
      posArray[idx * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.04;

      // Random cone velocity around direction
      const vx = direction.x * speed + (Math.random() - 0.5) * spread * speed;
      const vy = direction.y * speed + Math.random() * spread * speed + 0.4;
      const vz = direction.z * speed + (Math.random() - 0.5) * spread * speed;

      velArray[idx * 3 + 0] = vx;
      velArray[idx * 3 + 1] = vy;
      velArray[idx * 3 + 2] = vz;

      lifeArray[idx * 4 + 0] = 0.0; // life
      lifeArray[idx * 4 + 1] = lifespan + Math.random() * 5.0; // maxLife (long persistent table puddle)
      lifeArray[idx * 4 + 2] = 0.012 + Math.random() * 0.016; // base size
      lifeArray[idx * 4 + 3] = 0.0; // hasLanded
    }

    this.currentHead = (this.currentHead + spawnAmount) % total;
    this.posAttribute.needsUpdate = true;
    this.velAttribute.needsUpdate = true;
    this.lifeAttribute.needsUpdate = true;
  }

  public update(renderer: any, delta: number, elapsedTime: number) {
    if (!this.isInitialized || !this.computeNode || !renderer) return;

    this.uDeltaTime.value = Math.min(delta, 0.05);
    this.uTime.value = elapsedTime;

    try {
      if (typeof renderer.compute === 'function') {
        renderer.compute(this.computeNode);
      }
    } catch (e) {
      // Graceful ignore during context recreation
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

  public clear() {
    if (!this.posAttribute || !this.lifeAttribute) return;
    const posArray = this.posAttribute.array as Float32Array;
    const lifeArray = this.lifeAttribute.array as Float32Array;
    for (let i = 0; i < this.maxParticles; i++) {
      posArray[i * 3 + 1] = -100;
      lifeArray[i * 4 + 0] = lifeArray[i * 4 + 1] + 1;
    }
    this.posAttribute.needsUpdate = true;
    this.lifeAttribute.needsUpdate = true;
    this.currentHead = 0;
  }

  public dispose(scene: THREE.Scene) {
    if (this.mesh) {
      scene.remove(this.mesh);
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }
}
