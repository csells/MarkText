import type { VNode } from 'snabbdom';
import type { H } from '../types';
import { CLASS_NAMES } from '../../config';

/** Shared image contents for document images and transient resource progress. */
export function renderImageContainer(h: H, title: string | undefined, ...children: VNode[]): VNode {
    return h(`span.${CLASS_NAMES.MU_IMAGE_CONTAINER}`, title ? { dataset: { title } } : {}, children);
}
