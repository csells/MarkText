import type { ReferenceElement } from '@floating-ui/dom';
import type { VNode } from 'snabbdom';
import type { Muya } from '../../index';
import { CLASS_NAMES } from '../../config';
import { renderImageContainer } from '../../inlineRenderer/renderer/imageContainer';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';

/** Resource progress is a transient native widget, never editable document state. */
export class PendingImage extends BaseFloat {
    private _vnode: VNode | null = null;
    private readonly _imageRoot = document.createElement('span');

    constructor(muya: Muya) {
        super(muya, 'mu-pending-image');
        this.container!.appendChild(this._imageRoot);
        this.container!.style.width = 'max-content';
        this.floatBox!.style.pointerEvents = 'none';
    }

    present(src: string, reference: ReferenceElement): void {
        const vnode = h(`span.${CLASS_NAMES.MU_INLINE_IMAGE}.${CLASS_NAMES.MU_IMAGE_UPLOADING}.${CLASS_NAMES.MU_IMAGE_LOADING}`, {
            attrs: { 'role': 'status', 'aria-label': this.muya.i18n.t('Loading...'), 'aria-busy': 'true' },
        }, [renderImageContainer(h, undefined, h('img', { props: { src, alt: this.muya.i18n.t('Image') } }))]);
        patch(this._vnode ?? this._imageRoot, vnode);
        this._vnode = vnode;
        this.show(reference);
    }
}
