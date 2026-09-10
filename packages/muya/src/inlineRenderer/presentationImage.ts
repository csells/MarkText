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
        attrs: {
            'src': image.src,
            'alt': image.alt,
            'title': image.title,
            'data-core-semantic-alt': 'true',
            ...(image.width === undefined ? {} : { width: image.width }),
            ...(image.height === undefined ? {} : { height: image.height }),
            ...(image.align === undefined ? {} : { 'data-align': image.align }),
        },
        backlash: { first: '', second: '' },
    };
}
