/**
 * Live2D Avatar Example with Azure Viseme Synchronization
 *
 * This example demonstrates real-time lip-sync animation of a Live2D Cubism 4 model
 * using Azure Speech Service viseme data. The Kei model's mouth parameters are
 * mapped to Azure's 22 viseme IDs for natural speech animation.
 *
 * Technical stack:
 * - PixiJS v6.x for WebGL rendering
 * - pixi-live2d-display for Live2D Cubism 4 support
 * - Microsoft Foundry Voice Live for real-time speech and viseme events
 *
 * @see https://docs.microsoft.com/azure/cognitive-services/speech-service/how-to-speech-synthesis-viseme
 * @see https://github.com/guansss/pixi-live2d-display
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useVoiceLive, createVoiceLiveConfig, withViseme } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel } from '../components';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

// ============================================================================
// Configuration Constants
// ============================================================================

/** Canvas dimensions for the Live2D renderer */
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;

/** Path to the Live2D model files (relative to public directory) */
const MODEL_PATH = '/models/kei_vowels_pro/kei_vowels_pro.model3.json';

// ============================================================================
// PIXI.js Global Setup
// ============================================================================

/**
 * Expose PIXI to window object.
 * Required by pixi-live2d-display to access PIXI.Ticker for animation updates.
 * @see https://github.com/guansss/pixi-live2d-display#setup
 */
