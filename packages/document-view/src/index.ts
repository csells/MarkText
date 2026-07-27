import './styles/documentView.css';

export {
    CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS,
} from './criticMarkup/rejectionContract';
export type {
    ICriticMarkupTrackChangeRejection,
    TCriticMarkupTrackChangeRejectionReason,
} from './criticMarkup/rejectionContract';
export type {
    ICriticMarkupCommandState,
    ICriticMarkupCommandTarget,
    ICriticMarkupReviewActions,
    ICriticMarkupReviewEditor,
    ICriticMarkupReviewItem,
    ICriticMarkupReviewOptions,
    ICriticMarkupReviewSnapshot,
    TCriticMarkupAuthorInput,
    TCriticMarkupAuthorType,
    TCriticMarkupDecision,
    TCriticMarkupNavigationDirection,
    TCriticMarkupProjection,
    TCriticMarkupType,
} from './criticMarkup/reviewContract';

export { createDocumentCoreView } from './documentCore/documentCoreView';
export type {
    DocumentCoreMarkdownOptionPatch,
} from '@marktext/document-core';
export type {
    DocumentCoreClipboardWriteResult,
    DocumentCoreImageSourceRequest,
    DocumentCoreImageSourceResolution,
    DocumentCoreTableShape,
    DocumentCoreViewDispatchResult,
    DocumentCoreEditorCommand,
    DocumentCoreViewSnapshot,
    DocumentSelectionContext,
    DocumentViewOptions,
    DocumentViewInteraction,
    IDocumentSelectionFlags,
    IDocumentSelectionNode,
    IDocumentSelectionPoint,
    IDocumentCoreView,
    IDocumentCoreViewCompleteSnapshot,
    IDocumentCoreViewOptions,
    IDocumentCoreViewOutlineItem,
    IDocumentCoreViewSession,
    IDocumentCoreViewSourceOnlySnapshot,
} from './documentCore/documentCoreView';
export { renderDocumentCoreBlocks } from './documentCore/renderBlocks';

export type { ILocale } from './i18n/types';
export { de, en, es, fr, ja, ko, pt, tr, zhCN, zhTW } from './locales';

export {
    AsyncTaskError,
    reportAsyncFailure,
    reportAsyncTask,
} from './utils/asyncTask';
export { escapeHTML, unescapeHTML } from './utils/publicText';
export { generateGithubSlug } from './utils/slug';
