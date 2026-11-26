export type UiFieldSpec = {
  default?: unknown;
  name: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  valueKind?: 'string' | 'number' | 'boolean' | 'string-array' | 'json';
};

export type ChainRunInputParts = {
  imageModel: string;
  imageModelInput?: Record<string, unknown>;
  modifyModel?: string;
  modifyModelInput?: Record<string, unknown>;
  refineModel?: string;
  refineModelInput?: Record<string, unknown>;
  videoModel: string;
  videoModelInput?: Record<string, unknown>;
};

export type ChainRunRequestBody = {
  input: Record<string, unknown>;
  execution?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

// Optional request parts that mirror the run the canvas actually launches: the
// execution config (self_control vs chain_agent copilot/autopilot) and run
// metadata (the owner's model_context/Creator Brief). Without these the curl
// would silently fall back to a default self_control run with no brief.
export type ChainRunRequestExtras = {
  execution?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type ChainCurlOptions = {
  runId?: string | null;
  siteUrl?: string | null;
};

const IDEMPOTENCY_KEY_PLACEHOLDER = 'your-unique-idempotency-key';
const SITE_URL_PLACEHOLDER = '$NEXT_PUBLIC_SITE_URL';
const RUN_ID_PLACEHOLDER = '$RUN_ID';
const EMPTY_KEYS = new Set<string>();
const NORMALIZED_INPUT_FILE_FIELDS = new Set([
  'generation_input_audio_file',
  'generation_input_image_file',
  'generation_input_video_file',
]);

export function createModelSchemaJsonFromFields({
  fields,
  modelId,
  modelLabel,
}: {
  fields: readonly UiFieldSpec[];
  modelId: string;
  modelLabel: string;
}) {
  const required = fields
    .filter((field) => field.required)
    .map((field) => field.name);

  return {
    model: modelLabel,
    model_identifier: modelId,
    schema: {
      type: 'object',
      ...(required.length > 0 ? { required } : {}),
      properties: Object.fromEntries(
        fields.map((field, index) => [
          field.name,
          createModelSchemaProperty(field, index),
        ]),
      ),
    },
  };
}

export function createModelSchemaJsonFromRequestSchema({
  excludedKeys = EMPTY_KEYS,
  modelId,
  modelLabel,
  schema,
}: {
  excludedKeys?: ReadonlySet<string>;
  modelId: string;
  modelLabel: string;
  schema: Record<string, unknown>;
}) {
  const required = new Set(readStringArray(schema.required));
  const properties = isJsonObject(schema.properties) ? schema.properties : {};
  const orderedProperties: Record<string, unknown> = {};
  let order = 0;

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (excludedKeys.has(key)) {
      continue;
    }

    orderedProperties[key] = normalizeSchemaProperty(propertySchema, {
      includeOrder: true,
      order,
      required: required.has(key),
    });
    order += 1;
  }

  return {
    model: modelLabel,
    model_identifier: modelId,
    schema: {
      type: 'object',
      ...(required.size > 0
        ? {
            required: [...required].filter((key) => !excludedKeys.has(key)),
          }
        : {}),
      properties: orderedProperties,
    },
  };
}

export function createStepInputFromValues({
  excludedKeys = EMPTY_KEYS,
  fields,
  values,
}: {
  excludedKeys?: ReadonlySet<string>;
  fields: readonly UiFieldSpec[];
  values: Record<string, unknown>;
}) {
  const entries = fields.flatMap((field): [string, unknown][] => {
    if (excludedKeys.has(field.name)) {
      return [];
    }

    const value = requestValueForField(field, values[field.name]);

    return value === undefined ? [] : [[field.name, value]];
  });

  return Object.fromEntries(entries);
}

export function createStepInputFromRequestSchema({
  excludedKeys = EMPTY_KEYS,
  schema,
  values = {},
}: {
  excludedKeys?: ReadonlySet<string>;
  schema: Record<string, unknown>;
  values?: Record<string, unknown>;
}) {
  const fields = fieldsFromRequestSchema(schema);

  return createStepInputFromValues({
    excludedKeys,
    fields,
    values,
  });
}

export function createExampleStepInputFromValues({
  excludedKeys = EMPTY_KEYS,
  fields,
  values,
}: {
  excludedKeys?: ReadonlySet<string>;
  fields: readonly UiFieldSpec[];
  values: Record<string, unknown>;
}) {
  const entries = fields.flatMap((field): [string, unknown][] => {
    if (excludedKeys.has(field.name)) {
      return [];
    }

    return [[field.name, exampleValueForField(field, values[field.name])]];
  });

  return Object.fromEntries(entries);
}

export function createExampleStepInputFromRequestSchema({
  excludedKeys = EMPTY_KEYS,
  schema,
  values = {},
}: {
  excludedKeys?: ReadonlySet<string>;
  schema: Record<string, unknown>;
  values?: Record<string, unknown>;
}) {
  return createExampleStepInputFromValues({
    excludedKeys,
    fields: fieldsFromRequestSchema(schema),
    values,
  });
}

export function createChainRunInput({
  imageModel,
  imageModelInput,
  modifyModel,
  modifyModelInput,
  refineModel,
  refineModelInput,
  videoModel,
  videoModelInput,
}: ChainRunInputParts) {
  return {
    chain_models: {
      image_model: imageModel,
      ...(refineModel ? { refine_model: refineModel } : {}),
      video_model: videoModel,
      ...(modifyModel ? { modify_model: modifyModel } : {}),
    },
    image_model_input: compactRequestObject(imageModelInput ?? {}),
    ...(refineModel
      ? { refine_model_input: compactRequestObject(refineModelInput ?? {}) }
      : {}),
    video_model_input: compactRequestObject(videoModelInput ?? {}),
    ...(modifyModel
      ? { modify_model_input: compactRequestObject(modifyModelInput ?? {}) }
      : {}),
  };
}

export function createChainRunRequest(
  input: Record<string, unknown>,
  extras: ChainRunRequestExtras = {},
) {
  return {
    input,
    ...(extras.execution ? { execution: extras.execution } : {}),
    ...(extras.metadata && Object.keys(extras.metadata).length > 0
      ? { metadata: extras.metadata }
      : {}),
  } satisfies ChainRunRequestBody;
}

export function createListChainsCurl(options: ChainCurlOptions = {}) {
  return [
    'curl --request GET',
    `  --url "${chainApiUrl('/api/v1/chains', options)}"`,
    '  --header "Authorization: Bearer $APP_API_KEY"',
  ].join(lineContinuation());
}

export function createChainRunCurl(
  input: Record<string, unknown>,
  options: ChainCurlOptions = {},
  extras: ChainRunRequestExtras = {},
) {
  const body = JSON.stringify(createChainRunRequest(input, extras), null, 2);
  const lines = [
    'curl --request POST',
    `  --url "${chainApiUrl('/api/v1/chains/runs', options)}"`,
    '  --header "Authorization: Bearer $APP_API_KEY"',
    '  --header "Content-Type: application/json"',
    `  --header "Idempotency-Key: ${IDEMPOTENCY_KEY_PLACEHOLDER}"`,
    `  --data '${shellSingleQuotedPayload(`\n${body}\n`)}'`,
  ];

  return lines.join(lineContinuation());
}

export function createGetRunCurl(options: ChainCurlOptions = {}) {
  return [
    'curl --request GET',
    `  --url "${chainApiUrl(`/api/v1/chains/get/${curlRunId(options.runId)}`, options)}"`,
    '  --header "Authorization: Bearer $APP_API_KEY"',
  ].join(lineContinuation());
}

export function createCancelRunCurl(options: ChainCurlOptions = {}) {
  return [
    'curl --request POST',
    `  --url "${chainApiUrl(`/api/v1/chains/cancel/${curlRunId(options.runId)}`, options)}"`,
    '  --header "Authorization: Bearer $APP_API_KEY"',
  ].join(lineContinuation());
}

function createModelSchemaProperty(field: UiFieldSpec, order: number) {
  const property: Record<string, unknown> = field.schema
    ? { ...field.schema }
    : { type: jsonSchemaTypeForField(field) };

  if (field.required) {
    property.required = true;
  }

  property['x-order'] = order;

  return property;
}

function jsonSchemaTypeForField(field: UiFieldSpec) {
  if (field.valueKind === 'json') return 'object';
  if (field.valueKind === 'string-array') return 'array';
  if (field.valueKind === 'number') return 'number';
  if (field.valueKind === 'boolean') return 'boolean';
  return 'string';
}

function normalizeSchemaProperty(
  value: unknown,
  options: { includeOrder: boolean; order: number; required: boolean },
): Record<string, unknown> {
  if (!isJsonObject(value)) {
    return {
      type: 'string',
      ...(options.required ? { required: true } : {}),
      ...(options.includeOrder ? { 'x-order': options.order } : {}),
    };
  }

  const output: Record<string, unknown> = {};

  for (const key of JSON_SCHEMA_COPY_KEYS) {
    if (value[key] !== undefined) {
      output[key] = value[key];
    }
  }

  for (const key of JSON_SCHEMA_VARIANT_KEYS) {
    const variants = value[key];

    if (Array.isArray(variants)) {
      output[key] = variants.map((variant) =>
        normalizeSchemaProperty(variant, {
          includeOrder: false,
          order: 0,
          required: false,
        }),
      );
    }
  }

  if (isJsonObject(value.items)) {
    output.items = normalizeSchemaProperty(value.items, {
      includeOrder: false,
      order: 0,
      required: false,
    });
  }

  if (isJsonObject(value.properties)) {
    output.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, property]) => [
        key,
        normalizeSchemaProperty(property, {
          includeOrder: false,
          order: 0,
          required: false,
        }),
      ]),
    );
  }

  if (options.required) {
    output.required = true;
  }

  if (options.includeOrder) {
    output['x-order'] = options.order;
  }

  return output;
}

