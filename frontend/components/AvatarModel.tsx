import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader, DRACOLoader, KTX2Loader } from 'three-stdlib';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

type AnimationName = 'idle' | 'walking' | 'running';

interface AvatarModelProps {
  modelUrl: string;
  idleUrl?: string | null;
  walkingUrl?: string | null;
  runningUrl?: string | null;
  animation?: AnimationName;
  onAnimationsReady?: (availability: Record<AnimationName, boolean>) => void;
}

// ── WHITELIST approach ──
// Only bones matching these patterns are allowed to animate during walk/run.
// Everything else (head, spine, hair, face…) is frozen.
const LOCOMOTION_ALLOWED_PATTERNS = [
  // Root / hips
  'hips', 'root', 'pelvis', 'armature', 'mixamorighips',
  // Legs only — arms/shoulders are excluded to prevent face deformation
  // on chibi models where shoulder skin weights bleed into the head.
  'upleg', 'thigh', 'leg', 'shin', 'knee',
  'foot', 'toe', 'ankle', 'ball',
  // Mixamo leg naming
  'mixamorigleftupleg', 'mixamorigleftleg', 'mixamorigleftfoot', 'mixamoriglefttoebase',
  'mixamorigrightupleg', 'mixamorigrightleg', 'mixamorigrightfoot', 'mixamorigrighttoebase',
];

const HAIR_PATTERNS = [
  'hair', 'bang', 'ponytail', 'fringe', 'braid', 'bun', 'helmet', 'hood',
  'pelo', 'cabello', 'coleta', 'trenza', 'chongo', 'flequillo', 'mechon', 'moño',
];

const ROOT_BONE_PATTERNS = [
  'hips', 'root', 'pelvis', 'armature',
  'mixamorighips',
];

type LockedBone = {
  bone: THREE.Bone;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};

type LockedMorphTarget = {
  mesh: THREE.Mesh & { morphTargetInfluences?: number[] };
  baseInfluences: number[];
};

type LockedObject = {
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};

type HeadRegionDetector = (object?: THREE.Object3D | null) => boolean;

/** Returns true if the bone name is allowed to animate during locomotion */
function isLocomotionBone(name?: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return LOCOMOTION_ALLOWED_PATTERNS.some(p => lower.includes(p));
}

function isHairName(name?: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return HAIR_PATTERNS.some(p => lower.includes(p));
}

function isRootBone(trackName: string): boolean {
  const boneName = trackName.split('.').slice(0, -1).join('.').toLowerCase();
  return ROOT_BONE_PATTERNS.some(p => boneName.includes(p));
}

function isMorphTargetTrack(trackName: string): boolean {
  const lower = trackName.toLowerCase();
  return (
    lower.includes('morphtarget') ||
    lower.includes('blendshape') ||
    lower.includes('expression') ||
    lower.includes('morphtargetinfluences') ||
    lower.includes('.weights')
  );
}

function isLocomotionAnimation(name?: AnimationName): boolean {
  return name === 'walking' || name === 'running';
}

function normalizeAnimationName(name: string): AnimationName | null {
  const lower = name.toLowerCase();
  if (lower.includes('walk')) return 'walking';
  if (lower.includes('run') || lower.includes('jog')) return 'running';
  if (lower.includes('idle') || lower.includes('pose') || lower.includes('breath')) return 'idle';
  return null;
}

