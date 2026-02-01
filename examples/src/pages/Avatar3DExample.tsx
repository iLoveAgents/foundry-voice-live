/**
 * 3D Avatar Example (Test)
 *
 * Test file for 3D GLB avatar with Azure viseme sync.
 * Uses React Three Fiber for rendering and morph targets for lip-sync.
 * Works with any GLB that has Oculus Viseme morph targets.
 */

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useVoiceLive, createVoiceLiveConfig, withViseme } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel } from '../components';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';

// ============================================================================
// Configuration
// ============================================================================

/** Local GLB avatar with Oculus Viseme morph targets */
const AVATAR_URL = '/models/rpm/avatar-with-visemes.glb';

// ============================================================================
// Types
// ============================================================================

interface VisemeData {
  viseme_id: number;
  audio_offset_ms: number;
}

interface AvatarProps {
  visemeRef: React.RefObject<{ current: number; target: number }>;
}

// ============================================================================
// Azure Viseme to Oculus Viseme Morph Target Mapping
// ============================================================================

/**
 * Maps Azure viseme IDs (0-21) to Oculus Viseme morph target names.
 */
const VISEME_MORPH_TARGETS: Record<number, string> = {
  0:  'viseme_sil',  // Silence
  1:  'viseme_aa',   // æ, ə, ʌ
  2:  'viseme_aa',   // ɑ (widest)
  3:  'viseme_O',    // ɔ
  4:  'viseme_E',    // eɪ, ɛ
  5:  'viseme_E',    // ɝ
  6:  'viseme_I',    // j, i, ɪ
  7:  'viseme_U',    // w, ʊ
  8:  'viseme_O',    // oʊ
  9:  'viseme_aa',   // aʊ
  10: 'viseme_O',    // ɔɪ
  11: 'viseme_aa',   // aɪ
  12: 'viseme_CH',   // h
  13: 'viseme_RR',   // ɹ
  14: 'viseme_nn',   // l
  15: 'viseme_SS',   // s, z
  16: 'viseme_CH',   // ʃ, tʃ, dʒ, ʒ
  17: 'viseme_TH',   // θ, ð
  18: 'viseme_FF',   // f, v
  19: 'viseme_DD',   // d, t, n
  20: 'viseme_kk',   // k, g, ŋ
  21: 'viseme_PP',   // p, b, m
};

// ============================================================================
// Avatar Component (Three.js)
// ============================================================================

interface VisemeMesh {
  mesh: THREE.SkinnedMesh;
  indexMap: Map<string, number>;
}

function Avatar({ visemeRef }: AvatarProps) {
  const { scene } = useGLTF(AVATAR_URL);
  const visemeMeshesRef = useRef<VisemeMesh[]>([]);
  const currentInfluences = useRef<Record<string, number>>({});

  // Find ALL meshes with viseme morph targets
  useEffect(() => {
    const meshes: VisemeMesh[] = [];

    scene.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && child.morphTargetDictionary) {
        const dict = child.morphTargetDictionary;
        const morphNames = Object.keys(dict);

        // Log ALL morph targets found for debugging
        if (morphNames.length > 0) {
          console.log('Mesh:', child.name, 'has morph targets:', morphNames);
        }

        const hasVisemes = morphNames.some(key => key.startsWith('viseme_'));

        if (hasVisemes) {
          const indexMap = new Map<string, number>();
          Object.entries(dict).forEach(([name, index]) => {
            indexMap.set(name, index);
          });

          meshes.push({ mesh: child, indexMap });
          console.log('Found viseme mesh:', child.name);
        }
      }
    });

    visemeMeshesRef.current = meshes;

    // Initialize current influences
    Object.values(VISEME_MORPH_TARGETS).forEach((name) => {
      currentInfluences.current[name] = 0;
    });

    console.log('Total viseme meshes found:', meshes.length);
  }, [scene]);

  // Animation loop - apply to ALL viseme meshes
  const lastLoggedViseme = useRef<number>(-1);

  useFrame(() => {
    if (!visemeRef.current || visemeMeshesRef.current.length === 0) return;

    const targetVisemeId = visemeRef.current.target;
    const targetMorphName = VISEME_MORPH_TARGETS[targetVisemeId] ?? 'viseme_sil';

    // Debug: log viseme changes
    if (targetVisemeId !== lastLoggedViseme.current) {
      console.log('Applying viseme:', targetVisemeId, '->', targetMorphName);
      lastLoggedViseme.current = targetVisemeId;
    }

    // Calculate interpolated values
    const lerpSpeed = 0.25;
    Object.values(VISEME_MORPH_TARGETS).forEach((morphName) => {
      const targetValue = morphName === targetMorphName ? 1 : 0;
      const current = currentInfluences.current[morphName] ?? 0;
      currentInfluences.current[morphName] = current + (targetValue - current) * lerpSpeed;
    });

    // Apply to all meshes
    for (const { mesh, indexMap } of visemeMeshesRef.current) {
      const influences = mesh.morphTargetInfluences;
      if (!influences) continue;

      Object.values(VISEME_MORPH_TARGETS).forEach((morphName) => {
        const index = indexMap.get(morphName);
        if (index !== undefined) {
          influences[index] = currentInfluences.current[morphName];
        }
      });
    }
  });

  return (
    <primitive
      object={scene}
      position={[0, -0.9, 0]}
      scale={1}
    />
  );
}

