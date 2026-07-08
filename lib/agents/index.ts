import 'server-only';

import { createBedrockNovaAgent } from './amazon-nova';
import type { ChainAgent, ChainAgentConfig } from './types';

export type { ChainAgent, ChainAgentConfig } from './types';

export function createChainAgent(config: ChainAgentConfig): ChainAgent {
  switch (config.provider) {
    case 'bedrock':
      return createBedrockNovaAgent({
        modelIdentifier: config.modelIdentifier,
      });
    default: {
      const exhaustive: never = config.provider;
      return exhaustive;
    }
  }
}
