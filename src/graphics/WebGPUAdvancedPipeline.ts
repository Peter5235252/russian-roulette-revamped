import * as THREE from 'three';
import { RenderPipeline } from 'three/webgpu';
import {
  pass,
  mrt,
  output,
  normalView,
  metalness,
  roughness,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  int,
  mix,
  uv,
  length,
  smoothstep,
  convertToTexture,
} from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { ssr } from 'three/examples/jsm/tsl/display/SSRNode.js';
import { motionBlur } from 'three/examples/jsm/tsl/display/MotionBlur.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';
import { film } from 'three/examples/jsm/tsl/display/FilmNode.js';
import { chromaticAberration } from 'three/examples/jsm/tsl/display/ChromaticAberrationNode.js';
import { fsr1 } from 'three/examples/jsm/tsl/display/FSR1Node.js';
import { ControllerSettings } from '../controller';

export class WebGPUAdvancedPipeline {
  public renderPipeline: RenderPipeline | null = null;
  public scenePass: any = null;

  public uVelocity = uniform(vec2(0.0, 0.0));
  public uMotionBlurSamples = uniform(int(8));
  public uMotionBlurEnabled = uniform(1.0);

  public uAoIntensity = uniform(1.0);
  public uSsrIntensity = uniform(1.0);
  public uBloomIntensity = uniform(0.35);
  public uAberrationStrength = uniform(0.08);
  public uVignetteStrength = uniform(0.28);

  private isConfigured: boolean = false;
  private currentKey: string = '';
  private motionBlurScale: number = 0.5;
  private baseAberration: number = 0.0;
  private currentVelX: number = 0;
  private currentVelY: number = 0;

  constructor(private renderer: any, private scene: THREE.Scene, private camera: THREE.Camera) {
    this.initPipeline();
  }

  public initPipeline() {
    if (!this.renderer) return;

    try {
      this.renderPipeline = new RenderPipeline(this.renderer);
      this.scenePass = pass(this.scene, this.camera);

      const isWebGL = this.renderer.backend?.isWebGLBackend === true;
      if (!isWebGL) {
        // Configure MRT for output, normals, metalness, and roughness (WebGPU backend only)
        try {
          this.scenePass.setMRT(
            mrt({
              output: output,
              normal: normalView,
              metalness: metalness,
              roughness: roughness,
            })
          );
        } catch (mrtErr) {
          console.warn('MRT configuration skipped for WebGL fallback:', mrtErr);
        }
      }

      this.isConfigured = true;
    } catch (e) {
      console.warn('WebGPU Advanced Pipeline init fallback:', e);
    }
  }

