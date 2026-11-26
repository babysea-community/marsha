import 'server-only';

import { createAmazonNovaAgent } from './amazon-nova';
import type { ChainAgent, ChainAgentConfig } from './types';

export {
  createShowrunnerQwenAgent,
  defaultShowrunnerQwenAgentModelIdentifier,
  type ShowrunnerQwenAgent,
  type ShowrunnerQwenAgentInput,
} from './qwen';

export type { ChainAgent, ChainAgentConfig } from './types';

export function createChainAgent(config: ChainAgentConfig): ChainAgent {
  switch (config.provider) {
    case 'bedrock':
      return createAmazonNovaAgent({
        modelIdentifier: config.modelIdentifier,
      });
    default: {
      const exhaustive: never = config.provider;
      return exhaustive;
    }
  }
}
