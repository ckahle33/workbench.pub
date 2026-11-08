import type {
  BlobRef,
  Collection,
  ImageDef,
  LinkDef,
  PartDef,
  RecordByCollection,
  ValidationResult,
} from './types';

export type { Collection } from './types';
export * from './types';

export const LIMITS = {
  title: 120,
  summary: 500,
  heading: 120,
  body: 5000,
  images: 6,
  links: 8,
  parts: 40,
  replyBody: 2000,
} as const;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AT_URI_RE = /^at:\/\/[^\s/]+\/[A-Za-z0-9.-]+\/[^\s/]+$/;
const STATUSES = ['in-progress', 'finished', 'paused'];

export function normalizeSlug(input: string): string | null {
  const slug = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length >= 2 && slug.length <= 40 ? slug : null;
}

class Invalid extends Error {}

function fail(msg: string): never {
  throw new Invalid(msg);
}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${path} must be an object`);
  return v as Obj;
}

function str(o: Obj, key: string, max: number, path = key): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${path} must be a string`);
  if (v.length === 0) fail(`${path} must not be empty`);
  if (v.length > max) fail(`${path} exceeds ${max} characters`);
  return v;
}

function optStr(o: Obj, key: string, max: number, path = key): void {
  if (o[key] !== undefined) str(o, key, max, path);
}

function datetime(o: Obj, key: string): string {
  const v = str(o, key, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(Date.parse(v))) fail(`${key} must be an ISO datetime`);
  return v;
}

function atUri(o: Obj, key: string): string {
  const v = str(o, key, 512);
  if (!AT_URI_RE.test(v)) fail(`${key} must be an at-uri`);
  return v;
}

function slug(o: Obj, key: string): string {
  const v = str(o, key, 40);
  if (v.length < 2 || !SLUG_RE.test(v)) fail(`${key} must be a slug`);
  return v;
}

function blob(v: unknown, path: string): BlobRef {
  const b = obj(v, path);
  const ref = b.ref;
  if (
    b.$type !== 'blob' ||
    typeof ref !== 'object' ||
    ref === null ||
    typeof (ref as Obj).$link !== 'string' ||
    typeof b.mimeType !== 'string' ||
    typeof b.size !== 'number'
  ) {
    fail(`${path} must be a blob`);
  }
  return b as unknown as BlobRef;
}

function list<T>(o: Obj, key: string, max: number, item: (v: unknown, path: string) => T): T[] | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) fail(`${key} must be an array`);
  if (v.length > max) fail(`${key} exceeds ${max} items`);
  return v.map((x, i) => item(x, `${key}[${i}]`));
}

function image(v: unknown, path: string): ImageDef {
  const o = obj(v, path);
  blob(o.image, `${path}.image`);
  if (typeof o.alt !== 'string') fail(`${path}.alt must be a string`);
  if (o.alt.length > LIMITS.title) fail(`${path}.alt exceeds ${LIMITS.title} characters`);
  return o as unknown as ImageDef;
}

function link(v: unknown, path: string): LinkDef {
  const o = obj(v, path);
  const url = str(o, 'url', 2048, `${path}.url`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(`${path}.url must be a URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail(`${path}.url must be http(s)`);
  optStr(o, 'title', LIMITS.title, `${path}.title`);
  return o as unknown as LinkDef;
}

function part(v: unknown, path: string): PartDef {
  const o = obj(v, path);
  str(o, 'item', LIMITS.title, `${path}.item`);
  optStr(o, 'quantity', 40, `${path}.quantity`);
  optStr(o, 'note', LIMITS.summary, `${path}.note`);
  return o as unknown as PartDef;
}

const validators: { [C in Collection]: (o: Obj) => void } = {
  'pub.workbench.topic'(o) {
    str(o, 'name', LIMITS.title);
    slug(o, 'slug');
    if (typeof o.description !== 'string') fail('description must be a string');
    if (o.description.length > LIMITS.summary) fail(`description exceeds ${LIMITS.summary} characters`);
    datetime(o, 'createdAt');
  },
  'pub.workbench.project'(o) {
    str(o, 'title', LIMITS.title);
    str(o, 'summary', LIMITS.summary);
    slug(o, 'topic');
    if (typeof o.status !== 'string' || !STATUSES.includes(o.status)) fail(`status must be one of ${STATUSES.join(', ')}`);
    if (o.cover !== undefined) blob(o.cover, 'cover');
    datetime(o, 'createdAt');
  },
  'pub.workbench.update'(o) {
    atUri(o, 'project');
    str(o, 'heading', LIMITS.heading);
    str(o, 'body', LIMITS.body);
    list(o, 'images', LIMITS.images, image);
    list(o, 'links', LIMITS.links, link);
    list(o, 'parts', LIMITS.parts, part);
    datetime(o, 'createdAt');
  },
  'pub.workbench.reply'(o) {
    atUri(o, 'subject');
    str(o, 'body', LIMITS.replyBody);
    datetime(o, 'createdAt');
  },
  'pub.workbench.follow'(o) {
    if (o.kind === 'project') {
      const uri = atUri(o, 'subject');
      if (uri.split('/')[3] !== 'pub.workbench.project') fail('subject must be a project at-uri');
    } else if (o.kind === 'topic') {
      const s = str(o, 'subject', 40);
      if (normalizeSlug(s) !== s) fail('subject must be a canonical slug');
    } else {
      fail('kind must be project or topic');
    }
    datetime(o, 'createdAt');
  },
};

const KNOWN_KEYS: { [C in Collection]: string[] } = {
  'pub.workbench.topic': ['$type', 'name', 'slug', 'description', 'createdAt'],
  'pub.workbench.project': ['$type', 'title', 'summary', 'topic', 'status', 'cover', 'createdAt'],
  'pub.workbench.update': ['$type', 'project', 'heading', 'body', 'images', 'links', 'parts', 'createdAt'],
  'pub.workbench.reply': ['$type', 'subject', 'body', 'createdAt'],
  'pub.workbench.follow': ['$type', 'kind', 'subject', 'createdAt'],
};

export function validateRecord<C extends Collection>(
  collection: C,
  record: unknown,
): ValidationResult<RecordByCollection[C]> {
  if (!Object.hasOwn(validators, collection)) return { ok: false, reason: `unknown collection ${String(collection)}` };
  try {
    const o = obj(record, 'record');
    for (const key of Object.keys(o)) {
      if (!KNOWN_KEYS[collection].includes(key)) fail(`unknown field ${key.slice(0, 40)}`);
    }
    if (o.$type !== collection) fail(`$type must be ${collection}`);
    validators[collection](o);
    return { ok: true, value: o as unknown as RecordByCollection[C] };
  } catch (e) {
    return { ok: false, reason: e instanceof Invalid ? e.message : 'invalid record' };
  }
}