  public rebuildGraph(settings: ControllerSettings, scale: number = 1.0) {
    if (!this.renderPipeline || !this.scenePass) return;

    const isWebGL = this.renderer?.backend?.isWebGLBackend === true;
    const gtaoQ = settings.gtaoQuality || 'low';
    const ssrQ = settings.ssrQuality || 'low';
    const mbQ = settings.motionBlurQuality || 'low';
    const aaMode = settings.antiAliasing || 'fxaa';
    const postProfile = settings.postProcessing || 'low';

    const gtaoOn = !isWebGL && settings.gtaoEnabled !== false;
    const ssrOn = !isWebGL && settings.ssrEnabled !== false;
    const mbOn = settings.motionBlurEnabled !== false;
    const upscaling = settings.webGpuUpscalingPreset || 'balanced';
    const sharpeningVal = settings.webGpuSharpening !== undefined ? settings.webGpuSharpening : 0.6;
    const contrastAdaptiveSharpness = Math.max(0.0, (1.0 - sharpeningVal) * 1.8);
    const bloomVal = settings.bloomIntensity !== undefined ? settings.bloomIntensity : 0.25;
    const mbIntensity = settings.motionBlurIntensity !== undefined ? settings.motionBlurIntensity : 0.35;

    // Track continuous scales for updateFrame()
    const mbQualityMult = mbQ === 'low' ? 0.5 : mbQ === 'medium' ? 0.75 : mbQ === 'high' ? 1.0 : 1.35;
    this.motionBlurScale = mbOn ? mbIntensity * mbQualityMult : 0;
    this.baseAberration = postProfile === 'cinematic' ? 0.14 : postProfile === 'high' ? 0.04 : 0.0;
    this.uAberrationStrength.value = this.baseAberration;
    this.uVignetteStrength.value = postProfile === 'cinematic' ? 0.38 : postProfile === 'high' ? 0.22 : 0.0;

    // Calibrate tone-mapping exposure cleanly per post-processing profile
    if (this.renderer) {
      this.renderer.toneMappingExposure =
        postProfile === 'cinematic' ? 1.08 : postProfile === 'high' ? 1.04 : 1.0;
    }

    const graphKey = `${isWebGL ? 'webgl' : 'webgpu'}_${postProfile}_${aaMode}_${gtaoQ}_${ssrQ}_${mbQ}_${bloomVal.toFixed(2)}_${upscaling}_${sharpeningVal.toFixed(2)}_${scale}`;
    if (graphKey === this.currentKey) return;
    this.currentKey = graphKey;

    // Adjust motion blur samples based on quality
    const mbSamplesMap: Record<string, number> = { low: 4, medium: 6, high: 8, ultra: 12 };
    const mbSamples = mbSamplesMap[mbQ] || 4;
    this.uMotionBlurSamples.value = mbSamples;

    try {
      if (typeof this.scenePass.setResolutionScale === 'function') {
        this.scenePass.setResolutionScale(scale);
      }

      let currentNode: any;

      if (!isWebGL) {
        const colorTex = this.scenePass.getTextureNode('output');
        const normalTex = this.scenePass.getTextureNode('normal');
        const depthTex = this.scenePass.getTextureNode('depth');
        const metalTex = this.scenePass.getTextureNode('metalness');
        const roughTex = this.scenePass.getTextureNode('roughness');

        currentNode = colorTex;

        // 1. Ground Truth Ambient Occlusion (GTAO) — applied before specular SSR so contact shadows look natural
        if (gtaoOn) {
          try {
            const aoPass = ao(depthTex, normalTex, this.camera);
            if (aoPass.samples && aoPass.samples.value !== undefined) {
              aoPass.samples.value = gtaoQ === 'low' ? 6 : gtaoQ === 'medium' ? 10 : gtaoQ === 'high' ? 14 : 16;
            }
            if (aoPass.radius && aoPass.radius.value !== undefined) {
              aoPass.radius.value = gtaoQ === 'low' ? 0.22 : gtaoQ === 'medium' ? 0.28 : gtaoQ === 'high' ? 0.34 : 0.42;
            }
            if (aoPass.resolutionScale !== undefined) {
              aoPass.resolutionScale = gtaoQ === 'low' ? 0.5 : gtaoQ === 'medium' ? 0.75 : 1.0;
            }
            const aoTex = aoPass.getTextureNode();
            const aoWeight = gtaoQ === 'low' ? 0.45 : gtaoQ === 'medium' ? 0.65 : gtaoQ === 'high' ? 0.84 : 0.96;
            const aoColor = mix(vec3(1.0), vec3(aoTex.r), float(aoWeight));
            currentNode = vec4(currentNode.rgb.mul(aoColor), currentNode.a);
          } catch (e) {
            console.warn('GTAO pass setup fallback:', e);
          }
        }

        // 2. Screen Space Reflections (SSR) — real-time reflections on gunmetal, wet blood puddles, and glass
        if (ssrOn) {
          try {
            const ssrPass = ssr(colorTex, depthTex, normalTex, metalTex, roughTex, this.camera);

            if (ssrPass.maxDistance && ssrPass.maxDistance.value !== undefined) {
              ssrPass.maxDistance.value = ssrQ === 'low' ? 3.2 : ssrQ === 'medium' ? 5.5 : ssrQ === 'high' ? 8.5 : 12.0;
            }
            if (ssrPass.thickness && ssrPass.thickness.value !== undefined) {
              ssrPass.thickness.value = ssrQ === 'low' ? 0.08 : ssrQ === 'medium' ? 0.1 : ssrQ === 'high' ? 0.12 : 0.14;
            }
            if (ssrPass.quality && ssrPass.quality.value !== undefined) {
              ssrPass.quality.value = ssrQ === 'low' ? 0.28 : ssrQ === 'medium' ? 0.52 : ssrQ === 'high' ? 0.8 : 1.0;
            }
            if (ssrPass.blurQuality && ssrPass.blurQuality.value !== undefined) {
              ssrPass.blurQuality.value = ssrQ === 'low' ? 1 : ssrQ === 'medium' ? 2 : ssrQ === 'high' ? 2 : 3;
            }
            if (ssrPass.opacity && ssrPass.opacity.value !== undefined) {
              ssrPass.opacity.value = ssrQ === 'low' ? 0.55 : ssrQ === 'medium' ? 0.72 : ssrQ === 'high' ? 0.88 : 1.0;
            }
            if (ssrPass.resolutionScale !== undefined) {
              ssrPass.resolutionScale = ssrQ === 'low' ? 0.5 : ssrQ === 'medium' ? 0.75 : 1.0;
            }

            const ssrColor = vec3(ssrPass.rgb);
            currentNode = vec4(currentNode.rgb.add(ssrColor), currentNode.a);
          } catch (e) {
            console.warn('SSR pass setup fallback:', e);
          }
        }
      } else {
        // Standard WebGL Beauty pass output node
        currentNode = typeof this.scenePass.getTextureNode === 'function'
          ? this.scenePass.getTextureNode()
          : this.scenePass;
      }

      // 3. Calibrated HDR Bloom (glowing filaments, embers, TV CRT tubes, eyes, muzzle flash)
      if (bloomVal > 0) {
        try {
          const bloomStrengthMult =
            postProfile === 'cinematic' ? 0.82 : postProfile === 'high' ? 0.65 : 0.42;
          const bloomRadius =
            postProfile === 'cinematic' ? 0.82 : postProfile === 'high' ? 0.68 : 0.52;
          const bloomThreshold =
            postProfile === 'cinematic' ? 0.56 : postProfile === 'high' ? 0.64 : 0.76;
          const bloomNode = bloom(
            currentNode,
            bloomVal * bloomStrengthMult,
            bloomRadius,
            bloomThreshold
          );
          currentNode = currentNode.add(bloomNode);
        } catch (e) {
          console.warn('Bloom pass setup fallback:', e);
        }
      }

      // 4. Optical Lens Calibration (Vignette, Chromatic Dispersion, Subtle Film Grain)
      if (postProfile === 'high' || postProfile === 'cinematic') {
        try {
          const caNode = chromaticAberration(currentNode, this.uAberrationStrength, vec2(0.5, 0.5), float(1.06));
          currentNode = caNode;
        } catch (e) {
          console.warn('Chromatic aberration pass setup fallback:', e);
        }

        // Subtle atmospheric optical vignette framing the interrogation table
        const screenDist = length(uv().sub(vec2(0.5, 0.5)));
        const vignetteMask = float(1.0).sub(smoothstep(float(0.32), float(0.86), screenDist).mul(this.uVignetteStrength));
        currentNode = vec4(currentNode.rgb.mul(vignetteMask), currentNode.a);

        if (postProfile === 'cinematic') {
          try {
            currentNode = film(currentNode, float(0.028));
          } catch (e) {
            console.warn('Film grain pass setup fallback:', e);
          }
        }
      }

      // 5. Object & Recoil Velocity Motion Blur
      if (mbOn) {
        try {
          const mbInput = typeof currentNode.sample === 'function' ? currentNode : convertToTexture(currentNode);
          const mbNode = motionBlur(mbInput, this.uVelocity, int(mbSamples));
          currentNode = mbNode;
        } catch (e) {
          console.warn('Motion Blur pass setup fallback:', e);
        }
      }

      // 6. Anti-Aliasing (SMAA / FXAA) — runs before Spatial Upscaling for crisp edge reconstruction
      try {
        if (aaMode === 'smaa') {
          currentNode = smaa(currentNode);
        } else {
          currentNode = fxaa(currentNode);
        }
      } catch (e) {
        console.warn('Anti-aliasing pass setup fallback:', e);
      }

      // 7. Spatial Upscaling & Robust Contrast-Adaptive Sharpening (active when not Native 100%)
      if (upscaling !== 'native') {
        try {
          currentNode = fsr1(currentNode, contrastAdaptiveSharpness);
        } catch (e) {
          console.warn('Spatial Upscaling / Contrast-Adaptive Sharpening pass fallback:', e);
        }
      }

      this.renderPipeline.outputNode = currentNode;
      this.renderPipeline.needsUpdate = true;
    } catch (err) {
      console.warn('WebGPU Advanced Pipeline rebuild error, falling back to scenePass:', err);
      this.renderPipeline.outputNode = this.scenePass;
    }
  }

