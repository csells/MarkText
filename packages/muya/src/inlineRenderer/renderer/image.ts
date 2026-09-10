import type Format from '../../block/base/format';
import type { IImageSelectionData } from '../../selection/types';
import type { H, ImageToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';
import DeleteIcon from '../../assets/icons/delete/2.png';
import ImageIcon from '../../assets/icons/image/2.png';
import ImageFailIcon from '../../assets/icons/image_fail/2.png';
import { CLASS_NAMES } from '../../config';
import { getImageSrc } from '../../utils/image';
import { renderImageContainer } from './imageContainer';

function renderIcon(h: H, className: string, icon: string) {
    // A `<span>`, not an `<a>`: these hover controls carry no href, and an `<a>`
    // here nests illegally when the image sits inside a real anchor (e.g. a
    // reference-linked image `[![alt](img)][ref]`). The HTML parser closes the
    // outer anchor early on the nested `<a>`, hoisting the image out of the link
    // (#4865).
    const selector = `span.${className}`;
    const iconVNode = h(
        'i.icon',
        h(
            'i.icon-inner',
            {
                style: {
                    'background': `url(${icon}) no-repeat`,
                    'background-size': '100%',
                },
            },
            '',
        ),
    );

    return h(selector, iconVNode);
}

function shouldSyncSelectedImageId(
    selectedImage: IImageSelectionData | null,
    src: string,
    id: string,
    block: Format,
    token: ImageToken,
): selectedImage is IImageSelectionData {
    return (
        !!selectedImage
        && selectedImage.token.attrs.src === src
        && selectedImage.imageId !== id
        && selectedImage.block === block
        && selectedImage.token.range.start === token.range.start
        && selectedImage.token.range.end === token.range.end
    );
}

function isSmallImage(
    naturalWidth: number | undefined,
    naturalHeight: number | undefined,
) {
    return (
        typeof naturalWidth === 'number'
        && typeof naturalHeight === 'number'
        && (naturalWidth < 100 || naturalHeight < 100)
    );
}

function isImageSelected(
    selectedImage: IImageSelectionData | null,
    block: Format,
    token: ImageToken,
    id: string,
) {
    if (!selectedImage)
        return false;

    const { imageId, block: selectedBlock, token: selectedToken } = selectedImage;

    return (
        imageId === `${id}_${token.range.start}`
        && selectedBlock === block
        && selectedToken.range.start === token.range.start
        && selectedToken.range.end === token.range.end
    );
}

// I don't want operate dom directly, is there any better way? need help!
export default function image(
    this: Renderer,
    { h, block, token }: ISyntaxRenderOptions & { token: ImageToken },
) {
    const imageSrc = getImageSrc(token.attrs.src);
    const selectedImage = this.muya.editor.selection.image;
    const { i18n } = this.muya;
    const data = {
        attrs: {
            'contenteditable': 'false',
            'empty-text': i18n.t('Click to add an image'),
            'fail-text': i18n.t('Load image failed'),
        },
        dataset: {
            raw: token.raw,
        },
    };
    let id: string = '';
    let isSuccess: boolean | undefined;
    let naturalWidth: number | undefined;
    let naturalHeight: number | undefined;
    let resolvedUrl: string | undefined;
    // `src` stays the plain path — it is the key the `urlMap`/cache lookups use.
    const src = imageSrc.src;
    const alt = token.attrs.alt;
    const title = token.attrs.title;
    const width = token.attrs.width;
    const height = token.attrs.height;

    if (src) {
        ({ id, isSuccess, url: resolvedUrl, width: naturalWidth, height: naturalHeight }
            = this.loadImageAsync(imageSrc, token.attrs));
    }

    // What the rendered <img> actually points at. For local files this is the
    // cache-busted `file://?mucache=…` URL resolved by `loadImageAsync`, so a
    // block re-render (`innerHTML = html`) re-requests the busted URL instead
    // of the plain path Chromium has cached. Uploads in progress override it
    // with the base64 preview below.
    let imgSrc = resolvedUrl ?? src;

    const wrapperId = id && (isSuccess ? `${id}_${token.range.start}` : id);
    if (shouldSyncSelectedImageId(selectedImage, src, wrapperId, block, token))
        selectedImage.imageId = wrapperId;
    let wrapperSelector = wrapperId
        ? `span#${wrapperId}.${CLASS_NAMES.MU_INLINE_IMAGE}`
        : `span.${CLASS_NAMES.MU_INLINE_IMAGE}`;

    const imageIcons = [
        renderIcon(h, 'mu-image-icon-success', ImageIcon),
        renderIcon(h, 'mu-image-icon-fail', ImageFailIcon),
        renderIcon(h, 'mu-image-icon-close', DeleteIcon),
    ];

    if (typeof token.attrs['data-align'] === 'string')
        wrapperSelector += `.${token.attrs['data-align']}`;

    // A terminal block-displayed atom needs an editable caret line after it.
    // This layout break has no source text and is shared by all image views.
    const caretLine = ['left', 'center', 'right'].includes(token.attrs['data-align'])
        && token.range.end === block.text?.length
        ? [h('br')]
        : [];

    // the src image is still loading, so use the url Map base64.
    if (this.urlMap.has(src)) {
        imgSrc = this.urlMap.get(src)!;
        isSuccess = true;
    }

    if (alt.startsWith('loading-')) {
        wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_UPLOADING}`;
        Object.assign(data.dataset, {
            id: alt,
        });
        if (this.urlMap.has(alt)) {
            imgSrc = this.urlMap.get(alt)!;
            isSuccess = true;
        }
    }

    if (src) {
    // image is loading...
        if (typeof isSuccess === 'undefined') {
            wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_LOADING}`;
        }
        else if (isSuccess === true) {
            wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_SUCCESS}`;
            // Tag images whose natural size is below
            // 100px in either dimension. NOTE: no CSS in this package currently
            // consumes `.mu-small-image` — it is kept as a theming hook so
            // downstream stylesheets can shrink/hide the in-wrapper hover icons
            // (`.mu-image-icon-success/fail/close`, each 20×20) that visually
            // clobber a small image. The marktext original wired this class to
            // an in-wrapper `.ag-image-buttons` group that this repo doesn't
            // have (our toolbar is a floating-ui overlay), so the rule lives
            // here as data only; downstream consumers / future PRs own the
            // visual treatment.
            if (isSmallImage(naturalWidth, naturalHeight))
                wrapperSelector += `.${CLASS_NAMES.MU_SMALL_IMAGE}`;
        }
        else {
            wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_FAIL}`;
        }

        // Add image selected class name.
        if (isImageSelected(selectedImage, block, token, id))
            wrapperSelector += `.${CLASS_NAMES.MU_INLINE_IMAGE_SELECTED}`;

        const renderImage = () => {
            const data = {
                props: {
                    alt: token.attrs['data-core-semantic-alt'] === 'true' ? alt : alt.replace(/[`*{}[\]()#+\-.!_>~:|<$]/g, ''),
                    src: imgSrc,
                    title,
                },
            };

            if (typeof width === 'string' && width)
                Object.assign(data.props, { width });

            if (typeof height === 'string' && height)
                Object.assign(data.props, { height });

            return h('img', data);
        };

        return isSuccess
            ? [
                    h(wrapperSelector, data, [
                        ...imageIcons,
                        renderImageContainer(h, title,
                            // An image description has inline elements as its contents.
                            // When an image is rendered to HTML, this is used as the image’s alt attribute.
                            renderImage()),
                    ]),
                    ...caretLine,
                ]
            : [h(wrapperSelector, data, [...imageIcons, renderImageContainer(h, title)]), ...caretLine];
    }
    else {
        wrapperSelector += `.${CLASS_NAMES.MU_EMPTY_IMAGE}`;

        return [h(wrapperSelector, data, [...imageIcons, renderImageContainer(h, title)]), ...caretLine];
    }
}
