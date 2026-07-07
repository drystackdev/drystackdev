import { config, fields, singleton } from '@drystack/core';

export default config({
  storage: {
    kind: 'local',
  },
  singletons: {
    demo: singleton({
      label: 'Demo',
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
      },
    }),
  },
});
