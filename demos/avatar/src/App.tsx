/**
 * Azure Live Voice Avatar - Refactored Application
 *
 * Clean, modular application using reusable Microsoft Foundry Voice Live API library.
 * Demonstrates the simplicity achieved through proper abstraction.
 */

import { useState, useMemo, useRef } from "react";
import "./App.css";
import {
  FluentProvider,
  Button,
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Field,
  Textarea,
  Spinner,
} from "@fluentui/react-components";
import { Settings24Regular } from "@fluentui/react-icons";
import { ContentModal } from "./components/ContentModal";
import { iLoveAgentsTheme } from "./theme/iLoveAgentsTheme";
import { useAppStyles } from "./styles/App.styles";
import { azureConfig } from "./config/azureConfig";
import { systemPrompt } from "./config/systemPrompt";
import { toolRegistry, useToolExecution, ModalController } from "./tools";

// Import from the published React library
import { useVoiceLive, VoiceLiveAvatar, createVoiceLiveConfig, withTransparentBackground } from "@iloveagents/foundry-voice-live-react";
import type { VoiceLiveEvent } from "@iloveagents/foundry-voice-live-react";

function App(): JSX.Element {
  const styles = useAppStyles();
  const [isPaused, setIsPaused] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [systemMessage, setSystemMessage] = useState(systemPrompt);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState("");
  const [modalContentType, setModalContentType] = useState<"text" | "markdown" | "mermaid">("text");
  const [modalSize, setModalSize] = useState<"small" | "medium" | "large" | "full">("large");

  // Modal controller for tool handlers
  const modalController: ModalController = useMemo(
    () => ({
      showModal: (title, content, contentType, size) => {
        setModalTitle(title);
        setModalContent(content);
        setModalContentType(contentType);
        setModalSize(size || "large");
        setModalOpen(true);
      },
      closeModal: () => {
        setModalOpen(false);
      },
    }),
    []
  );

  // Temporary ref for sendEvent to avoid circular dependency
  const sendEventRef = useRef<(event: VoiceLiveEvent) => void>(() => {});

  // Tool execution hook
  const { executeTool } = useToolExecution(
    (event) => sendEventRef.current(event),
    modalController
  );

  // Voice Live API configuration with proxy and transparent background
  const config = createVoiceLiveConfig({
    connection: {
      // Use proxy server instead of direct connection
      proxyUrl: azureConfig.proxyUrl || 'ws://localhost:8080/ws?model=gpt-realtime',
    },
    session: withTransparentBackground({
      instructions: systemMessage,
      voice: {
        name: "en-US-Ava:DragonHDLatestNeural",
        type: "azure-standard",
        temperature: 0.9,
        rate: '0.95',
      },
      avatar: {
        character: azureConfig.avatarCharacter,
        style: azureConfig.avatarStyle,
        video: {
          codec: 'h264',
          resolution: { width: 1920, height: 1080 },
          bitrate: 2000000,
        },
      },
      turnDetection: {
        type: 'azure_semantic_vad',
        threshold: 0.5,
        prefixPaddingMs: 300,
        speechDurationMs: 80,
        silenceDurationMs: 500,
        createResponse: true,
        interruptResponse: true,
        removeFillerWords: false,
      },
      inputAudioNoiseReduction: {
        type: 'azure_deep_noise_suppression',
      },
      inputAudioEchoCancellation: {
        type: 'server_echo_cancellation',
      },
      tools: toolRegistry,
    }),
    toolExecutor: executeTool,
  });

  // Voice Live API hook - mic capture is integrated and auto-starts!
  const {
    connectionState,
    videoStream,
    audioStream,
    isReady,
    error: voiceLiveError,
    connect,
    disconnect,
    sendEvent,
    updateSession,
  } = useVoiceLive(config);

  // Update sendEvent ref
  sendEventRef.current = sendEvent;

  // Integrated start function - just connect, mic auto-starts!
  const startApp = async (): Promise<void> => {
    try {
      await connect();
    } catch (err) {
      console.error("Failed to start app:", err);
    }
  };

  // Integrated stop function
  const stopApp = (): void => {
    disconnect();
  };

  // Pause/resume functions (mic control)
  // Note: We'll keep pause functionality but using the event-based approach
  const pauseApp = (): void => {
    // Clear/commit any pending audio in the buffer
    sendEvent({
      type: "input_audio_buffer.commit",
    });
    // Cancel any ongoing response
    sendEvent({
      type: "response.cancel",
    });
    setIsPaused(true);
  };

  const resumeApp = (): void => {
    setIsPaused(false);
  };

  // Reset function
  const resetApp = (): void => {
    stopApp();
    window.location.reload();
  };

  // Update system message
  const updateSystemMessage = (): void => {
    updateSession({
      instructions: systemMessage,
    });
    setIsSettingsOpen(false);
  };

  // Loading should continue until videoStream is available
  const isLoading = connectionState === 'connecting' || (connectionState === 'connected' && !videoStream);
  const hasError = voiceLiveError;

  return (
    <FluentProvider theme={iLoveAgentsTheme}>
      <div className={styles.root}>
        <div className={styles.header}>
          <img
            src="/logos/logo-white-one-line.svg"
            alt="iLoveAgents logo"
            className={styles.logo}
          />
          <div className={styles.toolbar}>
            <Settings24Regular
              className={styles.settingsIcon}
              onClick={() => setIsSettingsOpen(true)}
            />
          </div>
        </div>

        <div className={styles.avatarContainer}>
          <VoiceLiveAvatar
            videoStream={videoStream}
            audioStream={audioStream}
            canvasClassName={styles.avatarCanvas}
            transparentBackground
            showControls={isReady}
            controls={
              <>
                {!isPaused ? (
                  <Button appearance="secondary" onClick={pauseApp}>
                    Pause
                  </Button>
                ) : (
                  <Button appearance="primary" onClick={resumeApp}>
                    Resume
                  </Button>
                )}
                <Button appearance="secondary" onClick={resetApp}>
                  Reset
                </Button>
              </>
            }
          />

          {/* Start button overlay when not ready */}
          {!isReady && !isLoading && (
            <div className={styles.loadingContainer}>
              {hasError ? (
                <div className={styles.errorMessage}>
                  Error: {voiceLiveError}
                </div>
              ) : (
                <Button
                  appearance="primary"
                  size="large"
                  className={styles.startButton}
                  onClick={startApp}
                >
                  Start
                </Button>
              )}
            </div>
          )}

          {/* Loading spinner overlay */}
          {isLoading && (
            <div className={styles.loadingContainer}>
              <Spinner size="large" appearance="inverted" />
            </div>
          )}
        </div>

        <Drawer
          open={isSettingsOpen}
          onOpenChange={(_, { open }) => setIsSettingsOpen(open)}
          position="end"
          size="medium"
        >
          <DrawerHeader>
            <DrawerHeaderTitle>System Settings</DrawerHeaderTitle>
          </DrawerHeader>
          <DrawerBody>
            <Field label="System Prompt">
              <Textarea
                className={styles.systemPromptTextarea}
                resize="vertical"
                value={systemMessage}
                onChange={(e) => setSystemMessage(e.target.value)}
              />
            </Field>
            <Button
              appearance="primary"
              onClick={updateSystemMessage}
              style={{ marginTop: "16px" }}
            >
              Save Changes
            </Button>
          </DrawerBody>
        </Drawer>

        <ContentModal
          open={modalOpen}
          title={modalTitle}
          content={modalContent}
          contentType={modalContentType}
          size={modalSize}
          onClose={() => setModalOpen(false)}
        />
      </div>
    </FluentProvider>
  );
}

export default App;
