export type Collection =
  | 'pub.workbench.topic'
  | 'pub.workbench.project'
  | 'pub.workbench.update'
  | 'pub.workbench.reply'
  | 'pub.workbench.follow';

export type ProjectStatus = 'in-progress' | 'finished' | 'paused';

export interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface ImageDef {
  image: BlobRef;
  alt: string;
}

export interface LinkDef {
  url: string;
  title?: string;
}

export interface PartDef {
  item: string;
  quantity?: string;
  note?: string;
}

export interface TopicRecord {
  $type: 'pub.workbench.topic';
  name: string;
  slug: string;
  description: string;
  createdAt: string;
}

export interface ProjectRecord {
  $type: 'pub.workbench.project';
  title: string;
  summary: string;
  /** Topic slug. */
  topic: string;
  status: ProjectStatus;
  cover?: BlobRef;
  createdAt: string;
}

export interface UpdateRecord {
  $type: 'pub.workbench.update';
  /** at-uri of the project. */
  project: string;
  heading: string;
  body: string;
  images?: ImageDef[];
  links?: LinkDef[];
  parts?: PartDef[];
  createdAt: string;
}

export interface ReplyRecord {
  $type: 'pub.workbench.reply';
  /** at-uri of an update or another reply. */
  subject: string;
  body: string;
  createdAt: string;
}

export interface FollowRecord {
  $type: 'pub.workbench.follow';
  /** at-uri of a project or topic. */
  subject: string;
  createdAt: string;
}

export interface RecordByCollection {
  'pub.workbench.topic': TopicRecord;
  'pub.workbench.project': ProjectRecord;
  'pub.workbench.update': UpdateRecord;
  'pub.workbench.reply': ReplyRecord;
  'pub.workbench.follow': FollowRecord;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };
