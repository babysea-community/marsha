# Chain Agent RAG Plan

Marsha does not need an AWS Bedrock Knowledge Base for the first durable Chain Agent path.

## Current Grounding

The Chain Agent is grounded by runtime context that Marsha already owns:

- The previous generated media, passed directly to Amazon Nova as image/video input when it is available as a data URL or HTTPS provider URL.
- The original run input JSON.
- The previous step request params.
- The downstream step model identifier and Marsha role.
- The downstream Semantic Lady schema filtered for chain-safe fields.

This is enough for Copilot and Autopilot prompt planning because the agent task is local to the active chain run, not broad knowledge retrieval.

## AWS Docs Alignment

This is the Amazon Nova "Provide supporting text" RAG pattern (the docs treat a managed Bedrock Knowledge Base as a separate, optional retriever, which Marsha does not need for run-local planning):

- Supporting text: the Runtime Context (downstream schema, current models, previous params), the Internal Tool Results, the Creator Brief, and the previous media are augmented into the prompt as the agent's trusted reference, in delimited `##` sections.
- Anti-hallucination: the system prompt instructs the agent to base every schema field, enum value, and numeric limit ONLY on that reference and to not use fields that are not in the provided schema - the Nova-recommended "do not use information that is not in the reference" rule, scoped to the structural params.
- Creative latitude: the strict grounding applies to the schema/params and to observations of the media, not to the wording of the creative prompt, which stays original by design.

## Future AWS Work

No AWS Knowledge Base is required now.

Consider a Bedrock Knowledge Base later only if Chain Agent needs durable product/brand/style memory, user-uploaded creative briefs, or organization-specific prompt rules across runs. In that case, create a knowledge base in Bedrock, attach a vector store, ingest approved brand/style documents, and expose retrieval as a separate agent dependency rather than mixing it into media providers.

## Guardrails

- Do not let retrieved documents override Marsha safety, schema, or media-handoff rules.
- Keep retrieved text outside provider credentials and callback fields.
- Cite internal source ids in checkpoint output if RAG is added later.
