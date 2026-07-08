import { collection, config, fields, singleton } from '@drystack/core';

export default config({
  storage: {
    kind: 'local',
  },
  singletons: {
    demo: singleton({
      label: 'Demo',
      format: 'json',
      schema: {
        heading: fields.text({
          label: 'Heading',
          defaultValue: 'Hello from Drystack',
        }),
        description: fields.text({
          label: 'Description',
          multiline: true,
          defaultValue:
            'Edit this content in the Keystatic admin UI at /drystack.',
        }),
        image: fields.image({ label: 'Image' }),
        body: fields.content({ label: 'Body' }),
      },
    }),
  },
  collections: {
    posts: collection({
      label: 'Posts',
      path: 'src/content/posts/*',
      slugField: 'title',
      format: 'json',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        cover: fields.image({ label: 'Cover image' }),
        body: fields.content({ label: 'Body' }),
      },
    }),
  },
});
