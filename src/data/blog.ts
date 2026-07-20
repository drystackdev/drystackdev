import { reader } from "./reader";

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  keywords: string;
  cover: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  contentHtml: string;
}

async function readPosts(
  collection: "blog" | "seoKnowledge",
): Promise<BlogPost[]> {
  // Read entry-by-entry rather than via `.all()`: a single entry that fails
  // schema validation (a draft saved without excerpt/cover, say) would
  // otherwise reject the whole batch and fail the production build.
  const slugs = await reader.collections[collection].list();
  const entries = (
    await Promise.all(
      slugs.map(async (slug) => {
        try {
          const entry = await reader.collections[collection].read(slug, {
            resolveLinkedFiles: true,
          });
          return entry === null ? [] : [{ slug, entry }];
        } catch (err) {
          console.warn(
            `[blog] skipping invalid entry "${slug}" in collection "${collection}":`,
            err instanceof Error ? err.message : err,
          );
          return [];
        }
      }),
    )
  ).flat();
  return entries
    .filter(({ entry }) => entry.publish)
    .map(({ slug, entry }) => ({
      slug,
      title: entry.title,
      excerpt: entry.excerpt,
      keywords: entry.keywords ?? "",
      cover: entry.cover ?? "",
      date: entry.date ?? "",
      createdAt: entry.createdAt ?? entry.date ?? "",
      updatedAt: entry.updatedAt ?? entry.date ?? "",
      contentHtml: entry.body,
    })) as any;
}

export async function getBlogPosts(): Promise<BlogPost[]> {
  return readPosts("blog");
}

export async function getSeoKnowledgePosts(): Promise<BlogPost[]> {
  return readPosts("seoKnowledge");
}
