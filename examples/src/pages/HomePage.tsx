import { Link } from 'react-router-dom';

interface SampleInfo {
  path: string;
  title: string;
  description: string;
  features: string[];
}

const samples: Record<string, SampleInfo[]> = {
  'Voice Examples': [
    {
      path: '/voice-basic',
      title: 'Basic Voice Chat',
      description: 'Simple voice conversation with auto-start microphone and minimal configuration',
      features: ['Auto-start', 'Basic setup']
    },
    {
      path: '/voice-advanced',
      title: 'Advanced Voice Chat',
      description: 'Advanced VAD configuration with echo cancellation, noise suppression, and filler word removal',
      features: ['Azure Semantic VAD', 'Echo cancellation', 'Noise suppression', 'Barge-in']
    },
    {
      path: '/voice-proxy',
      title: 'Voice with Proxy',
      description: 'Secure proxy mode with API key stored in backend instead of client',
      features: ['Secure proxy', 'Backend auth']
    },
    {
      path: '/voice-proxy-msal',
      title: 'Voice with MSAL Auth',
      description: 'MSAL authentication integration with token acquisition and refresh',
      features: ['MSAL', 'Token auth', 'Sign-in flow']
    }
  ],
  'Avatar Examples': [
    {
      path: '/avatar-basic',
      title: 'Basic Avatar',
      description: 'Simple avatar with video stream rendering and character configuration',
      features: ['Video render', 'Character: lisa', 'H.264 codec']
    },
    {
      path: '/avatar-advanced',
      title: 'Advanced Avatar',
      description: 'High-resolution avatar with transparent background removal and advanced VAD',
      features: ['Chroma key', '1080p video', 'Transparent background', 'Semantic VAD']
    },
    {
      path: '/avatar-proxy',
      title: 'Avatar with Proxy',
      description: 'Secure proxy mode for avatar with environment-based configuration',
      features: ['Secure proxy', 'Backend auth']
    },
    {
      path: '/avatar-proxy-msal',
      title: 'Avatar with MSAL Auth',
      description: 'Avatar with MSAL authentication and manual audio capture',
      features: ['MSAL', 'Manual audio capture', 'Token auth']
    }
  ],
  'Agent Service': [
    {
      path: '/agent-service',
      title: 'Agent Service (Voice)',
      description: 'Full backend agent service with MSAL auth, event logging, and Whisper transcription',
      features: ['Backend proxy', 'MSAL', 'Event logging', 'Whisper', 'PCM16 audio']
    },
    {
      path: '/agent-service-avatar',
      title: 'Agent Service (Avatar)',
      description: 'Complete agent service with avatar integration and all advanced features',
      features: ['Video + Agent', 'Full backend', 'MSAL', 'Event logs']
    }
  ],
  'Advanced Features': [
    {
      path: '/function-calling',
      title: 'Function Calling',
      description: 'Tool/function definition system with custom get_weather and get_time tools',
      features: ['Tool calls', 'Function execution', 'Event logging']
    },
    {
      path: '/audio-visualizer',
      title: 'Audio Visualizer',
      description: 'Real-time audio waveform visualization using Canvas and FFT analysis',
      features: ['Canvas', 'FFT analysis', 'Waveform', 'Animation']
    },
    {
      path: '/viseme',
      title: 'Viseme Data',
      description: 'Capture viseme data for custom avatar mouth shapes (works with Standard voices only)',
      features: ['22 viseme types', 'Audio sync', 'Standard voices only']
    },
    {
      path: '/live2d-avatar',
      title: 'Live2D Avatar',
      description: 'Real-time Live2D avatar animation using Azure viseme data with the Kei character model',
      features: ['Live2D', 'Viseme sync', 'Kei model', 'Lip-sync']
    }
  ]
};

function SampleCard({ sample }: { sample: SampleInfo }): JSX.Element {
  return (
    <Link
      to={sample.path}
      style={{
        display: 'block',
        backgroundColor: 'white',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '16px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.2s ease',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#0078d4';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 120, 212, 0.1)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#e0e0e0';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600, color: '#0078d4' }}>
        {sample.title}
      </h3>
      <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#666', lineHeight: '1.5' }}>
        {sample.description}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {sample.features.map((feature, idx) => (
          <span
            key={idx}
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: '4px',
              fontSize: '12px',
              backgroundColor: '#f5f5f5',
              color: '#555',
              border: '1px solid #e0e0e0'
            }}
          >
            {feature}
          </span>
        ))}
      </div>
    </Link>
  );
}

export function HomePage(): JSX.Element {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px' }}>
      <header style={{ marginBottom: '48px' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '36px', fontWeight: 700, color: '#333' }}>
          Microsoft Foundry Voice Live React
        </h1>
        <p style={{ margin: 0, fontSize: '18px', color: '#666', lineHeight: '1.6' }}>
          Developer samples and reference implementations for the Azure AI Voice Live API
        </p>
      </header>

      {Object.entries(samples).map(([category, categoryItems]) => (
        <section key={category} style={{ marginBottom: '48px' }}>
          <h2 style={{
            margin: '0 0 20px 0',
            fontSize: '24px',
            fontWeight: 600,
            color: '#333',
            paddingBottom: '12px',
            borderBottom: '2px solid #0078d4'
          }}>
            {category}
          </h2>
          <div>
            {categoryItems.map((sample) => (
              <SampleCard key={sample.path} sample={sample} />
            ))}
          </div>
        </section>
      ))}

      <footer style={{
        marginTop: '64px',
        padding: '24px 0',
        borderTop: '1px solid #e0e0e0',
        textAlign: 'center'
      }}>
        <p style={{ margin: 0, fontSize: '14px', color: '#666' }}>
          Built with{' '}
          <a
            href="https://iloveagents.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0078d4', textDecoration: 'none', fontWeight: 500 }}
          >
            iLoveAgents.ai
          </a>
        </p>
      </footer>
    </div>
  );
}
