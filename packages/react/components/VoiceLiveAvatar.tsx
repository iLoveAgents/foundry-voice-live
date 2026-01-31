/**
 * VoiceLiveAvatar Component
 *
 * Reusable React component for displaying an Microsoft Foundry Voice Live avatar with video and audio.
 * Supports chroma key (green screen removal) and configurable controls.
 *
 * Features:
 * - WebRTC video and audio playback
 * - Optional chroma key processing for transparent backgrounds
 * - Loading states with customizable messages
 * - Mouse-based control visibility
 * - Fully customizable styling
 *
 * @example
 * ```tsx
 * // Basic usage with original background
 * <VoiceLiveAvatar
 *   videoStream={videoStream}
 *   audioStream={audioStream}
 *   transparentBackground={false}
 * />
 *
 * // With transparent background (default)
 * <VoiceLiveAvatar
 *   videoStream={videoStream}
 *   audioStream={audioStream}
 *   transparentBackground
 * />
 *
 * // Custom chroma key settings
 * <VoiceLiveAvatar
 *   videoStream={videoStream}
 *   audioStream={audioStream}
 *   transparentBackground
 *   chromaKeyConfig={{ color: [0, 255, 0], threshold: 0.4 }}
 * />
 * ```
 */

import React, { useRef, useEffect, useState, CSSProperties } from 'react';
import { createChromaKeyProcessor, DEFAULT_GREEN_SCREEN } from '../utils/chromaKey';
import type { VoiceLiveAvatarProps } from '../types';

/**
 * Default styles for the component
 */
const defaultStyles: Record<string, CSSProperties> = {
  container: {
    position: 'relative',
    display: 'contents',
    backgroundColor: 'transparent',
  },
  canvas: {
    width: '100%',
    height: 'auto',
    maxWidth: '100%',
    maxHeight: '100%',
    display: 'block',
    objectFit: 'contain',
  },
  video: {
    width: '100%',
    height: 'auto',
    maxWidth: '100%',
    maxHeight: '100%',
    display: 'block',
    objectFit: 'contain',
  },
  videoHidden: {
    display: 'none',
  },
  audio: {
    display: 'none',
  },
  loadingContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    color: '#fff',
    textAlign: 'center',
  },
  controlsContainer: {
    position: 'absolute',
    bottom: '20px',
    right: '20px',
    display: 'flex',
    gap: '10px',
    transition: 'opacity 0.3s ease-in-out',
  },
};

/**
 * Avatar Display Component
 */
export const VoiceLiveAvatar: React.FC<VoiceLiveAvatarProps> = ({
  videoStream,
  audioStream,
  loading = false,
  loadingMessage = 'Loading...',
  showControls = false,
  controls,
  className,
  canvasClassName,
  style,
  transparentBackground = true,
  chromaKeyConfig = DEFAULT_GREEN_SCREEN,
  onVideoReady,
  onAudioReady,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chromaKeyProcessorRef = useRef<ReturnType<typeof createChromaKeyProcessor>>(null);

  const [showControlsState, setShowControlsState] = useState(false);

  // Show loading state when no video stream
  const isLoading = loading || !videoStream;

  /**
   * Setup video stream and chroma key when stream is available
   */
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (videoStream && video) {
      video.srcObject = videoStream;
      video.autoplay = true;

      const handleLoadedMetadata = () => {
        // Start chroma key processing for transparent background
        if (transparentBackground && canvas) {
          chromaKeyProcessorRef.current = createChromaKeyProcessor(
            video,
            canvas,
            chromaKeyConfig
          );
          chromaKeyProcessorRef.current?.start();
        }

        if (onVideoReady) {
          onVideoReady();
        }
      };

      video.addEventListener('loadedmetadata', handleLoadedMetadata);

      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        chromaKeyProcessorRef.current?.stop();
        chromaKeyProcessorRef.current = null;
      };
    }
  }, [videoStream, transparentBackground, chromaKeyConfig, onVideoReady]);

  /**
   * Setup audio stream when available
   */
  useEffect(() => {
    const audio = audioRef.current;

    if (audioStream && audio) {
      audio.srcObject = audioStream;
      audio.autoplay = true;

      if (onAudioReady) {
        const handleAudioLoaded = () => {
          onAudioReady();
        };
        audio.addEventListener('loadedmetadata', handleAudioLoaded);

        return () => {
          audio.removeEventListener('loadedmetadata', handleAudioLoaded);
        };
      }
    }
  }, [audioStream, onAudioReady]);

  /**
   * Update chroma key config when it changes
   */
  useEffect(() => {
    if (chromaKeyProcessorRef.current && chromaKeyConfig) {
      chromaKeyProcessorRef.current.updateConfig(chromaKeyConfig);
    }
  }, [chromaKeyConfig]);

  /**
   * Handle mouse movement for control visibility
   */
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!showControls) return;

    const containerHeight = e.currentTarget.clientHeight;
    const mouseY = e.clientY - e.currentTarget.getBoundingClientRect().top;
    // Show controls when mouse is in the bottom 25% of the container
    setShowControlsState(mouseY > containerHeight * 0.75);
  };

  const handleMouseLeave = () => {
    setShowControlsState(false);
  };

  return (
    <div
      className={className}
      style={{ ...defaultStyles.container, ...style }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Video element - shown directly when transparent background is disabled, hidden when enabled */}
      <video
        ref={videoRef}
        style={transparentBackground ? defaultStyles.videoHidden : defaultStyles.video}
        autoPlay
        playsInline
      />

      {/* Canvas for transparent background - only shown when transparentBackground is enabled */}
      {transparentBackground && (
        <canvas
          ref={canvasRef}
          className={canvasClassName}
          style={canvasClassName ? undefined : defaultStyles.canvas}
        />
      )}

      {/* Hidden audio element */}
      <audio ref={audioRef} style={defaultStyles.audio} />

      {/* Loading state */}
      {isLoading && (
        <div style={defaultStyles.loadingContainer}>
          <div>{loadingMessage}</div>
        </div>
      )}

      {/* Controls */}
      {showControls && controls && (
        <div
          style={{
            ...defaultStyles.controlsContainer,
            opacity: showControlsState ? 1 : 0,
            pointerEvents: showControlsState ? 'auto' : 'none',
          }}
        >
          {controls}
        </div>
      )}
    </div>
  );
};
