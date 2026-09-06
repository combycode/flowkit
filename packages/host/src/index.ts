/* @flowkit/host — the Node side.
 *
 * Everything that needs a filesystem, a browser or a platform path lives here,
 * so @flowkit/core can stay pure and portable. The MCP server, the CLI
 * tools and (later) the desktop shell all build on this.
 */

export type { Backup, BackupOptions } from './backups';
export { backup, backups, dirFor, findBackup } from './backups';
export { escapeCss, escapeJs, escapeJson } from './embed';
export type { HtmlExportOptions, HtmlExportResult } from './export/html';
export { exportHtml, fileNameOf } from './export/html';
export { renderIndex } from './export/index-page';
export type { LightOptions, LightResult } from './export/light';
export { lightDocument } from './export/light';
export type { PngExportOptions, PngExportResult } from './export/png';
export { exportPng } from './export/png';
export type { ExportJob, ExportSelection } from './export/select';
export { screensToExport } from './export/select';
export type { SpecExportOptions, SpecExportResult } from './export/spec';
export { exportSpec } from './export/spec';
export type { ViewerExportOptions, ViewerExportResult } from './export/viewer';
export { exportViewer } from './export/viewer';
export type { FetchedFonts } from './fonts';
export { fetchGoogleFonts } from './fonts';
export { exists, readJson, sleep } from './fsx';
export type { HistoryOptions } from './history';
export { History } from './history';
export type { LoadedImage } from './image';
export { loadImage, mimeOf } from './image';
export { openCommand, openInBrowser } from './open';
export {
  appDataDir,
  DEFAULT_PORT,
  defaultPort,
  exportDir,
  projectPath,
  workspaceDir,
} from './paths';
export type { KnownProject } from './registry';
export { forget, idFromPath, knownProjects, pathOfKnown, remember } from './registry';
export { Cdp, evaluate } from './render/cdp';
export type { MapPage, MapPageInput, Rect } from './render/map-page';
export { mapPage, READY_FLAG } from './render/map-page';
export type { RenderRequest, RenderResult } from './render/sidecar';
export { Sidecar } from './render/sidecar';
export type { SelectedElement, Selection } from './selection';
export {
  clearSelection,
  countSelections,
  peekSelections,
  saveSelection,
  takeSelections,
} from './selection';
export type { ServeOptions, Studio } from './server/studio';
export { type Instance, scanInstances, serveStudio } from './server/studio';
export type { StoreOptions } from './store';
export { Store } from './store';
export type { FetchedStylesheet } from './stylesheet';
export { fetchStylesheet, provenance } from './stylesheet';
export { compileTailwind, tailwindVersion } from './tailwind';
export type { ProjectMeta } from './workspace';
export { Workspace } from './workspace';
