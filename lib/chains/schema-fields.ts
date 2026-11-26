import type { z } from 'zod';

import type { ChainInputField } from './types';

type ZodDef = Record<string, unknown>;

export function deriveChainInputFields(
  schema: z.ZodType,
  overrides: ChainInputField[] = [],
): ChainInputField[] {
  const shape = getObjectShape(schema);
  const overrideByName = new Map(
    overrides.map((field): [string, ChainInputField] => [field.name, field]),
  );

  if (!shape) {
    return overrides;
  }

  return Object.entries(shape).map(([name, fieldSchema]) => {
    const override = overrideByName.get(name);
    const { core, defaultValue, isOptional } = unwrap(fieldSchema);
    const required = override?.required ?? !isOptional;
    const field: ChainInputField = {
      name,
      type: getFieldType(core),
      required,
      description:
        fieldSchema.description ?? override?.description ?? humanizeName(name),
    };
    const enumValues = getEnumValues(core);
    const bounds = getNumberBounds(core);

    if (override?.default !== undefined) {
      field.default = override.default;
    } else if (!required && defaultValue !== undefined) {
      field.default = defaultValue as ChainInputField['default'];
    }

    if (enumValues) {
      field.enum = enumValues;
    } else if (override?.enum) {
      field.enum = override.enum;
    }

    if (bounds.min !== undefined) {
      field.min = bounds.min;
    }

    if (bounds.max !== undefined) {
      field.max = bounds.max;
    }

    return field;
  });
}

function getObjectShape(schema: z.ZodType) {
  const objectSchema = unwrapToObject(schema as z.ZodTypeAny);

  return objectSchema
    ? (objectSchema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape
    : null;
}

function unwrapToObject(schema: z.ZodTypeAny): z.ZodTypeAny | null {
  let current = schema;

  for (;;) {
    const name = typeName(current);

    if (name === 'ZodObject') {
      return current;
    }

    const next = unwrapOne(current);

    if (!next || next === current) {
      return null;
    }

    current = next;
  }
}

function unwrap(schema: z.ZodTypeAny) {
  let current = schema;
  let defaultValue: unknown;
  let isOptional = false;

  for (;;) {
    const name = typeName(current);

    if (name === 'ZodDefault') {
      const value = (current._def as unknown as { defaultValue: unknown })
        .defaultValue;
      defaultValue = typeof value === 'function' ? value() : value;
      isOptional = true;
      current = (current._def as unknown as { innerType: z.ZodTypeAny })
        .innerType;
      continue;
    }

    if (name === 'ZodOptional' || name === 'ZodNullable') {
      isOptional = true;
      current = (current._def as unknown as { innerType: z.ZodTypeAny })
        .innerType;
      continue;
    }

    const next = unwrapOne(current);

    if (!next || next === current) {
      break;
    }

    current = next;
  }

  return { core: current, defaultValue, isOptional };
}

function unwrapOne(schema: z.ZodTypeAny) {
  const name = typeName(schema);

  if (name === 'ZodEffects') {
    return (schema._def as unknown as { schema: z.ZodTypeAny }).schema;
  }

  if (name === 'ZodPipeline' || name === 'ZodPipe') {
    return (schema._def as unknown as { out: z.ZodTypeAny }).out;
  }

  if (name === 'ZodOptional' || name === 'ZodNullable') {
    return (schema._def as unknown as { innerType: z.ZodTypeAny }).innerType;
  }

  if (name === 'ZodDefault') {
    return (schema._def as unknown as { innerType: z.ZodTypeAny }).innerType;
  }

  return null;
}

function getFieldType(core: z.ZodTypeAny): ChainInputField['type'] {
  const name = typeName(core);

  switch (name) {
    case 'ZodArray':
      return 'array';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodNumber':
      return 'number';
    case 'ZodObject':
    case 'ZodRecord':
      return 'object';
    default:
      return 'string';
  }
}

function getEnumValues(core: z.ZodTypeAny) {
  if (typeName(core) === 'ZodEnum') {
    const definition = core._def as unknown as {
      entries?: Record<string, string>;
      values?: string[];
    };

    return definition.values ?? Object.values(definition.entries ?? {});
  }

  if (typeName(core) !== 'ZodUnion') {
    return undefined;
  }

  const values = (core._def as unknown as { options: z.ZodTypeAny[] }).options
    .map((option) =>
      typeName(option) === 'ZodLiteral' ? getLiteralValue(option) : undefined,
    )
    .filter((value): value is string | number | boolean => value !== undefined);

  return values.length > 0 ? values.map(String) : undefined;
}

function getNumberBounds(core: z.ZodTypeAny) {
  if (typeName(core) !== 'ZodNumber') {
    return {};
  }

  const checks =
    (
      core._def as unknown as {
        checks?: Array<{
          _zod?: {
            def?: {
              check?: string;
              inclusive?: boolean;
              value?: number;
            };
          };
          kind?: string;
          value?: number;
        }>;
      }
    ).checks ?? [];
  const bounds: { min?: number; max?: number } = {};

  for (const check of checks) {
    const definition = check._zod?.def;
    const value = definition?.value ?? check.value;

    if (typeof value !== 'number') {
      continue;
    }

    if (check.kind === 'min' || definition?.check === 'greater_than') {
      bounds.min = value;
    }

    if (check.kind === 'max' || definition?.check === 'less_than') {
      bounds.max = value;
    }
  }

  return bounds;
}

function getLiteralValue(schema: z.ZodTypeAny) {
  const definition = schema._def as unknown as {
    value?: unknown;
    values?: readonly unknown[];
  };

  return definition.value ?? definition.values?.[0];
}

function typeName(schema: z.ZodTypeAny) {
  const definition = schema._def as unknown as ZodDef;

  const name = definition.typeName ?? definition.type;

  if (typeof name !== 'string') {
    return '';
  }

  return name.startsWith('Zod')
    ? name
    : `Zod${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function humanizeName(name: string) {
  return name.replaceAll('_', ' ');
}