function fieldsFromRequestSchema(schema: Record<string, unknown>) {
  const properties = isJsonObject(schema.properties) ? schema.properties : {};

  return Object.entries(properties).map(([name, propertySchema]) => {
    const schemaObject = isJsonObject(propertySchema)
      ? propertySchema
      : undefined;
    const defaultEntry = hasSchemaDefault(schemaObject)
      ? { default: schemaObject.default }
      : {};

    return {
      ...defaultEntry,
      name,
      schema: schemaObject,
      valueKind: valueKindForSchema(propertySchema),
    } satisfies UiFieldSpec;
  });
}

function exampleValueForField(field: UiFieldSpec, value: unknown) {
  if (isMeaningfulRequestValue(value)) {
    return value;
  }

  if (hasFieldDefault(field)) {
    return field.default;
  }

  return placeholderValueForField(field);
}

function placeholderValueForField(field: UiFieldSpec) {
  if (field.schema) {
    return placeholderValueForSchema(field.schema, field.valueKind);
  }

  return placeholderValueForKind(field.valueKind);
}

function placeholderValueForSchema(
  schema: Record<string, unknown> | undefined,
  fallbackKind: UiFieldSpec['valueKind'],
): unknown {
  if (!schema) {
    return placeholderValueForKind(fallbackKind);
  }

  const type = schemaType(schema, fallbackKind);

  if (type === 'array') {
    return [
      placeholderValueForSchema(
        isJsonObject(schema.items) ? schema.items : undefined,
        undefined,
      ),
    ];
  }

  if (type === 'object') {
    if (isJsonObject(schema.properties)) {
      return Object.fromEntries(
        Object.entries(schema.properties).map(([key, property]) => [
          key,
          placeholderValueForSchema(
            isJsonObject(property) ? property : undefined,
            undefined,
          ),
        ]),
      );
    }

    return '<object>';
  }

  if (type === 'integer') return '<integer>';
  if (type === 'number') return '<number>';
  if (type === 'boolean') return '<boolean>';
  if (type === 'string') return '<string>';

  return placeholderValueForKind(fallbackKind);
}