function createHeadRegionDetector(scene: THREE.Object3D): HeadRegionDetector {
  const bones: THREE.Bone[] = [];
  scene.traverse((child: any) => {
    if (child.isBone) bones.push(child);
  });

  if (bones.length === 0) return () => false;

  scene.updateMatrixWorld(true);

  let topY = -Infinity;
  const scratch = new THREE.Vector3();
  bones.forEach(bone => {
    const pos = bone.getWorldPosition(scratch);
    if (pos.y > topY) topY = pos.y;
  });

  const rootBone =
    bones.find(bone => {
      const lower = bone.name?.toLowerCase() ?? '';
      return ROOT_BONE_PATTERNS.some(pattern => lower.includes(pattern));
    }) ?? bones[0];

  const rootPos = rootBone.getWorldPosition(new THREE.Vector3());
  const height = Math.max(1e-4, topY - rootPos.y);
  const radialThreshold = height * 0.35;
  const minRatio = 0.6;
  const worldPos = new THREE.Vector3();

  return (object?: THREE.Object3D | null) => {
    if (!object) return false;
    object.updateMatrixWorld?.(true);
    object.getWorldPosition(worldPos);
    const heightRatio = (worldPos.y - rootPos.y) / height;
    if (!Number.isFinite(heightRatio) || heightRatio < minRatio) return false;
    const radial = Math.hypot(worldPos.x - rootPos.x, worldPos.z - rootPos.z);
    return radial <= radialThreshold;
  };
}

/**
 * Known bone name aliases: Mixamo stripped name (lowercase) → possible Meshy rig names.
 */
const BONE_ALIASES: Record<string, string[]> = {
  'hips': ['Hips'], 'spine': ['Spine'], 'spine1': ['Spine01', 'Spine1'],
  'spine2': ['Spine02', 'Spine2'], 'neck': ['neck', 'Neck'],
  'head': ['Head', 'head'], 'headtop_end': ['head_end', 'headfront'],
  'leftshoulder': ['LeftShoulder'], 'leftarm': ['LeftArm'],
  'leftforearm': ['LeftForeArm'], 'lefthand': ['LeftHand'],
  'rightshoulder': ['RightShoulder'], 'rightarm': ['RightArm'],
  'rightforearm': ['RightForeArm'], 'righthand': ['RightHand'],
  'leftupleg': ['LeftUpLeg'], 'leftleg': ['LeftLeg'],
  'leftfoot': ['LeftFoot'], 'lefttoebase': ['LeftToeBase'],
  'rightupleg': ['RightUpLeg'], 'rightleg': ['RightLeg'],
  'rightfoot': ['RightFoot'], 'righttoebase': ['RightToeBase'],
};

/**
 * Remap animation track bone names (e.g. mixamorigHips.position → Hips.position)
 * to match the actual skeleton in the scene. This fixes the mismatch between
 * Mixamo animation bone naming and Meshy rig bone naming.
 */
function retargetClipToSkeleton(clip: THREE.AnimationClip, scene: THREE.Object3D): void {
  // Collect all bone names from the scene
  const boneNames = new Set<string>();
  scene.traverse((child: any) => {
    if (child.isBone || child.isObject3D) {
      if (child.name) boneNames.add(child.name);
    }
  });

  // Build lowercase → actual name map
  const lowerToBone = new Map<string, string>();
  for (const name of boneNames) {
    lowerToBone.set(name.toLowerCase(), name);
  }

  // Resolve a single bone name from animation track to scene bone
  const resolveBone = (animBone: string): string | null => {
    if (boneNames.has(animBone)) return animBone;
    // Strip mixamorig prefix
    const stripped = animBone.replace(/^mixamorig/i, '');
    if (stripped && boneNames.has(stripped)) return stripped;
    // Known aliases
    if (stripped) {
      const aliases = BONE_ALIASES[stripped.toLowerCase()];
      if (aliases) {
        for (const a of aliases) {
          if (boneNames.has(a)) return a;
        }
      }
      // Case-insensitive on stripped
      const found = lowerToBone.get(stripped.toLowerCase());
      if (found) return found;
    }
    // Case-insensitive on full name
    return lowerToBone.get(animBone.toLowerCase()) ?? null;
  };

  let remapped = 0;
  for (const track of clip.tracks) {
    // Track name format: "BoneName.property" (e.g. "mixamorigHips.position")
    const dotIdx = track.name.indexOf('.');
    if (dotIdx < 0) continue;
    const bonePart = track.name.substring(0, dotIdx);
    const propPart = track.name.substring(dotIdx);
    const resolved = resolveBone(bonePart);
    if (resolved && resolved !== bonePart) {
      track.name = resolved + propPart;
      remapped++;
    }
  }
  if (remapped > 0) {
    console.log(`[AvatarModel] Retargeted ${remapped}/${clip.tracks.length} tracks in clip "${clip.name}"`);
  }
}

