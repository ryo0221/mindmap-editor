import { CONTRACT_VERSION, OPERATIONS_ADDON, type ExtensionDefinition, type ExtensionManifest } from '@editor-platform/extension-contract';
import { MINDMAP_ARTIFACT_KIND, MINDMAP_SCHEMA_VERSION, isMindmapDocument, type MindmapDocument } from './mindmap-model';
import { mountEditor } from './Editor';
import { operationDeclarations, operations } from './operations';
export const manifest: Omit<ExtensionManifest, 'packageHash'> = {
  contractVersion: CONTRACT_VERSION, id: 'shinonome.mindmap-editor', version: '0.1.1',
  artifactKind: MINDMAP_ARTIFACT_KIND, schemaVersion: MINDMAP_SCHEMA_VERSION,
  capabilities: ['local-edit', 'surface', 'persistence'], permissions: ['artifact:read', 'artifact:write'],
  licenseNotices: ['AGPL-3.0-only. See LICENSE and NOTICE shipped with this package.'],
  addons: { operations: { version: OPERATIONS_ADDON, declarations: operationDeclarations } },
};
export function definition(packageHash: string): ExtensionDefinition<MindmapDocument> {
  return { manifest: { ...manifest, packageHash }, validate: isMindmapDocument, mount: mountEditor, operations };
}
