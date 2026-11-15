// The commands of an image's size and alignment (#526), for a host's Image menu: Small, Medium and
// Large are a fraction of the text column, Original size takes the width away, and each of the
// alignments writes where the image stands in its line. All of them act on the image under the
// caret or in the selection (`image-size.ts`).

import type { EditorCommand } from './api.ts';
import { type ImageAlign, type ImageLook, imageInSelection, setImageLook } from './image-size.ts';
import { columnWidth } from './preview/image.ts';

/** The sizes a menu offers, as the part of the text column the image fills. */
export const IMAGE_SIZES = [
  { id: 'small', title: 'Small Image', share: 0.25 },
  { id: 'medium', title: 'Medium Image', share: 0.5 },
  { id: 'large', title: 'Large Image', share: 0.75 },
] as const;

const ALIGNMENTS: readonly { align: ImageAlign; title: string }[] = [
  { align: 'left', title: 'Align Image Left' },
  { align: 'center', title: 'Align Image Center' },
  { align: 'right', title: 'Align Image Right' },
];

export function imageSizeCommands(notice?: (message: string) => void): EditorCommand[] {
  const run =
    (look: ImageLook | ((column: number) => ImageLook)) =>
    (editor: Parameters<EditorCommand['run']>[0]) =>
      setImageLook(
        editor.view,
        typeof look === 'function' ? look(columnWidth(editor.view)) : look,
        undefined,
        notice,
      );
  const here = (state: Parameters<NonNullable<EditorCommand['isEnabled']>>[0]) =>
    imageInSelection(state) !== null;
  return [
    ...IMAGE_SIZES.map(({ id, title, share }) => ({
      id: `image.size.${id}`,
      title,
      isEnabled: here,
      run: run((column) => ({ width: Math.round(column * share) })),
    })),
    {
      id: 'image.size.original',
      title: 'Original Image Size',
      isEnabled: (state) => {
        const image = imageInSelection(state);
        return image !== null && (image.width !== null || image.widthText !== null);
      },
      run: run({ width: null }),
    },
    ...ALIGNMENTS.map(({ align, title }) => ({
      id: `image.align.${align}`,
      title,
      isEnabled: here,
      isActive: (state: Parameters<typeof here>[0]) => imageInSelection(state)?.align === align,
      run: run({ align }),
    })),
  ];
}