function placeholderValueForKind(kind: UiFieldSpec['valueKind']) {
  if (kind === 'number') return '<number>';
  if (kind === 'boolean') return '<boolean>';
  if (kind === 'string-array') return ['<string>'];
  if (kind === 'json') return '<object>';
  return '<string>';
}

function schemaType(
  schema: Record<string, unknown>,
  fallbackKind: UiFieldSpec['valueKind'],
) {
  const explicitType = Array.isArray(schema.type)
    ? schema.type.find((value) => value !== 'null')
    : schema.type;

  if (typeof explicitType === 'string') {
    return explicitType;
  }

  if (isJsonObject(schema.properties)) return 'object';
  if (schema.items !== undefined) return 'array';

  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
  const enumValue = enumValues.find((value) => value !== null);
  if (typeof enumValue === 'string') return 'string';
  if (typeof enumValue === 'number') return 'number';
  if (typeof enumValue === 'boolean') return 'boolean';

  if (fallbackKind === 'number') return 'number';
  if (fallbackKind === 'boolean') return 'boolean';
  if (fallbackKind === 'string-array') return 'array';
  if (fallbackKind === 'json') return 'object';
  return 'string';
}

function chainApiUrl(path: string, options: ChainCurlOptions) {
  return `${curlSiteUrl(options.siteUrl)}${path}`;
}

function curlSiteUrl(siteUrl: string | null | undefined) {
  const value =
    siteUrl ??
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_SITE_URL
      : undefined);
  const normalized = value?.trim().replace(/\/+$/, '');

  return normalized || SITE_URL_PLACEHOLDER;
}

function curlRunId(runId: string | null | undefined) {
  const normalized = runId?.trim();

  return normalized || RUN_ID_PLACEHOLDER;
}

function shellSingleQuotedPayload(value: string) {
  return value.replace(/'/g, `'\\''`);
}

const JSON_SCHEMA_COPY_KEYS = [
  'type',
  'enum',
  'const',
  'default',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'multipleOf',
  'format',
  'pattern',
] as const;

const JSON_SCHEMA_VARIANT_KEYS = ['oneOf', 'anyOf', 'allOf'] as const;

function compactRequestObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function isMeaningfulRequestValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return false;
  }

  return !(Array.isArray(value) && value.length === 0);
}

function requestValueForField(field: UiFieldSpec, value: unknown) {
  if (isMeaningfulRequestValue(value)) {
    return value;
  }

  if (hasFieldDefault(field)) {
    return field.default;
  }

  if (isFileArrayField(field)) {
    return [];
  }

  return undefined;
}

function hasFieldDefault(field: UiFieldSpec) {
  return hasOwn(field, 'default');
}

function hasSchemaDefault(
  schema: Record<string, unknown> | undefined,
): schema is Record<string, unknown> {
  return schema !== undefined && hasOwn(schema, 'default');
}

function isFileArrayField(field: UiFieldSpec) {
  return (
    field.valueKind === 'string-array' &&
    NORMALIZED_INPUT_FILE_FIELDS.has(field.name)
  );
}

function valueKindForSchema(schema: unknown): UiFieldSpec['valueKind'] {
  if (!isJsonObject(schema)) {
    return 'string';
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((value) => value !== 'null')
    : schema.type;

  if (type === 'boolean') return 'boolean';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'array') return 'string-array';
  if (type === 'object') return 'json';
  return 'string';
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function lineContinuation() {
  return ` ${String.fromCharCode(92)}\n`;
}
