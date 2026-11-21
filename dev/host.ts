import { type Artifact, type StorageAdapter } from '@editor-platform/artifact-core';
import { sameLocalRevision } from '@editor-platform/editor-core';
import {
  ArtifactEditor,
  loadHostArtifact,
  type EditorHostAdapter,
} from '@editor-platform/editor-host';
import {
  type ExtensionHandle,
  type PreparedOperation,
  type Registration,
} from '@editor-platform/extension-runtime';
import { artifactEditorHost } from '@editor-platform/extension-runtime/editor-host';
import { MINDMAP_ARTIFACT_KIND, MINDMAP_SCHEMA_VERSION, isMindmapDocument, validateMindmap, type MindmapDocument } from '../src/mindmap-model';
import { fingerprint } from '../src/operations';

export interface LocalEditorHost {
  readonly editor: ArtifactEditor<MindmapDocument>;
  readonly handle: ExtensionHandle<MindmapDocument>;
  setReadOnly(value: boolean): void;
  setSaveFailure(value: boolean): void;
  prepareRename(id: string, title: string): PreparedOperation<MindmapDocument>;
  save(): Promise<void>;
  exportNative(): Promise<string>;
  exportDocument(): string;
  parseNative(json: string): Promise<Artifact<MindmapDocument>>;
  parseImport(json: string): Promise<MindmapDocument>;
  reopenSaved(): Promise<LocalEditorHost>;
  close(discard?: boolean): void;
}

/**
 * One local Host using the real EP session, history, authority and storage boundary.
 * The Editor receives only handle.api. Do not add a second history or save path.
 */
export function createLocalHost(
  registration: Registration<MindmapDocument>,
  artifact: Artifact<MindmapDocument>,
  storage: Pick<StorageAdapter<Artifact<MindmapDocument>>, 'get' | 'put'>,
): LocalEditorHost {
  if (
    registration.manifest.artifactKind !== MINDMAP_ARTIFACT_KIND ||
    registration.manifest.schemaVersion !== MINDMAP_SCHEMA_VERSION
  ) {
    throw new Error(`このサンプルは ${MINDMAP_ARTIFACT_KIND}@${MINDMAP_SCHEMA_VERSION} に対応しています。`);
  }
  let readOnly = false;
  let permissionEpoch = 0;
  let saveFailure = false;
  const adapter: EditorHostAdapter<MindmapDocument> = {
    kind: registration.manifest.artifactKind,
    validate: isMindmapDocument,
    capabilities: {
      undo: true,
      nativeJson: true,
      formats: [],
      preview: 'none',
      shared: false,
    },
  };
  const editor = new ArtifactEditor(
    artifact,
    adapter,
    {
      async put(value) {
        if (saveFailure)
          throw new Error('確認用の保存エラーです。設定を解除して再試行してください。');
        await storage.put(value);
      },
    },
    () => !readOnly,
  );
  const handle = registration.open(
    artifactEditorHost(editor, {
      schemaVersion: registration.manifest.schemaVersion,
      allowed: (permission) =>
        permission === 'artifact:read' || (permission === 'artifact:write' && !readOnly),
    }),
  );
  const controller: LocalEditorHost = {
    editor,
    handle,
    setReadOnly(value) {
      if (value !== readOnly) permissionEpoch += 1;
      readOnly = value;
      editor.refreshPermission();
    },
    setSaveFailure(value) {
      saveFailure = value;
    },
    prepareRename(id, title) {
      const node = editor.content.nodes[id];
      if (!node) throw new Error('名前を変更する枝を選択してください。');
      if (!handle.operations) throw new Error('このEditorは操作提案に対応していません。');
      const revision = editor.revision;
      const epoch = permissionEpoch;
      const prepared = handle.operations.prepare(
        { id: 'edit-branch', version: '1.0.0' },
        { before: fingerprint(editor.content), steps: [{ kind: 'rename', id, text: title }] },
      );
      let used = false;
      const proposal: PreparedOperation<MindmapDocument> = {
        base: prepared.base,
        candidate: prepared.candidate,
        commit(context) {
          if (used) throw new Error('この提案は使用済みです。新しい提案を作成してください。');
          used = true;
          // The draft.1 runtime checks content equality. Host revisions and the
          // authority epoch also refuse change/Undo and revoke/restore (ABA).
          if (!sameLocalRevision(revision, editor.revision) || epoch !== permissionEpoch)
            throw new Error(
              '提案の作成後に内容または権限が変わりました。新しい提案を作成してください。',
            );
          prepared.commit(context);
        },
      };
      return Object.freeze(proposal);
    },
    async save() {
      await handle.api.save();
    },
    async exportNative() {
      return (await editor.export('native-json')) as string;
    },
    exportDocument() {
      validateMindmap(editor.content);
      return JSON.stringify(editor.content, null, 2) + '\n';
    },
    parseNative(json) {
      return loadHostArtifact(json, adapter);
    },
    async parseImport(json) {
      const value: unknown = JSON.parse(json);
      if (value && typeof value === 'object' && 'nodes' in value) {
        validateMindmap(value);
        return value;
      }
      return (await loadHostArtifact(json, adapter)).draft.content;
    },
    async reopenSaved() {
      // A reload must not silently discard a draft. The UI can offer an explicit
      // discard action separately; the default path keeps unsaved work intact.
      if (editor.snapshot.dirty) throw new Error('再読み込みする前に変更を保存してください。');
      const saved = await storage.get(editor.id);
      if (!saved) throw new Error('保存済みデータがありません。先に保存してください。');
      const checked = await loadHostArtifact(JSON.stringify(saved), adapter);
      controller.close();
      const next = createLocalHost(registration, checked, storage);
      next.setReadOnly(readOnly);
      next.setSaveFailure(saveFailure);
      return next;
    },
    close(discard = false) {
      editor.close(discard ? 'discard' : 'require-saved');
      handle.close();
    },
  };
  return controller;
}
