import { Link } from 'react-router-dom';

interface SampleInfo {
  path: string;
  title: string;
  description: string;
}

const samples: Record<string, SampleInfo[]> = {
  'Voice Examples': [
    {
      path: '/voice-basic',
      title: 'Basic Voice Chat',
      description: 'Minimal setup with auto-start microphone',
    },
    {
      path: '/voice-advanced',
      title: 'Advanced Voice Chat',
      description:
        'Semantic VAD, echo cancellation, noise suppression, and barge-in',
    },
    {
      path: '/voice-proxy',
      title: 'Voice with Proxy',
      description: 'Secure backend proxy pattern with API key protection',
    },
    {
      path: '/voice-proxy-msal',
      title: 'Voice with MSAL',
      description: 'Microsoft Entra ID authentication flow',
    },
  ],
  'Avatar Examples': [
    {
      path: '/avatar-basic',
      title: 'Basic Avatar',
      description: 'Video stream rendering with lisa character',
    },
    {
      path: '/avatar-advanced',
      title: 'Advanced Avatar',
      description: '1080p video with transparent background (chroma key)',
    },
    {
      path: '/avatar-proxy',
      title: 'Avatar with Proxy',
      description: 'Secure backend proxy with avatar video',
    },
    {
      path: '/avatar-proxy-msal',
      title: 'Avatar with MSAL',
      description: 'Entra ID authentication with avatar',
    },
  ],
  'Agent Service': [
    {
      path: '/agent-service',
      title: 'Agent Service (Voice)',
      description: 'Azure AI Foundry Agent with MSAL and Whisper transcription',
    },
    {
      path: '/agent-service-avatar',
      title: 'Agent Service (Avatar)',
      description: 'Full agent integration with avatar video',
    },
  ],
  'Advanced Features': [
    {
      path: '/function-calling',
      title: 'Function Calling',
      description: 'Tool definitions with get_weather and get_time examples',
    },
    {
      path: '/audio-visualizer',
      title: 'Audio Visualizer',
      description: 'Real-time waveform visualization with Web Audio API',
    },
    {
      path: '/viseme',
      title: 'Viseme Data',
      description: 'Mouth shape data for custom avatar lip-sync',
    },
    {
      path: '/live2d-avatar',
      title: 'Live2D Avatar',
      description: 'Live2D Cubism model with viseme-driven lip-sync',
    },
    {
      path: '/avatar-3d',
      title: '3D Avatar',
      description: 'React Three Fiber avatar with ReadyPlayerMe model',
    },
  ],
};

function SampleCard({ sample }: { sample: SampleInfo }): JSX.Element {
  return (
    <Link to={sample.path} className="sample-card">
      <h3 className="sample-card__title">{sample.title}</h3>
      <p className="sample-card__description">{sample.description}</p>
    </Link>
  );
}

export function HomePage(): JSX.Element {
  return (
    <div className="sample-layout">
      <header className="home-header">
        <h1 className="home-title">Foundry Voice Live React</h1>
        <p className="home-subtitle">
          React SDK for Microsoft Azure AI Voice Live API
        </p>
      </header>

      {Object.entries(samples).map(([category, categoryItems]) => (
        <section key={category} className="category-section">
          <h2 className="category-title">{category}</h2>
          <div>
            {categoryItems.map((sample) => (
              <SampleCard key={sample.path} sample={sample} />
            ))}
          </div>
        </section>
      ))}

      <footer className="home-footer">
        <p className="home-footer__text">
          Built with{' '}
          <a
            href="https://iloveagents.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="home-footer__link"
          >
            iLoveAgents.ai
          </a>
        </p>
      </footer>
    </div>
  );
}
