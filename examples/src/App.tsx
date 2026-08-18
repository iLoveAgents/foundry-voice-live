import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { HomePage } from './pages/HomePage';
import { VoiceOnlyBasic } from './pages/VoiceOnlyBasic';
import { VoiceAdvanced } from './pages/VoiceAdvanced';
import { VoiceWebRTC } from './pages/VoiceWebRTC';
import { VoiceProxy } from './pages/VoiceProxy';
import { VoiceProxyMSAL } from './pages/VoiceProxyMSAL';
import { AvatarBasic } from './pages/AvatarBasic';
import { AvatarAdvanced } from './pages/AvatarAdvanced';
import { AvatarProxy } from './pages/AvatarProxy';
import { AvatarProxyMSAL } from './pages/AvatarProxyMSAL';
import { FunctionCalling } from './pages/FunctionCalling';
import { InterimResponse } from './pages/InterimResponse';
import { McpTools } from './pages/McpTools';
import { AzureRealtime } from './pages/AzureRealtime';
import { AudioVisualizer } from './pages/AudioVisualizer';
import { VisemeExample } from './pages/VisemeExample';
import { Live2DAvatarExample } from './pages/Live2DAvatarExample';
import { Avatar3DExample } from './pages/Avatar3DExample';
// TODO: Add Live2DUnicornExample and Live2DRobotExample when implemented
import FoundryAgent from './pages/FoundryAgent';
import FoundryAgentMSAL from './pages/FoundryAgentMSAL';
import FoundryAgentAvatar from './pages/FoundryAgentAvatar';
import FoundryAgentAvatarMSAL from './pages/FoundryAgentAvatarMSAL';

// MSAL configuration for the Entra ID (MSAL) examples
const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID || '00000000-0000-0000-0000-000000000000',
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID || 'common'}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage', // Use sessionStorage for better security
    storeAuthStateInCookie: false,
  },
};

const msalInstance = new PublicClientApplication(msalConfig);

function App(): JSX.Element {
  const [msalInitialized, setMsalInitialized] = useState(false);

  useEffect(() => {
    // Initialize MSAL before using it
    msalInstance.initialize().then(() => {
      setMsalInitialized(true);
    });
  }, []);

  if (!msalInitialized) {
    return <div style={{ padding: '2rem' }}>Initializing authentication...</div>;
  }

  return (
    <MsalProvider instance={msalInstance}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/voice-basic" element={<VoiceOnlyBasic />} />
          <Route path="/voice-advanced" element={<VoiceAdvanced />} />
          <Route path="/voice-webrtc" element={<VoiceWebRTC />} />
          <Route path="/voice-proxy" element={<VoiceProxy />} />
          <Route path="/voice-proxy-msal" element={<VoiceProxyMSAL />} />
          <Route path="/avatar-basic" element={<AvatarBasic />} />
          <Route path="/avatar-advanced" element={<AvatarAdvanced />} />
          <Route path="/avatar-proxy" element={<AvatarProxy />} />
          <Route path="/avatar-proxy-msal" element={<AvatarProxyMSAL />} />
          <Route path="/foundry-agent" element={<FoundryAgent />} />
          <Route path="/foundry-agent-msal" element={<FoundryAgentMSAL />} />
          <Route path="/foundry-agent-avatar" element={<FoundryAgentAvatar />} />
          <Route path="/foundry-agent-avatar-msal" element={<FoundryAgentAvatarMSAL />} />
          <Route path="/function-calling" element={<FunctionCalling />} />
          <Route path="/interim-response" element={<InterimResponse />} />
          <Route path="/mcp-tools" element={<McpTools />} />
          <Route path="/azure-realtime" element={<AzureRealtime />} />
          <Route path="/audio-visualizer" element={<AudioVisualizer />} />
          <Route path="/viseme" element={<VisemeExample />} />
          <Route path="/live2d-avatar" element={<Live2DAvatarExample />} />
          <Route path="/avatar-3d" element={<Avatar3DExample />} />
        </Routes>
      </BrowserRouter>
    </MsalProvider>
  );
}

export default App;