(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;

// ============================================================================
// Types
// ============================================================================

/** Viseme event data from Azure Speech Service */
interface VisemeData {
  viseme_id: number;
  audio_offset_ms: number;
}

/** Live2D vowel mouth shape parameters (values 0-1) */
interface VowelParams {
  mouthOpen: number; // ParamMouthOpenY - overall mouth opening
  a: number;         // ParamA - "ah" vowel shape
  i: number;         // ParamI - "ee" vowel shape
  u: number;         // ParamU - "oo" vowel shape
  e: number;         // ParamE - "eh" vowel shape
  o: number;         // ParamO - "oh" vowel shape
}

/** Viseme mapping entry with phoneme description */
interface VisemeMapping extends VowelParams {
  phonemes: string;
}

// ============================================================================
// Azure Viseme to Live2D Mapping
// ============================================================================

/**
 * Maps Azure viseme IDs (0-21) to Live2D Kei model mouth parameters.
 *
 * Azure visemes represent mouth shapes for phoneme groups. This mapping
 * translates them to the Kei model's vowel parameters for lip-sync.
 *
 * @see https://docs.microsoft.com/azure/cognitive-services/speech-service/how-to-speech-synthesis-viseme
 */
const VISEME_MAP: Record<number, VisemeMapping> = {
  // Silence - mouth closed
  0:  { phonemes: 'Silence',       mouthOpen: 0.0, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },

  // Open vowels - wide mouth opening
  1:  { phonemes: 'æ, ə, ʌ',       mouthOpen: 0.8, a: 1,   i: 0,   u: 0,   e: 0,   o: 0   },
  2:  { phonemes: 'ɑ',             mouthOpen: 1.0, a: 1,   i: 0,   u: 0,   e: 0,   o: 0   },

  // Back vowels - rounded lips
  3:  { phonemes: 'ɔ',             mouthOpen: 0.7, a: 0,   i: 0,   u: 0,   e: 0,   o: 1   },
  7:  { phonemes: 'w, ʊ',          mouthOpen: 0.6, a: 0,   i: 0,   u: 1,   e: 0,   o: 0   },
  8:  { phonemes: 'oʊ',            mouthOpen: 0.8, a: 0,   i: 0,   u: 0,   e: 0,   o: 1   },

  // Front vowels - spread lips
  4:  { phonemes: 'eɪ, ɛ, ʊ',      mouthOpen: 0.6, a: 0,   i: 0,   u: 0,   e: 1,   o: 0   },
  5:  { phonemes: 'ɝ',             mouthOpen: 0.5, a: 0,   i: 0,   u: 0,   e: 0.8, o: 0   },
  6:  { phonemes: 'j, i, ɪ',       mouthOpen: 0.5, a: 0,   i: 1,   u: 0,   e: 0,   o: 0   },

  // Diphthongs - blended vowel shapes
  9:  { phonemes: 'aʊ',            mouthOpen: 0.7, a: 0.5, i: 0,   u: 0,   e: 0,   o: 0.5 },
  10: { phonemes: 'ɔɪ',            mouthOpen: 0.7, a: 0,   i: 0.5, u: 0,   e: 0,   o: 0.5 },
  11: { phonemes: 'aɪ',            mouthOpen: 0.7, a: 0.5, i: 0.5, u: 0,   e: 0,   o: 0   },

  // Consonants - minimal mouth opening
  12: { phonemes: 'h',             mouthOpen: 0.2, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },
  13: { phonemes: 'ɹ',             mouthOpen: 0.3, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },
  14: { phonemes: 'l',             mouthOpen: 0.3, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },
  15: { phonemes: 's, z',          mouthOpen: 0.2, a: 0,   i: 0.3, u: 0,   e: 0,   o: 0   },
  16: { phonemes: 'ʃ, tʃ, dʒ, ʒ',  mouthOpen: 0.3, a: 0,   i: 0,   u: 0.3, e: 0,   o: 0   },
  17: { phonemes: 'θ, ð',          mouthOpen: 0.2, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },
  18: { phonemes: 'f, v',          mouthOpen: 0.2, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },
  19: { phonemes: 'd, t, n',       mouthOpen: 0.3, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },
  20: { phonemes: 'k, g, ŋ',       mouthOpen: 0.2, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },
  21: { phonemes: 'p, b, m',       mouthOpen: 0.1, a: 0,   i: 0,   u: 0,   e: 0,   o: 0   },
};

/** Default closed mouth state */
const SILENT_VISEME = VISEME_MAP[0];

// ============================================================================
// Component
// ============================================================================

export function Live2DAvatarExample(): JSX.Element {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelNotFound, setModelNotFound] = useState(false);

  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const visemeBufferRef = useRef<VisemeData[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const currentVisemeRef = useRef<number | null>(null); // Avoid stale closure in animation loop
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<InstanceType<typeof Live2DModel> | null>(null);

  // Smooth interpolation state for mouth parameters
  const currentMouthParams = useRef({ mouthOpen: 0, a: 0, i: 0, u: 0, e: 0, o: 0 });
  const targetMouthParams = useRef({ mouthOpen: 0, a: 0, i: 0, u: 0, e: 0, o: 0 });

  // ---------------------------------------------------------------------------
  // Microsoft Foundry Voice Live Configuration
  // ---------------------------------------------------------------------------
  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE,
      apiKey: import.meta.env.VITE_AZURE_SPEECH_KEY,
    },
    session: withViseme({
      instructions: 'You are a helpful assistant. Always respond in English. Keep responses brief.',
      voice: {
        name: 'en-US-AvaNeural',
        type: 'azure-standard',
      },
    }),
  });

  const { connect, disconnect, connectionState, getAudioPlaybackTime, audioStream } = useVoiceLive({
    ...config,
    onEvent: useCallback((event: { type: string; viseme_id?: number; audio_offset_ms?: number }) => {
      // Buffer incoming viseme events for synchronization with audio playback
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

      // Clear buffer when a new response starts
      if (event.type === 'response.created') {
        visemeBufferRef.current = [];
      }
    }, []),
  });

  // ---------------------------------------------------------------------------
  // Live2D Model Initialization
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || appRef.current) return;

    let mounted = true;

    const initLive2D = async (): Promise<void> => {
      try {
        // Create PIXI application with transparent background
        // Let PIXI create its own canvas to avoid WebGL context issues in React
        const app = new PIXI.Application({
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          backgroundAlpha: 0,
          antialias: true,
        });

        // Append canvas to container element
        containerRef.current!.appendChild(app.view as HTMLCanvasElement);

        // Check if component unmounted during async operation
        if (!mounted) {
          app.destroy();
          return;
        }

        appRef.current = app;

        // Load the Live2D model
        const model = await Live2DModel.from(MODEL_PATH, {
          autoInteract: false, // Disable automatic mouse tracking; we control via visemes
        });

        if (!mounted) {
          app.destroy();
          return;
        }

        // Position model anchored at bottom-center (feet at anchor point)
        model.anchor.set(0.5, 1.0);

        // Scale model to fit canvas with padding
        const scaleX = (CANVAS_WIDTH * 0.9) / model.width;
        const scaleY = (CANVAS_HEIGHT * 0.95) / model.height;
        model.scale.set(Math.min(scaleX, scaleY));

        // Position at bottom-center of canvas
        model.position.set(CANVAS_WIDTH / 2, CANVAS_HEIGHT);

        app.stage.addChild(model);
        modelRef.current = model;
        setModelLoaded(true);
        setError(null);
      } catch (err) {
        console.error('Failed to load Live2D model:', err);

        // Check if model files are missing (404 error)
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('404') || errorMessage.includes('Network') || errorMessage.includes('Failed to load')) {
          setModelNotFound(true);
        } else {
          setError(`Failed to load Live2D model: ${errorMessage}`);
        }
      }
    };

    initLive2D();

    // Cleanup: destroy PIXI application and release WebGL resources
    return () => {
      mounted = false;

      if (appRef.current) {
        try {
          const view = appRef.current.view as HTMLCanvasElement;
          view.parentNode?.removeChild(view);
          appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {
          // Ignore errors during cleanup - may occur if canvas already removed
          // (e.g., React StrictMode double-mount or hot reload)
        }
        appRef.current = null;
      }
      modelRef.current = null;
    };
  }, []);

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
  // Viseme Application to Live2D Model
  // ---------------------------------------------------------------------------

  /** Interpolation speed (0-1, higher = faster transitions) */
  const LERP_SPEED = 0.3;

  /** Linear interpolation helper */
  const lerp = (current: number, target: number, t: number): number => {
    return current + (target - current) * t;
  };

  /**
   * Set target viseme parameters for smooth interpolation.
   */
  const setTargetViseme = useCallback((visemeId: number): void => {
    const params = VISEME_MAP[visemeId] ?? SILENT_VISEME;
    targetMouthParams.current = {
      mouthOpen: params.mouthOpen,
      a: params.a,
      i: params.i,
      u: params.u,
      e: params.e,
      o: params.o,
    };
  }, []);

  /**
   * Apply interpolated mouth parameters to the Live2D model.
   * Called every frame for smooth transitions.
   */
  const updateMouthParameters = useCallback((): void => {
    const model = modelRef.current;
    const coreModel = (model as { internalModel?: { coreModel?: {
      setParameterValueById: (id: string, value: number) => void;
    } } })?.internalModel?.coreModel;

    if (!coreModel) return;

    const current = currentMouthParams.current;
    const target = targetMouthParams.current;

    // Smoothly interpolate each parameter
    current.mouthOpen = lerp(current.mouthOpen, target.mouthOpen, LERP_SPEED);
    current.a = lerp(current.a, target.a, LERP_SPEED);
    current.i = lerp(current.i, target.i, LERP_SPEED);
    current.u = lerp(current.u, target.u, LERP_SPEED);
    current.e = lerp(current.e, target.e, LERP_SPEED);
    current.o = lerp(current.o, target.o, LERP_SPEED);

    // Apply interpolated values to model
    coreModel.setParameterValueById('ParamMouthOpenY', current.mouthOpen);
    coreModel.setParameterValueById('ParamA', current.a);
    coreModel.setParameterValueById('ParamI', current.i);
    coreModel.setParameterValueById('ParamU', current.u);
    coreModel.setParameterValueById('ParamE', current.e);
    coreModel.setParameterValueById('ParamO', current.o);
  }, []);

  // ---------------------------------------------------------------------------
  // Viseme-Audio Synchronization Loop
  // ---------------------------------------------------------------------------

  /**
   * Animation loop that synchronizes viseme display with audio playback.
   * Runs via requestAnimationFrame for smooth, frame-accurate lip-sync.
   * Uses interpolation for natural mouth movements.
   */
  useEffect(() => {
    const syncVisemes = (): void => {
      const currentTimeMs = getAudioPlaybackTime();

      if (currentTimeMs !== null && visemeBufferRef.current.length > 0) {
        // Find the most recent viseme that should be active at current playback time
        let activeViseme: VisemeData | null = null;

        for (const viseme of visemeBufferRef.current) {
          if (viseme.audio_offset_ms <= currentTimeMs) {
            activeViseme = viseme;
          } else {
            break; // Buffer is sorted by time, no need to continue
          }
        }

        // Update target viseme when it changes
        if (activeViseme && activeViseme.viseme_id !== currentVisemeRef.current) {
          currentVisemeRef.current = activeViseme.viseme_id;
          setTargetViseme(activeViseme.viseme_id);
        }
      }

      // Always update mouth params for smooth interpolation
      updateMouthParameters();

      animationFrameRef.current = requestAnimationFrame(syncVisemes);
    };

    syncVisemes();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [getAudioPlaybackTime, setTargetViseme, updateMouthParameters]);

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
    // Reset model to closed mouth (will smoothly animate closed)
    setTargetViseme(0);
    currentVisemeRef.current = null;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="Live2D Avatar with Viseme Sync"
      description="Real-time Live2D avatar animation using Azure viseme data. The Kei model's mouth movements are synchronized with speech output."
    >
      <ErrorPanel error={error} />

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button type="button" onClick={handleStart} disabled={isConnected || !modelLoaded}>
          {modelLoaded ? 'Start Conversation' : 'Loading model...'}
        </button>
        <button type="button" onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
      </ControlGroup>

      <Section>
        <div className="canvas-container-live2d">
          {modelNotFound ? (
            <div
              style={{
                padding: '40px',
                textAlign: 'center',
                color: 'white',
                maxWidth: '360px',
              }}
            >
              <h3 style={{ margin: '0 0 16px 0', fontSize: '20px' }}>Live2D Model Not Found</h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '14px', opacity: 0.9, lineHeight: 1.6 }}>
                The Kei model must be downloaded separately due to Live2D licensing.
              </p>
              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: '6px',
                  padding: '16px',
                  textAlign: 'left',
                  fontSize: '13px',
                  lineHeight: 1.8,
                }}
              >
                <strong style={{ display: 'block', marginBottom: '8px' }}>Setup Instructions:</strong>
                <ol style={{ margin: 0, paddingLeft: '20px' }}>
                  <li>
                    Download from{' '}
                    <a
                      href="https://www.live2d.com/en/learn/sample/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#a5d6ff' }}
                    >
                      Live2D Samples
                    </a>
                  </li>
                  <li>Accept the license agreement</li>
                  <li>
                    Extract to{' '}
                    <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '3px' }}>
                      public/models/kei_vowels_pro/
                    </code>
                  </li>
                  <li>Refresh this page</li>
                </ol>
              </div>
              <p style={{ margin: '16px 0 0 0', fontSize: '12px', opacity: 0.7 }}>
                See{' '}
                <a
                  href="https://github.com/iloveagents/foundry-voice-live/tree/main/packages/react#live2d-avatar-setup"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#a5d6ff' }}
                >
                  README
                </a>{' '}
                for details.
              </p>
            </div>
          ) : (
            <div ref={containerRef} style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
          )}
        </div>
      </Section>

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
