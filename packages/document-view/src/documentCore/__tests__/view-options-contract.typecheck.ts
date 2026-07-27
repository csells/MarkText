import type {
    ParseConfiguration,
    SourceSnapshot,
} from '@marktext/document-core';
import type {
    IDocumentCoreViewOptions,
    IDocumentCoreViewSession,
} from '../documentCoreView';

declare const host: HTMLElement;
declare const source: SourceSnapshot;
declare const parseConfiguration: ParseConfiguration;
declare const session: IDocumentCoreViewSession;

const hosted: IDocumentCoreViewOptions = {
    host,
    session,
};
const standalone: IDocumentCoreViewOptions = {
    host,
    // @ts-expect-error production views cannot construct document authority
    source,
    parseConfiguration,
};

const hostedWithSource: IDocumentCoreViewOptions = {
    host,
    session,
    // @ts-expect-error a hosted view cannot receive renderer source authority
    source,
};
const hostedWithConfiguration: IDocumentCoreViewOptions = {
    host,
    session,
    // @ts-expect-error a hosted view cannot receive renderer parser authority
    parseConfiguration,
};
const incompleteStandalone: IDocumentCoreViewOptions = {
    host,
    // @ts-expect-error production views cannot receive renderer source authority
    source,
};

void [
    standalone,
    hosted,
    hostedWithSource,
    hostedWithConfiguration,
    incompleteStandalone,
];