function sanitizeClipTracks(
  clip: THREE.AnimationClip,
  name: AnimationName,
  _lockedBoneNames?: Set<string>,
) {
  const isLocomotion = name === 'walking' || name === 'running';
  clip.tracks = clip.tracks.filter(track => {
    // Always strip morph targets during locomotion
    if (isLocomotion && isMorphTargetTrack(track.name)) return false;

    if (isLocomotion) {
      // Always remove ALL .scale tracks — prevents body fattening / stretching
      if (track.name.endsWith('.scale')) return false;

      // Extract the bone name from the track (e.g. "Hips.position" → "Hips")
      const boneName = track.name.split('.').slice(0, -1).join('.');

      // WHITELIST: only keep tracks for locomotion-allowed bones (hips + legs)
      if (!isLocomotionBone(boneName)) return false;

      // Even for allowed bones, only root/hips may have .position tracks
      if (track.name.endsWith('.position') && !isRootBone(track.name)) return false;
    }
    return true;
  });
}

function configureGLTFLoader(loader: GLTFLoader, gl: THREE.WebGLRenderer) {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(dracoLoader);

  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/ktx-parse@0.5.0/dist/');
  ktx2Loader.detectSupport(gl);
  loader.setKTX2Loader(ktx2Loader);

  loader.setMeshoptDecoder(MeshoptDecoder);
}

