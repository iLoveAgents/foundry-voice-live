# Foundry Voice Live Playground

Interactive playground for testing Microsoft Foundry Voice Live API features.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Copy the example environment file and add your Azure credentials:

```bash
cp .env.example .env
```

### 3. Download Live2D Model (Optional)

The Live2D avatar feature requires the Kei model from Live2D's sample collection. Due to licensing, this model is not included in the repository.

**Download instructions:**

1. Visit [Live2D Sample Models](https://www.live2d.com/en/learn/sample/)
2. Download the **Kei** model (look for "kei_vowels_pro")
3. Extract the contents to:
   ```
   demos/playground/public/models/kei_vowels_pro/
   ```

The directory structure should look like:
```
public/models/kei_vowels_pro/
├── kei_vowels_pro.2048/
│   └── texture_00.png
├── kei_vowels_pro.cdi3.json
├── kei_vowels_pro.moc3
├── kei_vowels_pro.model3.json
├── kei_vowels_pro.motionsync3.json
├── kei_vowels_pro.physics3.json
├── motions/
└── sounds/
```

### 4. Run the playground

```bash
pnpm dev
```

Open http://localhost:3001 in your browser.

## Features

- Voice-only mode testing
- Avatar mode with Microsoft avatars
- Live2D avatar integration (requires model download)
- Real-time audio visualization
- Session configuration testing

## License

The playground demo is MIT licensed. Note that Live2D models have their own licensing terms - see [Live2D License](https://www.live2d.com/en/terms/live2d-free-material-license-agreement/).
