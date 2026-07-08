const PUBLIC_MODEL_NAME_OVERRIDES: Record<string, string> = {
  'happyhorse/1.0-i2v': 'HappyHorse 1.0 I2V',
  'happyhorse/1.0-r2v': 'HappyHorse 1.0 R2V',
  'happyhorse/1.0-t2v': 'HappyHorse 1.0 T2V',
  'happyhorse/1.0-video-edit': 'HappyHorse 1.0 Video Edit',
  'google/imagen-4': 'Imagen 4',
  'google/imagen-4-fast': 'Imagen 4 Fast',
  'google/imagen-4-ultra': 'Imagen 4 Ultra',
  'google/nano-banana': 'Nano Banana',
  'google/nano-banana-2': 'Nano Banana 2',
  'google/nano-banana-pro': 'Nano Banana Pro',
  'google/veo-3.1': 'Veo 3.1',
  'google/veo-3.1-fast': 'Veo 3.1 Fast',
  'google/veo-3.1-lite': 'Veo 3.1 Lite',
  'gpt/image-2': 'GPT Image 2',
  'runway/act-two': 'Runway Act-Two',
  'runway/act-two-image': 'Runway Act-Two (Image)',
  'runway/act-two-video': 'Runway Act-Two (Video)',
  'runway/aleph-2': 'Runway Aleph 2',
  'runway/gen-4-aleph': 'Runway Gen-4 Aleph',
  'runway/gen-4-image': 'Runway Gen-4 Image',
  'runway/gen-4-image-turbo': 'Runway Gen-4 Image Turbo',
  'runway/gen-4-turbo': 'Runway Gen-4 Turbo',
  'runway/gen-4.5': 'Runway Gen-4.5',
  'qwen/image': 'Qwen Image',
  'qwen/image-plus': 'Qwen Image Plus',
  'qwen/image-2': 'Qwen Image 2.0',
  'qwen/image-2-pro': 'Qwen Image 2.0 Pro',
  'qwen/image-edit': 'Qwen Image Edit',
  'qwen/image-edit-max': 'Qwen Image Edit Max',
  'qwen/image-edit-plus': 'Qwen Image Edit Plus',
  'qwen/image-max': 'Qwen Image Max',
  'wan/2.1-imageedit': 'Wan 2.1 Image Edit',
  'wan/2.2-animate-mix': 'Wan 2.2 Animate Mix',
  'wan/2.2-animate-mix-image': 'Wan 2.2 Animate Mix (Image)',
  'wan/2.2-animate-mix-video': 'Wan 2.2 Animate Mix (Video)',
  'wan/2.2-animate-move': 'Wan 2.2 Animate Move',
  'wan/2.2-animate-move-image': 'Wan 2.2 Animate Move (Image)',
  'wan/2.2-animate-move-video': 'Wan 2.2 Animate Move (Video)',
  'wan/2.5-i2i-preview': 'Wan 2.5 I2I Preview',
  'wan/2.6-image': 'Wan 2.6 Image',
  'wan/2.6-t2i': 'Wan 2.6 T2I',
  'wan/2.7-i2v-2026-04-25': 'Wan 2.7 I2V',
  'wan/2.7-image': 'Wan 2.7 Image',
  'wan/2.7-image-pro': 'Wan 2.7 Image Pro',
  'wan/2.7-r2v': 'Wan 2.7 R2V',
  'wan/2.7-t2v': 'Wan 2.7 T2V',
  'wan/2.7-videoedit': 'Wan 2.7 Video Edit',
  'z/image-turbo': 'Z Image Turbo',
};

const MODEL_FAMILY_PREFIXES: Record<string, string> = {
  happyhorse: 'HappyHorse',
  google: 'Google',
  gpt: 'GPT',
  qwen: 'Qwen',
  runway: 'Runway',
  wan: 'Wan',
  z: 'Z',
};

const TOKEN_OVERRIDES: Record<string, string> = {
  flux: 'FLUX',
  i2i: 'I2I',
  i2v: 'I2V',
  imageedit: 'Image Edit',
  r2v: 'R2V',
  t2i: 'T2I',
  t2v: 'T2V',
  videoedit: 'Video Edit',
};

export function formatPublicModelName(modelIdentifier: string) {
  const override = PUBLIC_MODEL_NAME_OVERRIDES[modelIdentifier];

  if (override) {
    return override;
  }

  const [provider = '', model = modelIdentifier] = modelIdentifier.split('/');
  const modelName = humanizeModelName(model);
  const prefix = MODEL_FAMILY_PREFIXES[provider];

  return prefix ? `${prefix} ${modelName}` : modelName;
}

function humanizeModelName(model: string) {
  return model.split('-').filter(Boolean).map(formatModelToken).join(' ');
}

function formatModelToken(token: string) {
  const lowerToken = token.toLowerCase();
  const override = TOKEN_OVERRIDES[lowerToken];

  if (override) {
    return override;
  }

  if (/^\d+b$/.test(lowerToken)) {
    return lowerToken.toUpperCase();
  }

  return lowerToken.charAt(0).toUpperCase() + lowerToken.slice(1);
}
