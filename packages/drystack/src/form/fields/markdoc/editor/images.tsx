import { Fragment, Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { dropPoint } from 'prosemirror-transform';

import { Icon } from '@keystar/ui/icon';
import { imageIcon } from '#icons/imageIcon';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';
import { Text } from '@keystar/ui/typography';
import { useLocalizedStringFormatter } from '@react-aria/i18n';
import l10nMessages from '../../../../app/l10n';

import { openMediaLibrary } from '../../../../app/media-library/bridge';
import { EditorSchema, getEditorSchema } from './schema';
import { ToolbarButton } from './Toolbar';
import { EditorConfig } from '../config';
import { getSrcPrefix } from '../../image/getSrcPrefix';
import { toSerialized } from './props-serialization';
import { imageAttrsForPick } from './image-pick';
import { useMediaScope } from './media-scope';

export function getSrcPrefixForImageBlock(
  config: EditorConfig,
  slug: string | undefined
) {
  return getSrcPrefix(
    typeof config.image === 'object' ? config.image.publicPath : undefined,
    slug
  );
}

export function imageDropPlugin(schema: EditorSchema) {
  const imageType = schema.nodes.image;
  return new Plugin({
    props: {
      handleDrop(view, event) {
        if (event.dataTransfer?.files.length) {
          const file = event.dataTransfer.files[0];
          let eventPos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (!eventPos) return;
          let $mouse = view.state.doc.resolve(eventPos.pos);
          for (const [name, component] of Object.entries(schema.components)) {
            if (
              (component.kind !== 'block' && component.kind !== 'inline') ||
              !component.handleFile
            ) {
              continue;
            }
            const result = component.handleFile(
              file,
              (view.props as any).config
            );
            if (!result) continue;
            (async () => {
              const value = await result;
              const slice = Slice.maxOpen(
                Fragment.from(
                  schema.schema.nodes[name].createChecked({
                    props: toSerialized(value, component.schema),
                  })
                )
              );
              const pos = dropPoint(
                view.state.doc,
                view.state.selection.from,
                slice
              );
              if (pos === null) return;
              view.dispatch(view.state.tr.replace(pos, pos, slice));
            })();
            return true;
          }
          if (
            file.type.startsWith('image/') &&
            imageType &&
            schema.config.image
          ) {
            const { transformFilename } = schema.config.image;
            (async () => {
              const content = new Uint8Array(await file.arrayBuffer());
              const filename = transformFilename(file.name);
              const slice = Slice.maxOpen(
                Fragment.from(imageType.createChecked({ src: content, filename }))
              );
              const pos = dropPoint(view.state.doc, $mouse.pos, slice);
              if (pos === null) return false;
              view.dispatch(view.state.tr.replace(pos, pos, slice));
            })();
            return true;
          }
        }
      },
      handlePaste(view, event) {
        if (event.clipboardData?.files.length) {
          const file = event.clipboardData.files[0];
          for (const [name, component] of Object.entries(schema.components)) {
            if (component.kind !== 'block' || !component.handleFile) continue;
            const result = component.handleFile(
              file,
              (view.props as any).config
            );
            if (!result) continue;
            (async () => {
              const value = await result;
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  schema.schema.nodes[name].createChecked({
                    props: toSerialized(value, component.schema),
                  })
                )
              );
            })();
            return true;
          }
          if (
            file.type.startsWith('image/') &&
            imageType &&
            schema.config.image
          ) {
            const { transformFilename } = schema.config.image;

            (async () => {
              const content = new Uint8Array(await file.arrayBuffer());
              const filename = transformFilename(file.name);
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  imageType.createChecked({ src: content, filename })
                )
              );
            })();
            return true;
          }
        }
      },
    },
  });
}
export function ImageToolbarButton() {
  const mediaScope = useMediaScope();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <TooltipTrigger>
      <ToolbarButton
        aria-label={stringFormatter.format('image')}
        command={(_, dispatch, view) => {
          if (dispatch && view) {
            (async () => {
              const picked = await openMediaLibrary({
                accept: 'image',
                local: mediaScope ?? undefined,
              });
              const schema = getEditorSchema(view.state.schema);
              if (!picked || !schema.config.image) return;
              const { src, filename } = imageAttrsForPick(
                picked,
                schema.config.image.transformFilename,
                schema.config.supportsMediaLibraryReferences
              );
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.image.createChecked({
                    src,
                    filename,
                  })
                )
              );
            })();
          }
          return true;
        }}
      >
        <Icon src={imageIcon} />
      </ToolbarButton>
      <Tooltip>
        <Text>{stringFormatter.format('image')}</Text>
      </Tooltip>
    </TooltipTrigger>
  );
}