export function AvatarModel({ modelUrl, idleUrl, walkingUrl, runningUrl, animation = 'idle', onAnimationsReady }: AvatarModelProps) {
  console.log('[AvatarModel] Loading avatar model from:', modelUrl);
  console.log('[AvatarModel] Animation URLs:', { idleUrl, walkingUrl, runningUrl });
  
  const { gl } = useThree();
  const gltf = useLoader(GLTFLoader, modelUrl, loader => configureGLTFLoader(loader as GLTFLoader, gl));
  const { scene } = gltf;
  
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const lockedBonesRef = useRef<LockedBone[]>([]);
  const lockedMorphTargetsRef = useRef<LockedMorphTarget[]>([]);
  const lockedHairObjectsRef = useRef<LockedObject[]>([]);
  const currentAnimationRef = useRef<AnimationName>(animation);
  const wasLocomotionRef = useRef(false);
  const [clipsLoaded, setClipsLoaded] = useState(false);
  const firstPlayDoneRef = useRef(false);

  const restoreLockedTransforms = useCallback(() => {
    lockedBonesRef.current.forEach(lock => {
      lock.bone.position.copy(lock.position);
      lock.bone.quaternion.copy(lock.quaternion);
      lock.bone.scale.copy(lock.scale);
    });

    lockedMorphTargetsRef.current.forEach(lock => {
      if (!lock.mesh.morphTargetInfluences) return;
      lock.baseInfluences.forEach((value, idx) => {
        lock.mesh.morphTargetInfluences![idx] = value;
      });
    });

    lockedHairObjectsRef.current.forEach(lock => {
      lock.object.position.copy(lock.position);
      lock.object.quaternion.copy(lock.quaternion);
      lock.object.scale.copy(lock.scale);
    });
  }, []);

  // Improve texture quality: trilinear filtering, mipmaps, anisotropy, color space
  useEffect(() => {
    if (!scene) return;
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();

    const enhanceTexture = (tex: THREE.Texture | null, srgb: boolean) => {
      if (!tex) return;
      tex.anisotropy = maxAnisotropy;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = true;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      tex.needsUpdate = true;
    };

    scene.traverse((child: any) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat: any) => {
          enhanceTexture(mat.map, true);
          enhanceTexture(mat.emissiveMap, true);
          enhanceTexture(mat.normalMap, false);
          enhanceTexture(mat.roughnessMap, false);
          enhanceTexture(mat.metalnessMap, false);
          enhanceTexture(mat.aoMap, false);
          // Raise roughness floor to reduce specular highlights that wash out colors
          if (typeof mat.roughness === 'number' && mat.roughness < 0.3) {
            mat.roughness = 0.3;
          }
          // Cap metalness to prevent reflections from distorting base texture colors
          if (typeof mat.metalness === 'number' && mat.metalness > 0.1) {
            mat.metalness = 0.1;
          }
          mat.needsUpdate = true;
        });
      }
    });
  }, [scene, gl]);

  useEffect(() => {
    if (!scene) return;
    
    console.log('[AvatarModel] Setting up scene and animations...');
    scene.scale.set(1, 1, 1);
    scene.position.set(0, 0, 0);

    const isHeadRegion = createHeadRegionDetector(scene);

    // Hide model until animations are ready to avoid T-pose
    scene.visible = false;
    firstPlayDoneRef.current = false;
    setClipsLoaded(false);

    const lockedBoneNames = new Set<string>();
    lockedBonesRef.current = [];
    lockedMorphTargetsRef.current = [];
    lockedHairObjectsRef.current = [];
    scene.traverse((child: any) => {
      const inHeadRegion = isHeadRegion(child);

      // Lock every bone that is NOT a locomotion bone (i.e. not hips/legs)
      if (child.isBone && !isLocomotionBone(child.name)) {
        lockedBonesRef.current.push({
          bone: child,
          position: child.position.clone(),
          quaternion: child.quaternion.clone(),
          scale: child.scale.clone(),
        });
        if (child.name) lockedBoneNames.add(child.name);
      }

      // Lock ALL morph targets to prevent any face/body blend shape changes
      if (
        child.isMesh &&
        child.morphTargetInfluences &&
        child.morphTargetInfluences.length > 0
      ) {
        lockedMorphTargetsRef.current.push({
          mesh: child,
          baseInfluences: child.morphTargetInfluences.slice(),
        });
      }

      // Lock hair and head-region objects
      if (
        !child.isBone &&
        (
          isHairName(child.name) ||
          isHairName(child.parent?.name) ||
          inHeadRegion
        )
      ) {
        lockedHairObjectsRef.current.push({
          object: child,
          position: child.position.clone(),
          quaternion: child.quaternion.clone(),
          scale: child.scale.clone(),
        });
      }
    });
    
    // Initialize mixer
    mixerRef.current = new THREE.AnimationMixer(scene);
    actionsRef.current = {};

    const loadAnimations = async () => {
      const loader = new GLTFLoader();
      configureGLTFLoader(loader, gl);
      const availability: Record<AnimationName, boolean> = { idle: false, walking: false, running: false };

      const registerClip = (clip: THREE.AnimationClip, forcedName?: AnimationName) => {
        const resolvedName = forcedName ?? normalizeAnimationName(clip.name || '');
        if (!resolvedName || !mixerRef.current) return;
        const prepared = clip.clone();
        retargetClipToSkeleton(prepared, scene);
        sanitizeClipTracks(prepared, resolvedName, lockedBoneNames);
        prepared.name = resolvedName;
        const action = mixerRef.current.clipAction(prepared);
        actionsRef.current[resolvedName] = action;
        availability[resolvedName] = true;
      };

      const loadClip = async (url: string, name: AnimationName) => {
        try {
          console.log(`[AvatarModel] Loading animation ${name} from:`, url);
          const animGltf = await loader.loadAsync(url);
          if (animGltf.animations && animGltf.animations.length > 0) {
            const clip = animGltf.animations[0];
            const totalBefore = clip.tracks.length;
            registerClip(clip, name);
            console.log(`[AvatarModel] Loaded ${name}: ${totalBefore} → ${clip.tracks.length} tracks (upper body filtered for locomotion)`);  
          } else {
            console.warn(`[AvatarModel] No animations found in ${name}`);
          }
        } catch (err) {
          console.error(`[AvatarModel] Failed to load animation ${name}:`, err);
        }
      };

      // Primero: intentar usar animaciones embebidas en el GLB principal
      if (gltf.animations && gltf.animations.length > 0) {
        let anyRegistered = false;
        gltf.animations.forEach(originalClip => {
          const normalized = normalizeAnimationName(originalClip.name || '');
          if (!normalized) return;
          registerClip(originalClip, normalized);
          anyRegistered = true;
        });
        // Fallback: if no clip name matched a known pattern, register the first clip as idle
        if (!anyRegistered && gltf.animations.length > 0) {
          console.warn('[AvatarModel] No embedded clip matched known names, registering first clip as idle. Names:', gltf.animations.map(c => c.name));
          registerClip(gltf.animations[0], 'idle');
        }
      }

      const promises: Promise<void>[] = [];
      if (idleUrl) promises.push(loadClip(idleUrl, 'idle'));
      if (walkingUrl) promises.push(loadClip(walkingUrl, 'walking'));
      if (runningUrl) promises.push(loadClip(runningUrl, 'running'));

      await Promise.all(promises);
      onAnimationsReady?.({ ...availability });
      console.log('[AvatarModel] All animations loaded, available:', availability);

      // Auto-play idle animation immediately after loading to avoid T-pose
      const idleAction = actionsRef.current['idle'];
      const targetAction = idleAction || (Object.values(actionsRef.current)[0] as THREE.AnimationAction | undefined);
      if (targetAction) {
        // ⚠️ DO NOT REMOVE: keeping idle as the first action prevents T-pose flashes at load time.
        // Requirements from product team: the avatar must always default to idle and this MUST NOT change.
        console.log('[AvatarModel] Auto-playing animation to avoid T-pose:', targetAction.getClip().name);
        targetAction.reset().play();
        // Force a real tick (1/60s) so the mixer actually samples and applies the first frame
        if (mixerRef.current) {
          mixerRef.current.update(1 / 60);
          mixerRef.current.update(0);
        }
        firstPlayDoneRef.current = true;
      } else {
        console.warn('[AvatarModel] No animation clips available — model will show in bind pose (T-pose)');
      }

      // Signal that clips are loaded AFTER registration so the useEffect picks it up
      setClipsLoaded(true);

      // Now make the model visible — pose is no longer T
      scene.visible = true;
    };

    loadAnimations();

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current.uncacheRoot(scene);
      }
    };
  }, [scene, idleUrl, walkingUrl, runningUrl]);

  useEffect(() => {
    currentAnimationRef.current = animation;
    if (!clipsLoaded) return;

    const desired = actionsRef.current[animation] || actionsRef.current['idle'] || Object.values(actionsRef.current)[0];
    if (!desired) {
      console.warn(`[AvatarModel] Animation ${animation} not found`);
      return;
    }

    // If the desired action is already playing (auto-played in loadAnimations), skip
    if (desired.isRunning()) {
      console.log(`[AvatarModel] Animation ${animation} already playing, skipping`);
      return;
    }

    // Stop all animations
    (Object.values(actionsRef.current) as THREE.AnimationAction[]).forEach(action => action.stop());

    // Play the requested animation
    console.log(`[AvatarModel] Playing animation: ${animation}`);
    if (!firstPlayDoneRef.current) {
      // First play: no fade, instant full weight to avoid T-pose flash
      desired.reset().play();
      firstPlayDoneRef.current = true;
    } else {
      desired.reset().fadeIn(0.5).play();
    }
  }, [animation, clipsLoaded]);

  useFrame((_state, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    const isLocomotion = isLocomotionAnimation(currentAnimationRef.current);
    if (isLocomotion) {
      restoreLockedTransforms();
    } else if (wasLocomotionRef.current) {
      // Ensure we restore base pose once after leaving locomotion
      restoreLockedTransforms();
    }

    wasLocomotionRef.current = isLocomotion;
  });

  console.log('[AvatarModel] Rendering avatar scene');
  if (!scene) return null;
  // @ts-ignore: React-three-fiber primitive typing provided at runtime
  return <primitive object={scene} />;
}
