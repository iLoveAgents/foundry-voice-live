/**
 * Voice Live API Configuration Utilities
 *
 * Simple configuration builder for Microsoft Foundry Voice Live API.
 *
 * @example
 * ```tsx
 * import { createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
 *
 * const config = createVoiceLiveConfig({
 *   connection: { proxyUrl: 'ws://localhost:8080/ws' },
 *   session: {
 *     avatar: { character: 'lisa', style: 'casual-sitting' },
 *     voice: { name: 'en-US-Ava:DragonHDLatestNeural' }
 *   }
 * });
 * ```
 */

import type { UseVoiceLiveConfig } from '../types/voiceLive';

// ============================================================================
// CONFIGURATION BUILDER
// ============================================================================

/**
 * Create a Voice Live configuration
 *
 * @param config - Configuration object with connection and session settings
 * @returns Complete configuration ready for useVoiceLive
 *
 * @example
 * ```tsx
 * const config = createVoiceLiveConfig({
 *   connection: { proxyUrl: 'ws://localhost:8080/ws' },
 *   session: {
 *     avatar: { character: 'lisa' },
 *     voice: { name: 'en-US-Ava:DragonHDLatestNeural' }
 *   }
 * });
 * ```
 */
export function createVoiceLiveConfig(config: Partial<UseVoiceLiveConfig> & { connection: UseVoiceLiveConfig['connection'] }): UseVoiceLiveConfig {
  return {
    connection: config.connection,
    session: config.session,
    toolExecutor: config.toolExecutor,
    autoConnect: config.autoConnect,
    onEvent: config.onEvent,
  };
}
