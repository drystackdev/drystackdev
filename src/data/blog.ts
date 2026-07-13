import { reader } from "./reader";

export interface BlogPost {
	slug: string;
	title: string;
	excerpt: string;
	keywords: string;
	cover: string;
	date: string;
	contentHtml: string;
}

async function readPosts(
	collection: "blog" | "seoKnowledge",
): Promise<BlogPost[]> {
	const entries = await reader.collections[collection].all({
		resolveLinkedFiles: true,
	});
	return entries
		.filter(({ entry }) => entry.publish)
		.map(({ slug, entry }) => ({
			slug,
			title: entry.title,
			excerpt: entry.excerpt,
			keywords: entry.keywords ?? "",
			cover: entry.cover ?? "",
			date: entry.date ?? "",
			contentHtml: entry.body,
		}));
}

export async function getBlogPosts(): Promise<BlogPost[]> {
	return readPosts("blog");
}

export async function getSeoKnowledgePosts(): Promise<BlogPost[]> {
	return readPosts("seoKnowledge");
}