  public updateFrame(
    delta: number,
    gameState: string,
    aimProgress: number,
    cameraShake: number,
    recoilKick: number
  ) {
    const dt = Math.max(0.001, Math.min(delta, 0.1));
    const decay = Math.exp(-16.0 * dt);

    // Physical gunshot recoil & shockwave velocity for Motion Blur and dynamic chromatic lens jolt
    const impulse = recoilKick * 0.028 + cameraShake * 0.003;
    if (impulse > 0.002 && this.motionBlurScale > 0) {
      const targetX = (Math.random() - 0.5) * impulse * this.motionBlurScale;
      const targetY = (Math.random() - 0.35) * impulse * this.motionBlurScale;
      this.currentVelX = this.currentVelX * decay + targetX * (1 - decay);
      this.currentVelY = this.currentVelY * decay + targetY * (1 - decay);
    } else {
      this.currentVelX *= decay;
      this.currentVelY *= decay;
    }

    this.uVelocity.value.set(this.currentVelX, this.currentVelY);
    this.uAberrationStrength.value = Math.min(0.85, this.baseAberration + recoilKick * 0.32 + cameraShake * 0.025);
  }

  public render() {
    if (this.renderPipeline) {
      this.renderPipeline.render();
    }
  }

  public dispose() {
    if (this.renderPipeline && typeof this.renderPipeline.dispose === 'function') {
      try {
        this.renderPipeline.dispose();
      } catch (e) {}
    }
  }
}
