import { collection, config, fields, singleton } from "@drystack/core";

export default config({
  storage: import.meta.env.DEV ? {
    kind: "local",
  }: {
    kind: "github",
    repo: "khancoder282/drystack"
  },
  singletons: {
    home: singleton({
      label: "Home",
      schema: {
        heading: fields.text({
          label: "Heading",
          defaultValue: "Hello from Drystack",
        }),
        description: fields.text({
          label: "Description",
          multiline: true,
          defaultValue:
            "Edit this content in the Keystatic admin UI at /drystack.",
        }),
        image: fields.image({ label: "Image" }),
        body: fields.content({ label: "Body" }),
        arrayData: fields.array(
          fields.object({
            name: fields.text({ label: "Name" }),
          }),
        ),
      },
    }),
  },
  collections: {
    posts: collection({
      label: "Posts",
      slugField: "title",
      entryLayout: "content",
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        cover: fields.image({ label: "Cover image" }),
        description: fields.text({ label: "Description", validation: {} }),
        publish: fields.checkbox({ label: "Publish", defaultValue: false }),
        body: fields.content({ label: "Body" }),
      },
    }),
  },
});