// ============================================================================
// Loading Fallback
// ============================================================================

function LoadingFallback() {
  return (
    <mesh>
      <sphereGeometry args={[0.5, 32, 32]} />
      <meshStandardMaterial color="#667eea" wireframe />
    </mesh>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function Avatar3DExample(): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const visemeBufferRef = useRef<VisemeData[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const currentVisemeRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Shared ref for viseme state (accessed by Three.js component)
  const visemeStateRef = useRef({ current: 0, target: 0 });

  // ---------------------------------------------------------------------------
  // Microsoft Foundry Voice Live Configuration
  // ---------------------------------------------------------------------------
  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE,
      apiKey: import.meta.env.VITE_AZURE_SPEECH_KEY,
    },
    session: withViseme({
      instructions: 'You are a friendly 3D avatar assistant. Respond naturally and briefly!',
      voice: {
        name: 'en-US-GuyNeural',
        type: 'azure-standard',
      },
    }),
  });

  const { connect, disconnect, connectionState, getAudioPlaybackTime, audioStream } = useVoiceLive({
    ...config,
    onEvent: useCallback((event: { type: string; viseme_id?: number; audio_offset_ms?: number }) => {
      if (
        event.type === 'response.animation_viseme.delta' &&
        event.viseme_id !== undefined &&
        event.audio_offset_ms !== undefined
      ) {
        visemeBufferRef.current.push({
          viseme_id: event.viseme_id,
          audio_offset_ms: event.audio_offset_ms,
        });
      }

      if (event.type === 'response.created') {
        visemeBufferRef.current = [];
      }
    }, []),
  });

  // ---------------------------------------------------------------------------
  // Audio Stream Connection
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  // ---------------------------------------------------------------------------
  // Viseme-Audio Synchronization Loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const syncVisemes = (): void => {
      const currentTimeMs = getAudioPlaybackTime();

      if (currentTimeMs !== null && visemeBufferRef.current.length > 0) {
        let activeViseme: VisemeData | null = null;

        for (const viseme of visemeBufferRef.current) {
          if (viseme.audio_offset_ms <= currentTimeMs) {
            activeViseme = viseme;
          } else {
            break;
          }
        }

        if (activeViseme && activeViseme.viseme_id !== currentVisemeRef.current) {
          currentVisemeRef.current = activeViseme.viseme_id;
          visemeStateRef.current.target = activeViseme.viseme_id;
        }
      }

      animationFrameRef.current = requestAnimationFrame(syncVisemes);
    };

    syncVisemes();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [getAudioPlaybackTime]);

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  const handleStart = async (): Promise<void> => {
    try {
      setError(null);
      await connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      setError(message);
      console.error('Connection error:', err);
    }
  };

  const handleStop = (): void => {
    disconnect();
    setError(null);
    visemeStateRef.current.target = 0;
    currentVisemeRef.current = null;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="3D Avatar with Viseme Sync (Test)"
      description="Testing 3D GLB avatar with Azure viseme sync using React Three Fiber and Oculus Viseme morph targets."
    >
      <ErrorPanel error={error} />

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button type="button" onClick={handleStart} disabled={isConnected}>
          Start Conversation
        </button>
        <button type="button" onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
      </ControlGroup>

      <Section>
        <div className="canvas-container-3d">
          <Canvas camera={{ position: [0, 0.85, 0.6], fov: 30 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 5, 5]} intensity={1} />
            <Suspense fallback={<LoadingFallback />}>
              <Avatar visemeRef={visemeStateRef} />
              <Environment preset="city" />
            </Suspense>
            <OrbitControls
              enableZoom={true}
              enablePan={false}
              minDistance={0.3}
              maxDistance={2}
              target={[0, 0.8, 0]}
            />
          </Canvas>
        </div>
      </Section>

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}

// Preload the avatar model
useGLTF.preload(AVATAR_URL);
