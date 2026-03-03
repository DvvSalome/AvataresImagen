import React, { useEffect, useState, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';

type AnimationName = 'idle' | 'walking' | 'running';

interface AvatarModelProps {
  modelUrl: string;
  idleUrl?: string | null;
  walkingUrl?: string | null;
  runningUrl?: string | null;
  animation?: AnimationName;
  onAnimationsReady?: (availability: Record<AnimationName, boolean>) => void;
}

// Upper body bone patterns — tracks on these bones are removed from walk/run
// to prevent hair and head deformation on chibi models
const UPPER_BODY_PATTERNS = [
  'neck', 'head', 'jaw', 'eye', 'hair', 'skull', 'face',
  // Mixamo naming
  'mixamorighead', 'mixamorigneck',
];

// Root / hip bone patterns — only these bones may keep .position tracks
// during locomotion to avoid stretching chibi proportions
const ROOT_BONE_PATTERNS = [
  'hips', 'root', 'pelvis', 'armature',
  // Mixamo naming
  'mixamorighips',
];

function isUpperBodyTrack(trackName: string): boolean {
  // Track names look like "BoneName.position" or "BoneName.quaternion"
  const boneName = trackName.split('.').slice(0, -1).join('.').toLowerCase();
  return UPPER_BODY_PATTERNS.some(p => boneName.includes(p));
}

function isRootBone(trackName: string): boolean {
  const boneName = trackName.split('.').slice(0, -1).join('.').toLowerCase();
  return ROOT_BONE_PATTERNS.some(p => boneName.includes(p));
}

function isMorphTargetTrack(trackName: string): boolean {
  return trackName.toLowerCase().includes('morphtarget');
}

function normalizeAnimationName(name: string): AnimationName | null {
  const lower = name.toLowerCase();
  if (lower.includes('walk')) return 'walking';
  if (lower.includes('run') || lower.includes('jog')) return 'running';
  if (lower.includes('idle') || lower.includes('pose') || lower.includes('breath')) return 'idle';
  return null;
}

function sanitizeClipTracks(clip: THREE.AnimationClip, name: AnimationName) {
  const isLocomotion = name === 'walking' || name === 'running';
  clip.tracks = clip.tracks.filter(track => {
    if (track.name.endsWith('.scale')) return false;
    if (isLocomotion && isMorphTargetTrack(track.name)) return false;
    if (isLocomotion && isUpperBodyTrack(track.name)) return false;
    // For locomotion: remove .position tracks on non-root bones to prevent
    // chibi deformation (stretching / fattening). Only root/hips may translate.
    if (isLocomotion && track.name.endsWith('.position') && !isRootBone(track.name)) return false;
    return true;
  });
}

export function AvatarModel({ modelUrl, idleUrl, walkingUrl, runningUrl, animation = 'idle', onAnimationsReady }: AvatarModelProps) {
  console.log('[AvatarModel] Loading avatar model from:', modelUrl);
  console.log('[AvatarModel] Animation URLs:', { idleUrl, walkingUrl, runningUrl });
  
  const gltf = useGLTF(modelUrl);
  const { scene } = gltf;
  const { gl } = useThree();
  
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const [clipsLoaded, setClipsLoaded] = useState(false);

  // Improve texture quality: max anisotropic filtering on all textures
  useEffect(() => {
    if (!scene) return;
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
    scene.traverse((child: any) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat: any) => {
          if (mat.map) { mat.map.anisotropy = maxAnisotropy; mat.map.needsUpdate = true; }
          if (mat.normalMap) { mat.normalMap.anisotropy = maxAnisotropy; mat.normalMap.needsUpdate = true; }
          if (mat.roughnessMap) { mat.roughnessMap.anisotropy = maxAnisotropy; mat.roughnessMap.needsUpdate = true; }
          if (mat.metalnessMap) { mat.metalnessMap.anisotropy = maxAnisotropy; mat.metalnessMap.needsUpdate = true; }
          if (mat.emissiveMap) { mat.emissiveMap.anisotropy = maxAnisotropy; mat.emissiveMap.needsUpdate = true; }
        });
      }
    });
  }, [scene, gl]);

  useEffect(() => {
    if (!scene) return;
    
    console.log('[AvatarModel] Setting up scene and animations...');
    scene.scale.set(1, 1, 1);
    scene.position.set(0, 0, 0);
    
    // Initialize mixer
    mixerRef.current = new THREE.AnimationMixer(scene);
    actionsRef.current = {};

    const loadAnimations = async () => {
      const loader = new GLTFLoader();
      const availability: Record<AnimationName, boolean> = { idle: false, walking: false, running: false };
      const registerClip = (clip: THREE.AnimationClip, forcedName?: AnimationName) => {
        const resolvedName = forcedName ?? normalizeAnimationName(clip.name || '');
        if (!resolvedName || !mixerRef.current) return;
        const prepared = clip.clone();
        sanitizeClipTracks(prepared, resolvedName);
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
        gltf.animations.forEach(originalClip => {
          const normalized = normalizeAnimationName(originalClip.name || '');
          if (!normalized) return;
          registerClip(originalClip, normalized);
        });
      }

      const promises: Promise<void>[] = [];
      if (idleUrl) promises.push(loadClip(idleUrl, 'idle'));
      if (walkingUrl) promises.push(loadClip(walkingUrl, 'walking'));
      if (runningUrl) promises.push(loadClip(runningUrl, 'running'));

      await Promise.all(promises);
      onAnimationsReady?.({ ...availability });
      setClipsLoaded(true);
      console.log('[AvatarModel] All animations loaded');
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
    if (!clipsLoaded) return;

    // Stop all animations
    (Object.values(actionsRef.current) as THREE.AnimationAction[]).forEach(action => action.stop());

    // Play the requested animation
    const action = actionsRef.current[animation] || actionsRef.current['idle'] || Object.values(actionsRef.current)[0];
    if (action) {
      console.log(`[AvatarModel] Playing animation: ${animation}`);
      action.reset().fadeIn(0.5).play();
    } else {
      console.warn(`[AvatarModel] Animation ${animation} not found`);
    }
  }, [animation, clipsLoaded]);

  useFrame((_state, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  console.log('[AvatarModel] Rendering avatar scene');
  if (!scene) return null;
  // @ts-ignore: React-three-fiber primitive typing provided at runtime
  return <primitive object={scene} />;
}
