import { createFontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { InlineGitHub } from '@/components/icons/inline-git';
import { InlineSentry } from '@/components/icons/inline-sponsor';
import type { ModelChainCatalogEntry } from '@/lib/chains/catalog';
import type { ModelCatalogEntry } from '@/lib/models/model-catalog';

const ChartLine = createFontAwesomeIcon('chart-line');
const CodeFork = createFontAwesomeIcon('code-fork');
const Database = createFontAwesomeIcon('database');
const Fingerprint = createFontAwesomeIcon('fingerprint');
const Flag = createFontAwesomeIcon('flag');
const Heart = createFontAwesomeIcon('heart');
const Key = createFontAwesomeIcon('key');
const Lock = createFontAwesomeIcon('lock');
const Microchip = createFontAwesomeIcon('microchip');
const Rocket = createFontAwesomeIcon('rocket');
const Share = createFontAwesomeIcon('share');
const ShieldHalved = createFontAwesomeIcon('shield-halved');
const Terminal = createFontAwesomeIcon('terminal');
const UserAstronaut = createFontAwesomeIcon('user-astronaut');
const UserSecret = createFontAwesomeIcon('user-secret');
const UserShield = createFontAwesomeIcon('user-shield');

export const siteNavigation = {
  brand: 'Marsha',
  homeHref: '/',
  actions: [
    {
      href: 'https://github.com/babysea-community/marsha',
      icon: InlineGitHub,
      label: 'GitHub',
      variant: 'outline' as const,
    },
    {
      href: 'https://github.com/sponsors/babysea-community',
      icon: Heart,
      label: 'Sponsor',
      tone: 'sponsor' as const,
      variant: 'default' as const,
    },
    {
      href: '/login',
      icon: UserShield,
      label: 'Owner access',
      variant: 'outline' as const,
    },
  ],
};

export const homepageHero = {
  eyebrow: 'Canvas studio + Showrunner + Agentic planner + Chain API',
  title: 'Every output becomes the next input.',
  description:
    'Compose image and video model chains on a visual canvas, then run the same flows through a durable self-hosted API with one final callback.',
  actions: [
    {
      href: '/templates',
      icon: Rocket,
      label: 'Explore templates',
      variant: 'outline' as const,
    },
  ],
  preview: {
    command: 'POST /api/v1/chains/runs',
    route: '/api/v1/chains/runs',
    status: 'ready',
  },
  pipeline: {
    label: 'Marsha run path',
    nodes: [
      'request',
      'image output',
      'handoff URL',
      'video output',
      'callback',
    ],
  },
  console: {
    title: 'Marsha workflow',
    deployTitle: 'Marsha deployment',
    lines: [
      'load the requested chain template',
      'verify scoped caller identity',
      'resolve BYOK inference credentials',
      'draft each next action with an agentic planner',
      'approve copilot checkpoints or release autopilot',
      'persist durable runs and ordered records',
      'execute steps, hand off outputs, send signed callback',
    ],
    deployLinks: [
      {
        href: 'https://github.com/babysea-community/marsha/blob/main/docs/deployment/alibaba-cloud-ecs.md',
        label: 'Alibaba Cloud ECS',
      },
      {
        href: 'https://github.com/babysea-community/marsha/blob/main/docs/deployment/aws-cloudformation.md',
        label: 'AWS CloudFormation',
      },
      {
        href: 'https://github.com/babysea-community/marsha/blob/main/docs/deployment/aws-ec2.md',
        label: 'AWS EC2',
      },
      {
        href: 'https://github.com/babysea-community/marsha/blob/main/docs/deployment/coolify.md',
        label: 'Coolify',
      },
      {
        href: 'https://cloud.digitalocean.com/apps/new?repo=https://github.com/babysea-community/marsha/tree/main',
        label: 'DigitalOcean',
      },
      {
        href: 'https://github.com/babysea-community/marsha/blob/main/docs/deployment/docker.md',
        label: 'Docker',
      },
      {
        href: 'https://github.com/babysea-community/marsha/blob/main/docs/deployment/fly-io.md',
        label: 'Fly.io',
      },
      {
        href: 'https://github.com/babysea-community/marsha/blob/main/docs/deployment/google-cloud-run.md',
        label: 'Google Cloud Run',
      },
      {
        href: 'https://app.netlify.com/start/deploy?repository=https://github.com/babysea-community/marsha',
        label: 'Netlify',
      },
      {
        href: 'https://railway.com/deploy/marsha?referralCode=_FJpRb',
        label: 'Railway',
      },
      {
        href: 'https://render.com/deploy?repo=https://github.com/babysea-community/marsha',
        label: 'Render',
      },
      {
        href: 'https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbabysea-community%2Fmarsha&project-name=marsha&repository-name=marsha&env=NEXT_PUBLIC_SITE_URL,OWNER_EMAIL,OWNER_PASSWORD,OWNER_SESSION_SECRET,APP_DATABASE,DATABASE_URL,APP_API_KEY,APP_CRON_SECRET,APP_CALLBACK_SECRET,APP_PROVIDER_MODE,DASHSCOPE_API_KEY,BFL_API_KEY,BFL_REGION,BFL_API_BASE_URL,ARK_API_KEY,GEMINI_API_KEY,OPENAI_API_KEY,RUNWAYML_API_SECRET,BABYSEA_API_KEY,BABYSEA_REGION,BABYSEA_API_BASE_URL,AGENT_CHAIN_AWS_BEDROCK_TOKEN,AGENT_CHAIN_AWS_BEDROCK_REGION,AGENT_CHAIN_AWS_BEDROCK_AGENT,APP_STORAGE_PROVIDER,ALIBABA_CLOUD_OSS_REGION,ALIBABA_CLOUD_OSS_ACCESS_KEY_ID,ALIBABA_CLOUD_OSS_ACCESS_KEY_SECRET,ALIBABA_CLOUD_OSS_BUCKET_NAME,ALIBABA_CLOUD_OSS_ENDPOINT,ALIBABA_CLOUD_OSS_PUBLIC_BASE_URL,AWS_S3_REGION,AWS_S3_ACCESS_KEY_ID,AWS_S3_SECRET_ACCESS_KEY,AWS_S3_BUCKET_NAME,AWS_S3_ENDPOINT_URL,BACKBLAZE_B2_KEY_ID,BACKBLAZE_B2_APPLICATION_KEY,BACKBLAZE_B2_BUCKET_NAME,BACKBLAZE_B2_BUCKET_ID,BACKBLAZE_B2_PUBLIC_BASE_URL,CLOUDFLARE_R2_ACCOUNT_ID,CLOUDFLARE_R2_ACCESS_KEY_ID,CLOUDFLARE_R2_SECRET_ACCESS_KEY,CLOUDFLARE_R2_BUCKET_NAME,CLOUDFLARE_R2_ENDPOINT_URL,CLOUDFLARE_R2_CUSTOM_DOMAIN_URL,HUGGINGFACE_STORAGE_NAMESPACE,HUGGINGFACE_STORAGE_ACCESS_KEY_ID,HUGGINGFACE_STORAGE_SECRET_ACCESS_KEY,HUGGINGFACE_STORAGE_BUCKET_NAME,HUGGINGFACE_STORAGE_PUBLIC_BASE_URL,MINIO_ENDPOINT_URL,MINIO_ACCESS_KEY_ID,MINIO_SECRET_ACCESS_KEY,MINIO_BUCKET_NAME,MINIO_REGION,MINIO_PUBLIC_BASE_URL,SCALEWAY_OBJECT_STORAGE_REGION,SCALEWAY_OBJECT_STORAGE_ACCESS_KEY_ID,SCALEWAY_OBJECT_STORAGE_SECRET_ACCESS_KEY,SCALEWAY_OBJECT_STORAGE_BUCKET_NAME,SCALEWAY_OBJECT_STORAGE_ENDPOINT_URL,SCALEWAY_OBJECT_STORAGE_PUBLIC_BASE_URL,SPACES_REGION,SPACES_ACCESS_KEY_ID,SPACES_SECRET_ACCESS_KEY,SPACES_BUCKET_NAME,SPACES_ENDPOINT_URL,SPACES_PUBLIC_BASE_URL,BLOB_READ_WRITE_TOKEN,NEXT_PUBLIC_SENTRY_DSN,NEXT_PUBLIC_SENTRY_ENVIRONMENT,SENTRY_ORG,SENTRY_PROJECT',
        label: 'Vercel',
      },
    ],
  },
};

export const catalogIntro = {
  eyebrow: 'Chain templates',
  title: 'Orchestrate model-to-model workflows.',
  description:
    'Marsha runs chained image and video steps where each output can be transformed, restyled, or extended before one final callback.',
  apiHostLabel: 'Host and run Marsha',
  modelCatalogLabel: 'Inference providers',
  storageLabel: 'Storage providers',
};

export const providerModes = {
  eyebrow: 'Provider modes',
  title: 'Self-hosted with your own keys and environment.',
  description:
    'Run Marsha in either mode: BYOK connects to your providers directly; BabySea mode uses your BabySea API key behind the same API contract.',
  footnote:
    'Caller apps keep using Marsha API keys either way; provider credentials stay inside your backend.',
  modes: [
    {
      env: 'APP_PROVIDER_MODE=byok',
      icon: Key,
      label: 'Direct inference access',
      text: 'Connect your inference provider credentials. Your Marsha deployment owns model access, provider settings, and orchestration.',
      title: 'BYOK mode',
    },
    {
      env: 'APP_PROVIDER_MODE=babysea',
      icon: Lock,
      label: 'Managed execution path',
      text: 'Use one BabySea API key for supported chain execution while keeping Marsha routes, callbacks, and template contracts unchanged.',
      title: 'BabySea mode',
    },
  ],
};

export const agenticWorkflow = {
  eyebrow: 'Agentic Workflow',
  title: 'Design and chain your canvas with an agentic planner.',
  description:
    'Lay out a chain on the canvas, then let an agentic planner read the previous output, the chain context, and the model schema to propose the next step. Approve each checkpoint in Copilot, or hand it the wheel on Autopilot.',
  modelLabel: 'Planner model',
  modelName: 'Amazon Nova',
  showrunnerLabel: 'Showrunner model',
  showrunnerModelName: 'Qwen3.7',
  features: [
    {
      icon: UserAstronaut,
      label: 'Agentic · Copilot',
      title: 'Approve every step',
      text: 'Copilot proposes the prompt and fields for the next step; you lock the values and approve before it runs.',
    },
    {
      icon: UserSecret,
      label: 'Agentic · Autopilot',
      title: 'Run the whole chain',
      text: 'Autopilot applies each planned step automatically and hands every output to the next model.',
    },
  ],
};

export const databaseEngine = {
  eyebrow: 'Database engines',
  title: 'Persist and replay every run on a durable database.',
  description:
    'Every run, step, checkpoint, and output is written to a durable Postgres database, so retries stay idempotent and any paused run resumes exactly where it stopped. Your deployment owns the schema, rows, and full run history.',
  modelLabel: 'Database engines',
};

export const workflowNotes = [
  {
    icon: CodeFork,
    title: 'Chain templates',
    text: 'Each route defines step order, default models, dependencies, and the public run contract in the template layer.',
  },
  {
    icon: Fingerprint,
    title: 'Request contracts',
    text: 'Create-run requests are validated before execution so inputs, callbacks, and model overrides stay predictable.',
  },
  {
    icon: ChartLine,
    title: 'Persistent runs',
    text: 'Runs, ordered steps, outputs, provider metadata, callbacks, and replay checks stay in server-side storage.',
  },
  {
    icon: Microchip,
    title: 'Autopilot planning',
    text: 'Autopilot-mode can propose each next step from the previous output, chain context, and model schema.',
  },
  {
    icon: Flag,
    title: 'Copilot approvals',
    text: 'Copilot-mode checkpoints persist server-side, so you lock and approve each planned step or resume an awaiting run later.',
  },
  {
    icon: ShieldHalved,
    title: 'Credential isolation',
    text: 'Caller apps authenticate at your API boundary while provider BYOK credentials remain inside your backend.',
  },
  {
    icon: Share,
    title: 'Output handoff',
    text: 'A successful generation output becomes the next model input without extra orchestration from the caller.',
  },
  {
    icon: Database,
    title: 'File storage',
    text: 'Completed image and video outputs can be copied to your own storage, while provider URLs keep working when storage is off.',
  },
  {
    icon: Terminal,
    title: 'API control plane',
    text: 'Your deployment owns the orchestration API, queues, callbacks, and route contracts for products and tools.',
  },
];

export const homepageCta = {
  eyebrow: 'Launch your media workflow stack',
  title: 'Design on the canvas. Ship the API.',
  description:
    'Fork the starter, connect your provider keys, and compose flows on the canvas, or hand the next step to an agentic planner. Every run persists in durable database and ships through stable image and video routes for products, automations, and internal tools.',
  actions: [
    {
      href: 'https://github.com/babysea-community/marsha',
      icon: InlineGitHub,
      label: 'Fork starter',
      variant: 'outline' as const,
    },
  ],
};

export const communityPrograms = {
  eyebrow: 'Ecosystem programs',
  title: 'We are part of the AI community.',
  founderLabel: 'BabySea and its founder',
  founderHref: 'https://babysea.ai/about',
  description:
    'BabySea and its founder, the builder of Marsha, are active across the AI community; joining accelerators and creator cohorts, sharing early feedback with model and tooling teams, and helping shape how image and video generation reaches real creative workflows.',
  programs: [
    { org: 'OpenAI', name: 'OpenAI for Startups' },
    { org: 'Alibaba Cloud', name: 'Alibaba AI Catalyst Program' },
    { org: 'Black Forest Labs', name: 'FLUX Creators' },
    { org: 'Runway', name: 'Runway Builders' },
  ],
};

export const communitySponsors = {
  eyebrow: 'The sponsors',
  title: 'Huge thanks for the support.',
  description:
    'Huge thanks to the companies and teams who support us, and to future sponsors who want to help open generative media infrastructure move faster.',
  sponsors: [
    {
      icon: InlineSentry,
      name: 'Sentry',
    },
  ],
};

export const siteFooter = {
  brand: 'Marsha',
  description:
    'AI studio for chaining generative media models and showrunner turning drama scenes into full stories.',
  githubPipeline: {
    eyebrow: 'Repository CI/CD',
    href: 'https://github.com/babysea-community/marsha/actions',
    label: 'GitHub CI',
    text: 'Build, test, and deploy checks for the public repository.',
  },
  pipeline: {
    eyebrow: 'CI/CD pipeline',
    href: 'https://gitlab.com/babysea/marsha/-/commits/main',
    label: 'GitLab CI mirror',
    text: 'Security, quality, and release checks for public review.',
  },
  linkGroups: [
    {
      title: 'Project',
      links: [
        {
          href: 'https://github.com/babysea-community/marsha',
          label: 'Repository',
        },
        {
          href: 'https://github.com/babysea-community/marsha/blob/main/README.md',
          label: 'README',
        },
        {
          href: 'https://github.com/babysea-community/marsha/blob/main/CHANGELOG.md',
          label: 'Changelog',
        },
        {
          href: 'https://github.com/babysea-community/marsha/blob/main/SUPPORTED_MODELS.md',
          label: 'Supported models',
        },
      ],
    },
    {
      title: 'Community',
      links: [
        {
          href: 'https://github.com/babysea-community/marsha/blob/main/CONTRIBUTING.md',
          label: 'Contributing',
        },
        {
          href: 'https://github.com/babysea-community/marsha/blob/main/CODE_OF_CONDUCT.md',
          label: 'Code of conduct',
        },
        {
          href: 'https://github.com/babysea-community/marsha/issues',
          label: 'Issues',
        },
        {
          href: 'https://github.com/babysea-community/marsha/pulls',
          label: 'Pull requests',
        },
      ],
    },
    {
      title: 'Trust',
      links: [
        {
          href: 'https://github.com/babysea-community/marsha/blob/main/SECURITY.md',
          label: 'Security policy',
        },
        {
          href: 'https://github.com/babysea-community/marsha/blob/main/LICENSE',
          label: 'Apache-2.0 license',
        },
        {
          href: 'https://github.com/babysea-community/marsha/blob/main/LICENSES.md',
          label: 'License inventory',
        },
      ],
    },
  ],
};

export const chainDetailContent = {
  backLabel: 'Chain index',
  schemaTableTitle: 'input schema',
  schemaColumns: {
    field: 'Field',
    type: 'Type',
  },
  stepsEyebrow: 'execution flow',
  stepsTitle: 'The same route starts every ordered model step.',
  stepLabels: {
    dependencyPrefix: 'Depends on',
    indexPrefix: 'Step',
    rootDependency: 'run input',
  },
};

export function createHomepageMetrics({
  catalog,
  models,
}: {
  catalog: ModelChainCatalogEntry[];
  models: ModelCatalogEntry[];
}) {
  return [
    {
      label: 'available models',
      value: countUnique(models.map((model) => model.modelIdentifier)),
    },
    {
      label: 'chain templates',
      value: catalog
        .filter((entry) => entry.slug !== entry.templateSlug)
        .length.toLocaleString('en-US'),
    },
  ];
}

function countUnique(values: string[]) {
  return new Set(values).size.toLocaleString('en-US');
}
