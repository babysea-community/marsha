import type { ChainInput } from './types';

export function preserveInputOrder(
  parsedInput: ChainInput,
  rawInput: unknown,
): ChainInput {
  return applyInputOrder(parsedInput, captureInputOrder(rawInput));
}

export function captureInputOrder(value: unknown) {
  return captureOrderNode(value) ?? { keys: [] };
}

export function applyInputOrder(
  parsedInput: ChainInput,
  inputOrder: unknown,
): ChainInput {
  return applyOrderNode(parsedInput, inputOrder) as ChainInput;
}

function captureOrderNode(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const items = value.map(captureOrderNode);

    return items.some(Boolean) ? { items } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const children: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value)) {
    const child = captureOrderNode(childValue);

    if (child) {
      children[key] = child;
    }
  }

  const node: Record<string, unknown> = { keys: Object.keys(value) };

  if (Object.keys(children).length > 0) {
    node.children = children;
  }

  return node;
}

function applyOrderNode(parsedValue: unknown, orderNode: unknown): unknown {
  if (Array.isArray(parsedValue)) {
    const itemOrders = isRecord(orderNode) ? orderNode.items : null;

    if (!Array.isArray(itemOrders)) {
      return parsedValue;
    }

    return parsedValue.map((item, index) =>
      applyOrderNode(item, itemOrders[index]),
    );
  }

  if (!isRecord(parsedValue) || !isRecord(orderNode)) {
    return parsedValue;
  }

  const ordered: Record<string, unknown> = {};
  const keys = Array.isArray(orderNode.keys)
    ? orderNode.keys.filter((key): key is string => typeof key === 'string')
    : [];
  const children = isRecord(orderNode.children) ? orderNode.children : {};

  for (const key of keys) {
    if (hasOwn(parsedValue, key)) {
      ordered[key] = applyOrderNode(parsedValue[key], children[key]);
    }
  }

  for (const key of Object.keys(parsedValue)) {
    if (!hasOwn(ordered, key)) {
      ordered[key] = parsedValue[key];
    }
  }

  return ordered;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
