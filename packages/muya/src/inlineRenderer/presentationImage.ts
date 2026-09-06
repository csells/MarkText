import type { IInlinePresentationImage, ImageToken } from './types';

/** Adapt an already interpreted host image; no Markdown recognition occurs here. */
export function createPresentationImageToken(image: IInlinePresentationImage): ImageToken {
    return {
        type: 'image',
        raw: image.raw,
        range: image.range,
        parent: [],
        marker: '!',
        srcAndTitle: image.src,
        src: image.src,
        alt: image.alt,
        title: image.title,
        attrs: { 'src': image.src, 'alt': image.alt, 'title': image.title, 'data-core-semantic-alt': 'true' },
        backlash: { first: '', second: '' },
    };
}
